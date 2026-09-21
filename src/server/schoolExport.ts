/**
 * School-level data export — one row per school in the dashboard's filtered
 * universe: identity, latest demographics, PWC program data, geo
 * assignments, every school indicator and every community indicator
 * (averaged over the school's area — District or NTA, per the toggle).
 *
 * Set-based reads only, all against precomputed tables (spec §11.9 — no
 * point-in-polygon at request time):
 *   1. schools + latest schools_year row          (identity, demographics)
 *   2. school_geo_crosswalk ⨝ geographies          (area ids + names)
 *   3. getPwcMembership(pwcYear)                   (PWC flags / category)
 *   4. school_indicator_values for (indicator, year) pairs
 *   5. the getAnalyticsSeries community aggregation, generalized to every
 *      community indicator; categorical ones (racial predominance) export
 *      the most common category across the area's tracts.
 *
 * Years: "latest" = each indicator's own latest year (the dashboard's
 * default Latest mode); otherwise the slider year, mapped to the community
 * calendar year the same way the map does (toCommunityYear).
 */

import { sql } from './db';
import { getActiveIndicatorsWithYears, getPwcMembership } from './contract';
import { toCommunityYear } from '../contract/year';
import { anchorProgram } from '../store/pwcGroups';
import { GEO_FILTER_LAYERS, type AggregationArea, type IndicatorPublic, type PwcCategory } from '../contract/types';

export interface SchoolExportOptions {
  dbns: string[];
  aggregationArea: AggregationArea;
  /** Slider school year, or null for each indicator's latest year. */
  year: string | null;
  /** School year whose PWC program data is exported (the slider year). */
  pwcYear: string;
}

export interface SchoolExport {
  headers: string[];
  rows: Array<Array<string | number | null>>;
}

type Cell = string | number | null;

const AREA_NAME: Record<AggregationArea, string> = {
  school_district: 'school district',
  nta_2020: 'NTA',
};

const PWC_CATEGORY_LABEL: Record<PwcCategory, string> = {
  anchor: 'Anchor',
  both: 'Anchor + Healing Arts',
  healing_arts: 'Healing Arts',
  pwc_other: 'Other PWC',
};

/** Geo columns: layer → header (the area's name; NTA also gets a code column). */
const GEO_HEADER: Record<string, string> = {
  congressional: 'Congressional district',
  senate: 'NYS Senate district',
  assembly: 'NYS Assembly district',
  county: 'County',
  council: 'City Council district',
  school_district: 'School district',
  community_district: 'Community district',
  nta_2020: 'NTA name',
};

