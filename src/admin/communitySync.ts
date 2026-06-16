/**
 * Per-vintage community indicator fetch + normalize.
 *
 * One module called by BOTH the ETL scripts (etl:acs / etl:cdc) and the
 * admin sync route — same code path so there's exactly one place where the
 * per-indicator math lives. ETL scripts loop over all vintages; admin sync
 * picks the newest unloaded vintage.
 *
 * Hard rules:
 *   - The "live read view" is `community_indicator_values`. These functions
 *     return ROWS; the caller decides whether to write them and how (ETL
 *     uses bulkUpsert; admin uses the versioned apply path).
 *   - Census's missing-data sentinels (-666666666 etc.) collapse to null.
 *   - Uninhabited tracts (race indicator) collapse to a no-data row so the
 *     map paints them blank.
 *   - DBN remap / aggregation / any join-side concern lives ELSEWHERE — this
 *     module is purely "raw vintage → normalized community rows".
 */

import { acsFetch, buildTractGeoid } from '../../scripts/lib/acs.js';
import { fetchCdcPlaces } from '../../scripts/lib/cdc.js';
import { NYC_COUNTY_FIPS } from '../registry/geographies.js';
import { activeAcsIndicators, activeCdcIndicators } from '../registry/indicators.js';
import type { AcsSource, CdcPlacesSource, IndicatorRegistryEntry } from '../registry/types.js';

export interface CommunityRow {
  area_id: string;
  geo_layer: 'tract';
  year: string;
  indicator_id: string;
  value_num: number | null;
  value_text: string | null;
  label: string | null;
  source_year: string;
}

export type Provider = 'acs' | 'cdc_places';

export function indicatorsForProvider(provider: Provider): IndicatorRegistryEntry[] {
  return provider === 'acs' ? activeAcsIndicators() : activeCdcIndicators();
}

export function isNycTract(row: Record<string, string>): boolean {
  const county = row['county'];
  return Boolean(county) && county! in NYC_COUNTY_FIPS;
}

export function acsNum(raw: string | undefined): number | null {
  if (raw == null || raw === '' || raw === 'null') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n <= -222222220) return null; // Census missing-data sentinels (-666666666 etc.)
  return n;
}

/* -------------------------------------------------------------------------- */
/* ACS                                                                        */
/* -------------------------------------------------------------------------- */

export async function fetchAcsVintage(year: string, indicators: IndicatorRegistryEntry[], forceFresh = false): Promise<CommunityRow[]> {
  const out: CommunityRow[] = [];
  for (const ind of indicators) {
    const src = ind.source as AcsSource;
    const records = await acsFetch({ year, endpoint: src.endpoint, fields: src.fields, forceFresh });
    const nyc = records.filter(isNycTract);
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
  }
  return out;
}

