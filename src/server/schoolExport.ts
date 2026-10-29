/**
 * School-level data export — one row per school × school year for every
 * school in the dashboard's filtered universe: identity, that year's
 * demographics and PWC program data, geo assignments, every school indicator
 * and every community indicator (averaged over the school's area — District
 * or NTA, per the toggle).
 *
 * Set-based reads only, all against precomputed tables (spec §11.9 — no
 * point-in-polygon at request time):
 *   1. schools                                     (identity)
 *   2. schools_year                                (demographics per year)
 *   3. school_geo_crosswalk ⨝ geographies          (area ids + names)
 *   4. getPwcMembership(year) for every PWC year   (PWC flags / category)
 *   5. school_indicator_values for (indicator, year) pairs
 *   6. the getAnalyticsSeries community aggregation, generalized to every
 *      community indicator; categorical ones (racial predominance) export
 *      the most common category across the area's tracts.
 *
 * Years: a school gets a row for each school year in which it has
 * demographics, a school indicator value or a PWC program row. Community
 * values join on the year's spring half (toCommunityYear), as on the map.
 */

import { sql } from './db';
import { getActiveIndicatorsWithYears, getPwcMembership } from './contract';
import { toCommunityYear } from '../contract/year';
import { sortSchoolYears } from '../lib/schoolYear';
import { anchorProgram } from '../store/pwcGroups';
import { GEO_FILTER_LAYERS, type AggregationArea, type IndicatorPublic, type PwcCategory, type PwcMember } from '../contract/types';

export interface SchoolExportOptions {
  dbns: string[];
  aggregationArea: AggregationArea;
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
}