const round = (v: unknown, digits = 2): number | null => {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
const pct = (v: unknown): number | null => (v == null ? null : round(Number(v) * 100));
const yesNo = (v: boolean | null | undefined): string => (v ? 'Yes' : 'No');

interface IdentityRow {
  dbn: string;
  school_name: string | null;
  borough: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  grades: string | null;
  managed_by: string | null;
  location_category: string | null;
  location_type: string | null;
  community_school: string | null;
  beds_number: string | null;
  demo_year: string | null;
  total_enrollment: number | null;
  pct_poverty: number | null;
  economic_need_index: number | null;
  pct_english_language_learners: number | null;
  pct_students_with_disabilities: number | null;
  pct_asian: number | null;
  pct_black: number | null;
  pct_hispanic: number | null;
  pct_white: number | null;
  pct_multi_racial: number | null;
}

export async function getSchoolExport(opts: SchoolExportOptions): Promise<SchoolExport> {
  const { dbns, aggregationArea } = opts;
  const indicators = (await getActiveIndicatorsWithYears()).filter((i) => i.years.length > 0);
  const school = indicators.filter((i) => i.family === 'school');
  const community = indicators.filter((i) => i.family === 'community');

  const yearFor = (i: IndicatorPublic): string | null => {
    if (opts.year == null) return i.years[i.years.length - 1] ?? null;
    return i.family === 'school' ? opts.year : toCommunityYear(opts.year);
  };
  const schoolPairs = school.map((i) => [i.id, yearFor(i)] as const).filter((p): p is readonly [string, string] => p[1] != null);
  const communityPairs = community
    .map((i) => [i.id, yearFor(i)] as const)
    .filter((p): p is readonly [string, string] => p[1] != null);

  const [identity, geo, pwc, schoolVals, communityVals] = await Promise.all([
    sql<IdentityRow>`
      SELECT s.dbn, s.school_name, s.borough, s.address, s.latitude, s.longitude, s.grades,
             s.managed_by, s.location_category, s.location_type, s.community_school, s.beds_number,
             sy.school_year AS demo_year, sy.total_enrollment, sy.pct_poverty, sy.economic_need_index,
             sy.pct_english_language_learners, sy.pct_students_with_disabilities,
             sy.pct_asian, sy.pct_black, sy.pct_hispanic, sy.pct_white, sy.pct_multi_racial
      FROM schools s
      LEFT JOIN LATERAL (
        SELECT * FROM schools_year y
        WHERE y.dbn = s.dbn AND y.total_enrollment IS NOT NULL
        ORDER BY y.school_year DESC
        LIMIT 1
      ) sy ON true
      WHERE s.dbn = ANY(${dbns}::text[])
      ORDER BY s.school_name NULLS LAST, s.dbn
    `,
    sql<{ dbn: string; geo_layer: string; area_id: string; label: string | null }>`
      SELECT x.dbn, x.geo_layer, x.area_id, g.label
      FROM school_geo_crosswalk x
      LEFT JOIN geographies g ON g.geo_layer = x.geo_layer AND g.area_id = x.area_id
      WHERE x.dbn = ANY(${dbns}::text[])
    `,
    getPwcMembership(opts.pwcYear),
    sql<{ dbn: string; indicator_id: string; value_num: number | null; value_text: string | null }>`
      SELECT v.dbn, v.indicator_id, v.value_num, v.value_text
      FROM school_indicator_values v
      JOIN unnest(${schoolPairs.map((p) => p[0])}::text[], ${schoolPairs.map((p) => p[1])}::text[]) AS t(indicator_id, school_year)
        ON t.indicator_id = v.indicator_id AND t.school_year = v.school_year
      WHERE v.dbn = ANY(${dbns}::text[])
    `,
    sql<{ dbn: string; indicator_id: string; value_num: number | null; value_text: string | null }>`
      SELECT x1.dbn, civ.indicator_id,
             AVG(civ.value_num) AS value_num,
             mode() WITHIN GROUP (ORDER BY civ.value_text) AS value_text
      FROM school_geo_crosswalk x1
      JOIN area_tract_crosswalk x2
        ON x2.area_layer = ${aggregationArea} AND x2.area_id = x1.area_id
      JOIN community_indicator_values civ
        ON civ.geo_layer = 'tract' AND civ.area_id = x2.tract_geoid
      JOIN unnest(${communityPairs.map((p) => p[0])}::text[], ${communityPairs.map((p) => p[1])}::text[]) AS t(indicator_id, year)
        ON t.indicator_id = civ.indicator_id AND t.year = civ.year
      WHERE x1.geo_layer = ${aggregationArea} AND x1.dbn = ANY(${dbns}::text[])
      GROUP BY x1.dbn, civ.indicator_id
    `,
  ]);

  const key = (dbn: string, id: string): string => `${dbn}|${id}`;
  const geoBy = new Map(geo.map((g) => [key(g.dbn, g.geo_layer), g]));
  const pwcBy = new Map(pwc.members.map((m) => [m.dbn, m]));
  const schoolBy = new Map(schoolVals.map((v) => [key(v.dbn, v.indicator_id), v]));
  const communityBy = new Map(communityVals.map((v) => [key(v.dbn, v.indicator_id), v]));

  // School indicators whose rows carry text (safety rating, arts disciplines)
  // get a second column so nothing on the map is lost.
  const withText = new Set(schoolVals.filter((v) => v.value_text != null && v.value_text !== '').map((v) => v.indicator_id));

  const headers: string[] = [
    'DBN', 'School name', 'Borough', 'Address', 'Latitude', 'Longitude', 'Grades', 'Managed by',
    'Location category', 'Location type', 'NYC Community School (NYSED list)', 'BEDS number',
    'Demographics year', 'Enrollment', '% Poverty', 'Economic Need Index (%)', '% English language learners',
    '% Students with disabilities', '% Asian', '% Black', '% Hispanic', '% White', '% Multi-racial',
    `PWC school (${opts.pwcYear})`, 'PWC category', 'Anchor type', 'PWC cohort',
    'PWC social work', 'PWC community school program', 'PWC arts program', 'PWC OST program',
    'NTA code',
    ...GEO_FILTER_LAYERS.map((l) => GEO_HEADER[l.id]!),
  ];
  const valueCols: Array<(dbn: string) => Cell> = [];
  for (const i of school) {
    const y = yearFor(i);
    const name = i.short_label ?? i.label;
    headers.push(`${name} (${y ?? 'n/a'})`);
    valueCols.push((dbn) => round(schoolBy.get(key(dbn, i.id))?.value_num));
    if (withText.has(i.id)) {
      headers.push(`${name} - detail (${y ?? 'n/a'})`);
      valueCols.push((dbn) => schoolBy.get(key(dbn, i.id))?.value_text ?? null);
    }
  }
  for (const i of community) {
    const y = yearFor(i);
    const name = i.short_label ?? i.label;
    if (i.scale.type === 'categorical') {
      headers.push(`${name} - most common in ${AREA_NAME[aggregationArea]} (${y ?? 'n/a'})`);
      valueCols.push((dbn) => communityBy.get(key(dbn, i.id))?.value_text ?? null);
    } else {
      headers.push(`${name} - ${AREA_NAME[aggregationArea]} avg (${y ?? 'n/a'})`);
      valueCols.push((dbn) => round(communityBy.get(key(dbn, i.id))?.value_num));
    }
  }

  const rows = identity.map((s): Cell[] => {
    const m = pwcBy.get(s.dbn);
    const program = m ? anchorProgram(m) : null;
    const geoCell = (layer: string): Cell => {
      const g = geoBy.get(key(s.dbn, layer));
      if (!g) return null;
      // Congressional labels are the representative's name; lead with the
      // district number (DISTRICTID = state FIPS + 2-digit district).
      if (layer === 'congressional' && /^\d{4}$/.test(g.area_id)) {
        return `NY-${Number(g.area_id.slice(2))}${g.label ? ` (${g.label})` : ''}`;
      }
      return g.label ?? g.area_id;
    };
    return [
      s.dbn, s.school_name, s.borough, s.address, s.latitude, s.longitude, s.grades, s.managed_by,
      s.location_category, s.location_type,
      s.community_school == null ? null : String(s.community_school).includes('1') ? 'Yes' : 'No',
      s.beds_number,
      s.demo_year, s.total_enrollment, pct(s.pct_poverty), pct(s.economic_need_index),
      pct(s.pct_english_language_learners), pct(s.pct_students_with_disabilities),
      pct(s.pct_asian), pct(s.pct_black), pct(s.pct_hispanic), pct(s.pct_white), pct(s.pct_multi_racial),
      yesNo(!!m), m ? PWC_CATEGORY_LABEL[m.category] : null,
      program === 'community_school' ? 'Community School' : program === 'social_work' ? 'Social Work' : null,
      m?.cohort ?? null,
      m ? yesNo(m.social_work) : null, m ? yesNo(m.community_school) : null,
      m ? yesNo(m.arts_program) : null, m ? yesNo(m.ost) : null,
      geoBy.get(key(s.dbn, 'nta_2020'))?.area_id ?? null,
      ...GEO_FILTER_LAYERS.map((l) => geoCell(l.id)),
      ...valueCols.map((col) => col(s.dbn)),
    ];
  });
  return { headers, rows };
}
