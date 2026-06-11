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
      // % of own children under 18 with at least one foreign-born parent.
      // Numerator: two-parent "one or both foreign born" + single-parent
      // "foreign-born parent", summed across the <6 and 6-17 age groups.
      const total = acsNum(r['B05009_001E']);
      const numeratorCells = ['B05009_005E', 'B05009_012E', 'B05009_016E', 'B05009_023E'];
      let numerator: number | null = 0;
      for (const cell of numeratorCells) {
        const v = acsNum(r[cell]);
        if (v == null) {
          numerator = null;
          break;
        }
        numerator = (numerator ?? 0) + v;
      }
      const pct =
        numerator != null && total != null && total > 0 ? (numerator / total) * 100 : null;
      return {
        value_num: pct,
        value_text: null,
        label:
          pct == null
            ? null
            : `${pct.toFixed(1)}% of children <18 with at least one foreign-born parent`,
      };
    }
    case 'racial_predominance': {
      // Store value_num = share of population in the predominant group (0–100),
      // value_text = category label. The map paints color from the label
      // (via RACE_QUALITATIVE) and opacity from the share (via the registry's
      // `opacity_stretch` 17→94 / 0→1 window). Matches the PWC IIT renderer.
      const total = acsNum(r['B03002_001E']);
      // Uninhabited / water-only tracts (Central Park, harbors, airport
      // edges) report total population 0. Without a denominator there's no
      // honest "predominant group" to label; suppress both fields so the
      // map's existing no-data branch (transparent fill) renders these
      // tracts as blank instead of arbitrarily coloring them.
      if (total == null || total <= 0) {
        return { value_num: null, value_text: null, label: 'No population' };
      }
      // Argmax across ALL 8 B03002 race/ethnicity groups — we need every
      // group in the running so we can correctly detect when the winner is
      // an "Other" bucket (American Indian alone or Some Other Race alone)
      // and suppress those tracts to no-data, matching the PWC IIT renderer.
      // `rendered` flags whether the winning label is one of the 6 categories
      // we actually paint; the two non-rendered winners both collapse to null
      // and re-use the existing zero-pop / no-data branch.
      const groups: Array<{ label: string; n: number | null; rendered: boolean }> = [
        { label: 'White', n: acsNum(r['B03002_003E']), rendered: true },
        { label: 'Black', n: acsNum(r['B03002_004E']), rendered: true },
        { label: 'American Indian', n: acsNum(r['B03002_005E']), rendered: false },
        { label: 'Asian', n: acsNum(r['B03002_006E']), rendered: true },
        { label: 'Pacific Islander', n: acsNum(r['B03002_007E']), rendered: true },
        { label: 'Some Other Race', n: acsNum(r['B03002_008E']), rendered: false },
        { label: 'Two or More Races', n: acsNum(r['B03002_009E']), rendered: true },
        { label: 'Latinx', n: acsNum(r['B03002_012E']), rendered: true },
      ];
      const valid = groups.filter((g) => g.n != null) as Array<{ label: string; n: number; rendered: boolean }>;
      if (valid.length === 0) return { value_num: null, value_text: null, label: null };
      const top = valid.reduce((best, g) => (g.n > best.n ? g : best));
      const ratio = (top.n / total) * 100;
      if (!top.rendered) {
        // "Other" predominance — not in the IIT category set, so we don't
        // paint these. value_num/value_text both null → no-data branch on the
        // map, same as zero-pop tracts.
        return {
          value_num: null,
          value_text: null,
          label: `${top.label} predominance (${ratio.toFixed(0)}% of population) — not rendered`,
        };
      }
      return {
        value_num: ratio,
        value_text: top.label,
        label: `${top.label} predominance (${ratio.toFixed(0)}% of population)`,
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
  // Optional `ONLY_INDICATOR=...` filter for targeted re-runs (e.g. after a
  // single indicator's compute logic changes). When unset, processes the full
  // registry as before.
  const only = process.env.ONLY_INDICATOR?.trim() || null;
  const indicators = activeAcsIndicators().filter((i) => (only ? i.id === only : true));
  if (only && indicators.length === 0) {
    throw new Error(`ONLY_INDICATOR=${only} matched no active ACS indicator`);
  }
  console.log(
    `[etl:acs] processing ${indicators.length} ACS indicator(s)${only ? ` (filtered: ${only})` : ''} × ${ACS_YEARS.length} vintages`,
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
