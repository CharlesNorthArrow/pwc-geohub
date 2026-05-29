/**
 * ETL 30 — fetch the 6 ACS 5-year community indicators → `community_indicator_values`.
 *
 * Each registry entry with `source.provider === 'acs5'` is dispatched to a
 * small per-indicator computation that knows how to derive the value from
 * the ACS fields. Adding a new ACS indicator = registry entry + one case in
 * the switch.
 */

import { acsFetch, buildTractGeoid } from '../lib/acs.js';
import { bulkUpsert } from '../lib/db.js';
import { recordFinding } from '../lib/findings.js';
import { activeAcsIndicators, ACS_YEARS } from '../../src/registry/indicators.js';
import type { AcsSource, IndicatorRegistryEntry } from '../../src/registry/types.js';
import { NYC_COUNTY_FIPS } from '../../src/registry/geographies.js';

interface CommunityRow {
  area_id: string;
  geo_layer: 'tract';
  year: string;
  indicator_id: string;
  value_num: number | null;
  value_text: string | null;
  label: string | null;
  source_year: string;
}

/** Numeric ACS field → number | null. Census uses negative sentinels for missing. */
function acsNum(raw: string | undefined): number | null {
  if (raw == null || raw === '' || raw === 'null') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // Census missing-data sentinels are negative magic numbers (-666666666, etc.).
  if (n <= -222222220) return null;
  return n;
}

function isNycTract(row: Record<string, string>): boolean {
  const county = row['county'];
  return Boolean(county) && county! in NYC_COUNTY_FIPS;
}

async function processIndicator(
  ind: IndicatorRegistryEntry,
  year: string,
): Promise<CommunityRow[]> {
  const src = ind.source as AcsSource;
  const records = await acsFetch({ year, endpoint: src.endpoint, fields: src.fields });
  const nyc = records.filter(isNycTract);
  console.log(`[etl:acs] ${ind.id} @ ${year}: ${records.length} NY records → ${nyc.length} NYC tract rows`);

  const out: CommunityRow[] = [];
  for (const r of nyc) {
    const geoid = buildTractGeoid(r['state']!, r['county']!, r['tract']!);
    const v = computeAcsValue(ind, r);
    out.push({
      area_id: geoid,
      geo_layer: 'tract',
      year,
      indicator_id: ind.id,
      value_num: v.value_num,
      value_text: v.value_text,
      label: v.label,
      source_year: year,
    });
  }
  return out;
}