export function computeAcsValue(
  ind: IndicatorRegistryEntry,
  r: Record<string, string>,
): { value_num: number | null; value_text: string | null; label: string | null } {
  switch (ind.id) {
    case 'child_poverty': {
      const below = [
        'B17001_004E', 'B17001_005E', 'B17001_006E', 'B17001_007E', 'B17001_008E', 'B17001_009E',
        'B17001_018E', 'B17001_019E', 'B17001_020E', 'B17001_021E', 'B17001_022E', 'B17001_023E',
      ].map((f) => acsNum(r[f])).reduce((s, n) => (s == null || n == null ? s ?? n : s + n), 0 as number | null);
      const above = [
        'B17001_033E', 'B17001_034E', 'B17001_035E', 'B17001_036E', 'B17001_037E', 'B17001_038E',
        'B17001_047E', 'B17001_048E', 'B17001_049E', 'B17001_050E', 'B17001_051E', 'B17001_052E',
      ].map((f) => acsNum(r[f])).reduce((s, n) => (s == null || n == null ? s ?? n : s + n), 0 as number | null);
      const denom = (below ?? 0) + (above ?? 0);
      const pct = denom > 0 && below != null ? (below / denom) * 100 : null;
      return { value_num: pct, value_text: null, label: pct == null ? null : `${pct.toFixed(1)}% of children under 18 below poverty` };
    }
    case 'unemployment_hh_children': {
      const pct = acsNum(r['S2301_C04_001E']);
      return { value_num: pct, value_text: null, label: pct == null ? null : `${pct.toFixed(1)}% civilian unemployment (16+)` };
    }
    case 'single_parent_hh': {
      const total = acsNum(r['B11003_001E']);
      const male = acsNum(r['B11003_010E']);
      const female = acsNum(r['B11003_016E']);
      const single = (male ?? 0) + (female ?? 0);
      const pct = total && total > 0 ? (single / total) * 100 : null;
      return { value_num: pct, value_text: null, label: pct == null ? null : `${pct.toFixed(1)}% single-parent households (own children <18)` };
    }
    case 'overcrowded_units': {
      const pct = acsNum(r['DP04_0078PE']);
      return { value_num: pct, value_text: null, label: pct == null ? null : `${pct.toFixed(1)}% units with 1.51+ occupants/room` };
    }
    case 'children_immigrant_families': {
      const total = acsNum(r['B05009_001E']);
      const numeratorCells = ['B05009_005E', 'B05009_012E', 'B05009_016E', 'B05009_023E'];
      let numerator: number | null = 0;
      for (const cell of numeratorCells) {
        const v = acsNum(r[cell]);
        if (v == null) { numerator = null; break; }
        numerator = (numerator ?? 0) + v;
      }
      const pct = numerator != null && total != null && total > 0 ? (numerator / total) * 100 : null;
      return { value_num: pct, value_text: null, label: pct == null ? null : `${pct.toFixed(1)}% of children <18 with at least one foreign-born parent` };
    }
    case 'racial_predominance': {
      const total = acsNum(r['B03002_001E']);
      if (total == null || total <= 0) return { value_num: null, value_text: null, label: 'No population' };
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
        return { value_num: null, value_text: null, label: `${top.label} predominance (${ratio.toFixed(0)}% of population) — not rendered` };
      }
      return { value_num: ratio, value_text: top.label, label: `${top.label} predominance (${ratio.toFixed(0)}% of population)` };
    }
    default:
      return { value_num: null, value_text: null, label: null };
  }
}

/* -------------------------------------------------------------------------- */
/* CDC PLACES                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * CDC's feed ships every vintage in one response. We return the rows grouped
 * by their own `year` column so each vintage lands under its true tag.
 */
export async function fetchCdcAllVintages(indicators: IndicatorRegistryEntry[], forceFresh = false): Promise<Map<string, CommunityRow[]>> {
  const byYear = new Map<string, CommunityRow[]>();
  for (const ind of indicators) {
    const src = ind.source as CdcPlacesSource;
    const all = await fetchCdcPlaces({ resource: src.resource, measureId: src.measure_id, forceFresh });
    const nyc = all.filter((r) => {
      const fips = (r.countyfips ?? '').padStart(5, '0');
      const county = fips.slice(2);
      return county in NYC_COUNTY_FIPS;
    });
    for (const r of nyc) {
      const year = r.year?.trim();
      if (!year) continue;
      const geoid = r.locationname?.trim();
      if (!geoid) continue;
      const v = r.data_value != null && r.data_value !== '' ? Number(r.data_value) : null;
      const value_num = v != null && Number.isFinite(v) ? v : null;
      const label = value_num == null ? null : `${value_num.toFixed(1)}% ${r.short_question_text ?? r.measure}`;
      const list = byYear.get(year) ?? [];
      list.push({
        area_id: geoid,
        geo_layer: 'tract',
        year,
        indicator_id: ind.id,
        value_num,
        value_text: null,
        label,
        source_year: year,
      });
      byYear.set(year, list);
    }
  }
  return byYear;
}

/**
 * "Pull just the latest CDC vintage" — used by sync. We still hit the same
 * Socrata endpoint (it has no per-year filter that's both efficient and
 * complete), then keep only the requested year's rows.
 */
export async function fetchCdcVintage(year: string, indicators: IndicatorRegistryEntry[], forceFresh = false): Promise<CommunityRow[]> {
  const byYear = await fetchCdcAllVintages(indicators, forceFresh);
  return byYear.get(year) ?? [];
}