interface DemographicsRow {
  dbn: string;
  school_year: string;
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

interface ValueRow {
  dbn: string;
  indicator_id: string;
  year: string;
  value_num: number | null;
  value_text: string | null;
}

export async function getSchoolExport(opts: SchoolExportOptions): Promise<SchoolExport> {
  const { dbns, aggregationArea } = opts;
  const indicators = (await getActiveIndicatorsWithYears()).filter((i) => i.years.length > 0);
  const school = indicators.filter((i) => i.family === 'school');
  const community = indicators.filter((i) => i.family === 'community');

  const pairsOf = (list: IndicatorPublic[]): { ids: string[]; years: string[] } => {
    const pairs = list.flatMap((i) => i.years.map((y) => [i.id, y] as const));
    return { ids: pairs.map((p) => p[0]), years: pairs.map((p) => p[1]) };
  };
  const schoolPairs = pairsOf(school);
  const communityPairs = pairsOf(community);

  const [identity, demographics, geo, pwcYears, schoolVals, communityVals] = await Promise.all([
    sql<IdentityRow>`
      SELECT s.dbn, s.school_name, s.borough, s.address, s.latitude, s.longitude, s.grades,
             s.managed_by, s.location_category, s.location_type, s.community_school, s.beds_number
      FROM schools s
      WHERE s.dbn = ANY(${dbns}::text[])
      ORDER BY s.school_name NULLS LAST, s.dbn
    `,
    sql<DemographicsRow>`
      SELECT y.dbn, y.school_year, y.total_enrollment, y.pct_poverty, y.economic_need_index,
             y.pct_english_language_learners, y.pct_students_with_disabilities,
             y.pct_asian, y.pct_black, y.pct_hispanic, y.pct_white, y.pct_multi_racial
      FROM schools_year y
      WHERE y.dbn = ANY(${dbns}::text[]) AND y.total_enrollment IS NOT NULL
    `,
    sql<{ dbn: string; geo_layer: string; area_id: string; label: string | null }>`
      SELECT x.dbn, x.geo_layer, x.area_id, g.label
      FROM school_geo_crosswalk x
      LEFT JOIN geographies g ON g.geo_layer = x.geo_layer AND g.area_id = x.area_id
      WHERE x.dbn = ANY(${dbns}::text[])
    `,
    sql<{ school_year: string }>`SELECT DISTINCT school_year FROM pwc_school_program`,
    sql<ValueRow>`
      SELECT v.dbn, v.indicator_id, v.school_year AS year, v.value_num, v.value_text
      FROM school_indicator_values v
      JOIN unnest(${schoolPairs.ids}::text[], ${schoolPairs.years}::text[]) AS t(indicator_id, school_year)
        ON t.indicator_id = v.indicator_id AND t.school_year = v.school_year
      WHERE v.dbn = ANY(${dbns}::text[])
    `,
    sql<ValueRow>`
      SELECT x1.dbn, civ.indicator_id, civ.year,
             AVG(civ.value_num) AS value_num,
             mode() WITHIN GROUP (ORDER BY civ.value_text) AS value_text
      FROM school_geo_crosswalk x1
      JOIN area_tract_crosswalk x2
        ON x2.area_layer = ${aggregationArea} AND x2.area_id = x1.area_id
      JOIN community_indicator_values civ
        ON civ.geo_layer = 'tract' AND civ.area_id = x2.tract_geoid
      JOIN unnest(${communityPairs.ids}::text[], ${communityPairs.years}::text[]) AS t(indicator_id, year)
        ON t.indicator_id = civ.indicator_id AND t.year = civ.year
      WHERE x1.geo_layer = ${aggregationArea} AND x1.dbn = ANY(${dbns}::text[])
      GROUP BY x1.dbn, civ.indicator_id, civ.year
    `,
  ]);
  const pwc = await Promise.all(pwcYears.map((r) => getPwcMembership(r.school_year)));

  const key = (...parts: string[]): string => parts.join('|');
  const geoBy = new Map(geo.map((g) => [key(g.dbn, g.geo_layer), g]));
  const demoBy = new Map(demographics.map((d) => [key(d.dbn, d.school_year), d]));
  const pwcBy = new Map<string, PwcMember>();
  for (const p of pwc) for (const m of p.members) pwcBy.set(key(m.dbn, p.year), m);
  const schoolBy = new Map(schoolVals.map((v) => [key(v.dbn, v.indicator_id, v.year), v]));
  const communityBy = new Map(communityVals.map((v) => [key(v.dbn, v.indicator_id, v.year), v]));

  // A school's years = every year with school-side data (community values
  // exist for every school every year, so they don't create rows).
  const yearsBy = new Map<string, Set<string>>();
  const addYear = (dbn: string, year: string): void => {
    const set = yearsBy.get(dbn) ?? new Set<string>();
    set.add(year);
    yearsBy.set(dbn, set);
  };
  for (const d of demographics) addYear(d.dbn, d.school_year);
  for (const v of schoolVals) addYear(v.dbn, v.year);
  for (const p of pwc) for (const m of p.members) addYear(m.dbn, p.year);

  // School indicators whose rows carry text (safety rating, arts disciplines)
  // get a second column so nothing on the map is lost.
  const withText = new Set(schoolVals.filter((v) => v.value_text != null && v.value_text !== '').map((v) => v.indicator_id));

  const headers: string[] = [
    'DBN', 'School name', 'School year', 'Community data year', 'Borough', 'Address', 'Latitude', 'Longitude',
    'Grades', 'Managed by', 'Location category', 'Location type', 'NYC Community School (NYSED list)', 'BEDS number',
    'Enrollment', '% Poverty', 'Economic Need Index (%)', '% English language learners',
    '% Students with disabilities', '% Asian', '% Black', '% Hispanic', '% White', '% Multi-racial',
    'PWC school', 'PWC category', 'Anchor type', 'PWC cohort',
    'PWC social work', 'PWC community school program', 'PWC arts program', 'PWC OST program',
    'NTA code',
    ...GEO_FILTER_LAYERS.map((l) => GEO_HEADER[l.id]!),
  ];
  const valueCols: Array<(dbn: string, year: string, communityYear: string | null) => Cell> = [];
  for (const i of school) {
    const name = i.short_label ?? i.label;
    headers.push(name);
    valueCols.push((dbn, y) => round(schoolBy.get(key(dbn, i.id, y))?.value_num));
    if (withText.has(i.id)) {
      headers.push(`${name} - detail`);
      valueCols.push((dbn, y) => schoolBy.get(key(dbn, i.id, y))?.value_text ?? null);
    }
  }
  for (const i of community) {
    const name = i.short_label ?? i.label;
    if (i.scale.type === 'categorical') {
      headers.push(`${name} - most common in ${AREA_NAME[aggregationArea]}`);
      valueCols.push((dbn, _y, cy) => (cy ? communityBy.get(key(dbn, i.id, cy))?.value_text ?? null : null));
    } else {
      headers.push(`${name} - ${AREA_NAME[aggregationArea]} avg`);
      valueCols.push((dbn, _y, cy) => (cy ? round(communityBy.get(key(dbn, i.id, cy))?.value_num) : null));
    }
  }

  const rows = identity.flatMap((s): Cell[][] => {
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
    const geoCells = GEO_FILTER_LAYERS.map((l) => geoCell(l.id));
    const ntaCode = geoBy.get(key(s.dbn, 'nta_2020'))?.area_id ?? null;
    const communitySchool = s.community_school == null ? null : String(s.community_school).includes('1') ? 'Yes' : 'No';

    return sortSchoolYears([...(yearsBy.get(s.dbn) ?? [])]).map((year): Cell[] => {
      const communityYear = toCommunityYear(year);
      const d = demoBy.get(key(s.dbn, year));
      const m = pwcBy.get(key(s.dbn, year));
      const program = m ? anchorProgram(m) : null;
      return [
        s.dbn, s.school_name, year, communityYear, s.borough, s.address, s.latitude, s.longitude, s.grades,
        s.managed_by, s.location_category, s.location_type, communitySchool, s.beds_number,
        d?.total_enrollment ?? null, pct(d?.pct_poverty), pct(d?.economic_need_index),
        pct(d?.pct_english_language_learners), pct(d?.pct_students_with_disabilities),
        pct(d?.pct_asian), pct(d?.pct_black), pct(d?.pct_hispanic), pct(d?.pct_white), pct(d?.pct_multi_racial),
        yesNo(!!m), m ? PWC_CATEGORY_LABEL[m.category] : null,
        program === 'community_school' ? 'Community School' : program === 'social_work' ? 'Social Work' : null,
        m?.cohort ?? null,
        m ? yesNo(m.social_work) : null, m ? yesNo(m.community_school) : null,
        m ? yesNo(m.arts_program) : null, m ? yesNo(m.ost) : null,
        ntaCode,
        ...geoCells,
        ...valueCols.map((col) => col(s.dbn, year, communityYear)),
      ];
    });
  });
  return { headers, rows };
}