/** Per-indicator math. Each branch returns {value_num, value_text, label}. */
function computeAcsValue(
  ind: IndicatorRegistryEntry,
  r: Record<string, string>,
): { value_num: number | null; value_text: string | null; label: string | null } {
  switch (ind.id) {
    case 'child_poverty': {
      // Numerator: persons under 18 below poverty (male age groups 4–9 + female 18–23).
      const below = [
        'B17001_004E', 'B17001_005E', 'B17001_006E', 'B17001_007E', 'B17001_008E', 'B17001_009E',
        'B17001_018E', 'B17001_019E', 'B17001_020E', 'B17001_021E', 'B17001_022E', 'B17001_023E',
      ]
        .map((f) => acsNum(r[f]))
        .reduce((s, n) => (s == null || n == null ? s ?? n : s + n), 0 as number | null);
      const above = [
        'B17001_033E', 'B17001_034E', 'B17001_035E', 'B17001_036E', 'B17001_037E', 'B17001_038E',
        'B17001_047E', 'B17001_048E', 'B17001_049E', 'B17001_050E', 'B17001_051E', 'B17001_052E',
      ]
        .map((f) => acsNum(r[f]))
        .reduce((s, n) => (s == null || n == null ? s ?? n : s + n), 0 as number | null);
      const denom = (below ?? 0) + (above ?? 0);
      const pct = denom > 0 && below != null ? (below / denom) * 100 : null;
      return {
        value_num: pct,
        value_text: null,
        label: pct == null ? null : `${pct.toFixed(1)}% of children under 18 below poverty`,
      };
    }
    case 'unemployment_hh_children': {
      const pct = acsNum(r['S2301_C04_001E']);
      return {
        value_num: pct,
        value_text: null,
        label: pct == null ? null : `${pct.toFixed(1)}% civilian unemployment (16+)`,
      };
    }
    case 'single_parent_hh': {
      const total = acsNum(r['B11003_001E']);
      const male = acsNum(r['B11003_010E']);
      const female = acsNum(r['B11003_016E']);
      const single = (male ?? 0) + (female ?? 0);
      const pct = total && total > 0 ? (single / total) * 100 : null;
      return {
        value_num: pct,
        value_text: null,
        label: pct == null ? null : `${pct.toFixed(1)}% single-parent households (own children <18)`,
      };
    }
    case 'overcrowded_units': {
      const pct = acsNum(r['DP04_0078PE']);
      return {
        value_num: pct,
        value_text: null,
        label: pct == null ? null : `${pct.toFixed(1)}% units with 1.51+ occupants/room`,
      };
    }
    case 'children_immigrant_families': {
      // Placeholder pass-through; B05009 decomposition resolved later.
      const total = acsNum(r['B05009_001E']);
      return {
        value_num: total,
        value_text: null,
        label: total == null ? null : `${total.toFixed(0)} own children under 18 (B05009 total)`,
      };
    }
    case 'racial_predominance': {
      const groups: Array<{ label: string; n: number | null }> = [
        { label: 'White', n: acsNum(r['B03002_003E']) },
        { label: 'Black', n: acsNum(r['B03002_004E']) },
        { label: 'Asian', n: acsNum(r['B03002_006E']) },
        { label: 'Hispanic', n: acsNum(r['B03002_012E']) },
      ];
      const valid = groups.filter((g) => g.n != null) as Array<{ label: string; n: number }>;
      if (valid.length === 0) return { value_num: null, value_text: null, label: null };
      const top = valid.reduce((best, g) => (g.n > best.n ? g : best));
      return {
        value_num: top.n,
        value_text: top.label,
        label: `${top.label} predominance`,
      };
    }
    default:
      return { value_num: null, value_text: null, label: null };
  }
}

async function upsertRows(rows: CommunityRow[]): Promise<void> {
  await bulkUpsert({
    table: 'community_indicator_values',
    columns: ['area_id', 'geo_layer', 'year', 'indicator_id', 'value_num', 'value_text', 'label', 'source_year'],
    rows: rows.map((r) => [
      r.area_id, r.geo_layer, r.year, r.indicator_id, r.value_num, r.value_text, r.label, r.source_year,
    ]),
    conflictKeys: ['area_id', 'geo_layer', 'indicator_id', 'year'],
  });
}

async function main(): Promise<void> {
  const indicators = activeAcsIndicators();
  console.log(
    `[etl:acs] processing ${indicators.length} ACS indicators × ${ACS_YEARS.length} vintages`,
  );

  // Outer loop: year. Inner loop: indicator. A per-(indicator,year) failure is
  // logged as a finding and the run continues — the 2020 5-yr release in
  // particular has table suppressions that would otherwise abort the ETL.
  for (const year of ACS_YEARS) {
    console.log(`[etl:acs] === vintage ${year} ===`);
    for (const ind of indicators) {
      try {
        const rows = await processIndicator(ind, year);
        await upsertRows(rows);
        const nonNull = rows.filter((r) => r.value_num != null || r.value_text != null).length;
        await recordFinding('indicator_loaded', `${ind.id}@${year}`, {
          rows_inserted: rows.length,
          rows_with_value: nonNull,
          acs_year: year,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[etl:acs] ${ind.id} @ ${year}: FAILED — ${message}`);
        await recordFinding('indicator_loaded', `${ind.id}@${year}`, {
          rows_inserted: 0,
          rows_with_value: 0,
          acs_year: year,
          fetch_error: message,
        });
      }
    }
  }
  console.log('[etl:acs] done.');
}

main().catch((err) => {
  console.error('[etl:acs] failed:', err);
  process.exit(1);
});
