/**
 * Characterization snapshot harness for the Phase 1-5 shared selectors.
 *
 * Locks the current outputs of `applyFilters` (filtered universe) and
 * `deriveAnalytics` (KPI / timeline / ranked list) plus the indicator-year
 * resolution + missing-year flags inferred per `<Shell/>`. The next refactor
 * pass MUST keep these snapshots byte-identical — that's the contract.
 *
 * Run:
 *   npm run snapshot:selectors
 *
 * Output: reports/selectors-snapshot.json (deterministic; safe to git-diff).
 *
 * Inputs are synthetic fixtures, not the live DB. The point isn't to assert
 * "what the production DB says today" — it's to lock the *pure-function
 * behaviour* of the selectors so a refactor can't quietly drift.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { applyFilters } from '../src/store/derived.js';
import { deriveAnalytics, deltaStatus } from '../src/store/analytics.js';
import { resolveActiveLayers } from '../src/store/activeLayers.js';
import { computePercentile } from '../src/store/percentile.js';
import {
  fromCommunityYear,
  SLIDER_YEARS,
  type SliderYear,
} from '../src/contract/year.js';
import type {
  AnalyticsSeriesRow,
  IndicatorPublic,
  PwcMember,
  SchoolMaster,
} from '../src/contract/types.js';
import type { SchoolType } from '../src/store/useHubStore.js';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const SCHOOLS: SchoolMaster[] = [
  // Brownsville cohort, school_district 23
  { dbn: 'DBN-01', school_name: 'P.S. One', borough: 'K', latitude: 40.66, longitude: -73.91, total_enrollment: 400, geos: { school_district: '23', council: '41', county: 'K' } },
  { dbn: 'DBN-02', school_name: 'P.S. Two', borough: 'K', latitude: 40.67, longitude: -73.92, total_enrollment: 350, geos: { school_district: '23', council: '41', county: 'K' } },
  { dbn: 'DBN-07', school_name: 'P.S. Seven', borough: 'K', latitude: 40.66, longitude: -73.92, total_enrollment: 200, geos: { school_district: '23', council: '41', county: 'K' } },
  // East Harlem cohort, school_district 4
  { dbn: 'DBN-03', school_name: 'P.S. Three', borough: 'M', latitude: 40.79, longitude: -73.94, total_enrollment: 500, geos: { school_district: '4', council: '8', county: 'M' } },
  { dbn: 'DBN-04', school_name: 'P.S. Four', borough: 'M', latitude: 40.80, longitude: -73.94, total_enrollment: 300, geos: { school_district: '4', council: '8', county: 'M' } },
  { dbn: 'DBN-08', school_name: 'P.S. Eight', borough: 'M', latitude: 40.79, longitude: -73.93, total_enrollment: 250, geos: { school_district: '4', council: '8', county: 'M' } },
  // Morrisania cohort, school_district 8
  { dbn: 'DBN-05', school_name: 'P.S. Five', borough: 'X', latitude: 40.83, longitude: -73.90, total_enrollment: 600, geos: { school_district: '8', council: '17', county: 'X' } },
  { dbn: 'DBN-09', school_name: 'P.S. Nine', borough: 'X', latitude: 40.83, longitude: -73.91, total_enrollment: 550, geos: { school_district: '8', council: '17', county: 'X' } },
  // Fort Greene cohort, school_district 13
  { dbn: 'DBN-06', school_name: 'P.S. Six', borough: 'K', latitude: 40.69, longitude: -73.97, total_enrollment: 450, geos: { school_district: '13', council: '35', county: 'K' } },
  { dbn: 'DBN-10', school_name: 'P.S. Ten', borough: 'K', latitude: 40.69, longitude: -73.98, total_enrollment: 300, geos: { school_district: '13', council: '35', county: 'K' } },
];

// PWC membership snapshots — by year. Note: DBN-03 is 'both' (anchor + healing
// arts), so it must pass either the Anchor or Healing Arts School Type filter
// AND show in both KPI cells. DBN-04 is 'pwc_other'.
function pwcSnapshot(year: SliderYear | '2025-26'): PwcMember[] {
  // Keep membership stable across years for snapshot determinism. A real
  // refactor that broke the per-year membership lookup would still surface
  // through deltas in `deriveAnalytics` because the loops re-resolve.
  void year;
  return [
    { dbn: 'DBN-01', category: 'anchor',       cohort: 'Brownsville' },
    { dbn: 'DBN-02', category: 'healing_arts', cohort: 'Brownsville' },
    { dbn: 'DBN-03', category: 'both',         cohort: 'East Harlem' },
    { dbn: 'DBN-04', category: 'pwc_other',    cohort: 'East Harlem' },
    { dbn: 'DBN-05', category: 'anchor',       cohort: 'Morrisania' },
    { dbn: 'DBN-06', category: 'healing_arts', cohort: 'Fort Greene' },
  ];
}

const ALL_COHORTS = ['Brownsville', 'East Harlem', 'Fort Greene', 'Morrisania'];

/* Indicators — minimal IndicatorPublic shape, enough for the selectors. */
const math: IndicatorPublic = {
  id: 'math_proficiency',
  family: 'school',
  theme: 'Student Outcomes',
  label: 'Math proficiency',
  format: 'percent',
  scale: { type: 'diverging', good_direction: 'high' },
  geometry: 'point',
  years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
  source_description: 'fixture',
};
const suspensions: IndicatorPublic = {
  id: 'suspension_rate',
  family: 'school',
  theme: 'Student Experience',
  label: 'Suspension rate',
  format: 'rate_per_100',
  scale: { type: 'diverging', good_direction: 'low' },
  geometry: 'point',
  years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
  source_description: 'fixture',
};
const artsEd: IndicatorPublic = {
  id: 'arts_ed_score',
  family: 'school',
  theme: 'Student Experience',
  label: 'Arts education',
  format: 'integer',
  scale: { type: 'diverging', good_direction: 'high' },
  geometry: 'point',
  // Discontinuous — only two years. Triggers the missing-year case for 2022-23.
  years: ['2020-21', '2024-25'],
  source_description: 'fixture',
};
const childPoverty: IndicatorPublic = {
  id: 'child_poverty',
  family: 'community',
  theme: 'Economic Conditions',
  label: 'Child poverty',
  format: 'percent',
  scale: { type: 'sequential', good_direction: 'low' },
  geometry: 'polygon',
  // Calendar years from ACS — slider mapping makes 2021 the only "data" stop
  // inside the slider for snapshot purposes.
  years: ['2021', '2022', '2023'],
  source_description: 'fixture',
};

/* Fixed value tables — deterministic per (indicator, year, dbn). */
function seriesFor(indicatorId: string): AnalyticsSeriesRow[] {
  if (indicatorId === 'math_proficiency') {
    // higher = better. DBN-04 deliberately null in 2024-25 to exercise null skip.
    const TABLE: Record<string, Record<string, number | null>> = {
      '2020-21': { 'DBN-01': 28, 'DBN-02': 33, 'DBN-03': 52, 'DBN-04': 41, 'DBN-05': 47, 'DBN-06': 55, 'DBN-07': 30, 'DBN-08': 39, 'DBN-09': 50, 'DBN-10': 58 },
      '2021-22': { 'DBN-01': 30, 'DBN-02': 34, 'DBN-03': 53, 'DBN-04': 42, 'DBN-05': 46, 'DBN-06': 56, 'DBN-07': 31, 'DBN-08': 40, 'DBN-09': 51, 'DBN-10': 59 },
      '2022-23': { 'DBN-01': 32, 'DBN-02': 36, 'DBN-03': 55, 'DBN-04': 43, 'DBN-05': 48, 'DBN-06': 57, 'DBN-07': 33, 'DBN-08': 41, 'DBN-09': 52, 'DBN-10': 60 },
      '2023-24': { 'DBN-01': 35, 'DBN-02': 38, 'DBN-03': 56, 'DBN-04': 44, 'DBN-05': 50, 'DBN-06': 58, 'DBN-07': 36, 'DBN-08': 42, 'DBN-09': 53, 'DBN-10': 61 },
      '2024-25': { 'DBN-01': 38, 'DBN-02': 40, 'DBN-03': 58, 'DBN-04': null, 'DBN-05': 51, 'DBN-06': 59, 'DBN-07': 37, 'DBN-08': 43, 'DBN-09': 54, 'DBN-10': 62 },
    };
    return rowsFromTable(TABLE);
  }
  if (indicatorId === 'suspension_rate') {
    // lower = better. Notice DBN-05 has high suspension (= "worse" given low-is-good).
    const TABLE: Record<string, Record<string, number | null>> = {
      '2020-21': { 'DBN-01': 6.2, 'DBN-02': 4.0, 'DBN-03': 3.1, 'DBN-04': 5.5, 'DBN-05': 9.8, 'DBN-06': 2.4, 'DBN-07': 7.0, 'DBN-08': 5.0, 'DBN-09': 4.3, 'DBN-10': 2.0 },
      '2021-22': { 'DBN-01': 5.9, 'DBN-02': 4.1, 'DBN-03': 3.0, 'DBN-04': 5.6, 'DBN-05': 9.5, 'DBN-06': 2.5, 'DBN-07': 7.1, 'DBN-08': 4.9, 'DBN-09': 4.4, 'DBN-10': 2.1 },
      '2022-23': { 'DBN-01': 5.7, 'DBN-02': 4.2, 'DBN-03': 2.9, 'DBN-04': 5.4, 'DBN-05': 9.2, 'DBN-06': 2.6, 'DBN-07': 7.0, 'DBN-08': 4.8, 'DBN-09': 4.2, 'DBN-10': 2.0 },
      '2023-24': { 'DBN-01': 5.5, 'DBN-02': 4.0, 'DBN-03': 2.8, 'DBN-04': 5.2, 'DBN-05': 8.9, 'DBN-06': 2.5, 'DBN-07': 6.9, 'DBN-08': 4.7, 'DBN-09': 4.0, 'DBN-10': 1.9 },
      '2024-25': { 'DBN-01': 5.3, 'DBN-02': 3.8, 'DBN-03': 2.7, 'DBN-04': 5.0, 'DBN-05': 8.6, 'DBN-06': 2.4, 'DBN-07': 6.8, 'DBN-08': 4.6, 'DBN-09': 3.9, 'DBN-10': 1.8 },
    };
    return rowsFromTable(TABLE);
  }
  if (indicatorId === 'arts_ed_score') {
    // Discrete 0-4. Discontinuous coverage: only 2020-21 and 2024-25.
    const TABLE: Record<string, Record<string, number | null>> = {
      '2020-21': { 'DBN-01': 2, 'DBN-02': 3, 'DBN-03': 4, 'DBN-04': 2, 'DBN-05': 1, 'DBN-06': 4, 'DBN-07': 2, 'DBN-08': 2, 'DBN-09': 1, 'DBN-10': 3 },
      '2024-25': { 'DBN-01': 3, 'DBN-02': 3, 'DBN-03': 4, 'DBN-04': 2, 'DBN-05': 2, 'DBN-06': 4, 'DBN-07': 2, 'DBN-08': 3, 'DBN-09': 2, 'DBN-10': 3 },
    };
    return rowsFromTable(TABLE);
  }
  if (indicatorId === 'child_poverty') {
    // Community series — calendar years. Shell normalizes via fromCommunityYear
    // before passing into deriveAnalytics; mirror that here so the snapshot
    // reflects what the panel actually consumes.
    const TABLE_CAL: Record<string, Record<string, number | null>> = {
      // After fromCommunityYear: 2021 -> 2020-21, 2022 -> 2021-22, 2023 -> 2022-23
      '2021': { 'DBN-01': 38, 'DBN-02': 36, 'DBN-03': 22, 'DBN-04': 24, 'DBN-05': 30, 'DBN-06': 18, 'DBN-07': 39, 'DBN-08': 25, 'DBN-09': 29, 'DBN-10': 17 },
      '2022': { 'DBN-01': 37, 'DBN-02': 35, 'DBN-03': 21, 'DBN-04': 23, 'DBN-05': 29, 'DBN-06': 17, 'DBN-07': 38, 'DBN-08': 24, 'DBN-09': 28, 'DBN-10': 16 },
      '2023': { 'DBN-01': 36, 'DBN-02': 34, 'DBN-03': 20, 'DBN-04': 22, 'DBN-05': 28, 'DBN-06': 16, 'DBN-07': 37, 'DBN-08': 23, 'DBN-09': 27, 'DBN-10': 15 },
    };
    const out: AnalyticsSeriesRow[] = [];
    for (const [calYear, perSchool] of Object.entries(TABLE_CAL)) {
      const sy = fromCommunityYear(calYear);
      if (!sy) continue;
      for (const [dbn, value_num] of Object.entries(perSchool)) {
        out.push({ dbn, year: sy, value_num, value_text: null, label: null });
      }
    }
    return out;
  }
  return [];
}

function rowsFromTable(table: Record<string, Record<string, number | null>>): AnalyticsSeriesRow[] {
  const out: AnalyticsSeriesRow[] = [];
  for (const [year, perSchool] of Object.entries(table)) {
    for (const [dbn, value_num] of Object.entries(perSchool)) {
      out.push({ dbn, year, value_num, value_text: null, label: null });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Snapshot                                                                   */
/* -------------------------------------------------------------------------- */

interface FilterState {
  name: string;
  geoFilters: Record<string, string[]>;
  schoolType: SchoolType;
  cohort: string | null;
}

const FILTER_STATES: FilterState[] = [
  { name: 'defaults', geoFilters: {}, schoolType: 'all', cohort: null },
  { name: 'anchor+Brownsville', geoFilters: {}, schoolType: 'anchor', cohort: 'Brownsville' },
];

const SCHOOL_INDICATORS = [math, suspensions, artsEd];
const COMMUNITY_INDICATORS = [childPoverty];
const SNAP_YEARS: SliderYear[] = ['2024-25', '2022-23'];

/** Snapshot-shaped view of one layer state produced by `resolveActiveLayers`.
 *  Picks the family-relevant LayerState so the per-combo snapshot keeps the
 *  same JSON shape as the pre-refactor harness (byte-identical golden file). */
function layerYearState(
  indicator: IndicatorPublic | null,
  sliderYear: SliderYear,
): { displayYear: string | null; noData: boolean; available: SliderYear[]; nearest: SliderYear | null } {
  if (!indicator) return { displayYear: null, noData: false, available: [], nearest: null };
  const layers = resolveActiveLayers({
    schoolIndicator: indicator.family === 'school' ? indicator : null,
    communityIndicator: indicator.family === 'community' ? indicator : null,
    sliderYear,
    analyticsFamilyPref: 'school',
    schoolFeatureCount: null,
    communityValueCount: null,
  });
  const layer = indicator.family === 'school' ? layers.school : layers.community;
  if (!layer) return { displayYear: null, noData: false, available: [], nearest: null };
  return {
    displayYear: layer.displayYear,
    noData: layer.noData,
    available: layer.available,
    nearest: layer.nearest,
  };
}

interface UniverseSnap {
  schoolDbns: string[];
  afterGeo: string[];
  afterSchoolType: string[];
  cohortOptions: Array<{ cohort: string; count: number }>;
  prefilterSummary: { forSchoolType: string | null; forCohort: string | null; forSchool: string | null };
}

interface AnalyticsSnap {
  kpis: {
    pwc: { n: number; avg: number | null; delta: number | null; status: string };
    citywide: { n: number; avg: number | null };
    all: { n: number; avg: number | null };
  };
  timeline: Array<{
    year: string;
    pwc: number | null;
    anchor: number | null;
    healing_arts: number | null;
    allInView: number | null;
    citywide: number | null;
  }>;
  /** Top 5 ranked rows — DBN + category + latestValue. */
  topList: Array<{ rank: number; dbn: string; category: string; latestValue: number | null }>;
  /** Full ranked-list order (DBN only) so the user can spot order changes. */
  fullOrder: string[];
}

interface PerCombo {
  indicator: string;
  family: 'school' | 'community';
  year: SliderYear;
  filterState: string;
  layerYearState: ReturnType<typeof layerYearState>;
  universe: UniverseSnap;
  analytics: AnalyticsSnap;
}

function round(x: number | null, decimals = 4): number | null {
  if (x == null) return null;
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

function snapUniverse(state: FilterState): UniverseSnap {
  const u = applyFilters({
    state: {
      // Cast the geoFilters fixture to GeoFilterMap shape — our fixtures don't
      // actually exercise the Geo layer here (the two filter states focus on
      // School Type + Cohort).
      geoFilters: state.geoFilters,
      schoolType: state.schoolType,
      cohort: state.cohort,
    },
    schoolsMaster: SCHOOLS,
    pwcMembers: pwcSnapshot('2024-25'),
    allCohorts: ALL_COHORTS,
  });
  return {
    schoolDbns: [...u.schoolDbns].sort(),
    afterGeo: [...u.afterGeo].sort(),
    afterSchoolType: [...u.afterSchoolType].sort(),
    cohortOptions: u.cohortOptions,
    prefilterSummary: u.prefilterSummary,
  };
}

function snapAnalytics(indicator: IndicatorPublic, year: SliderYear, state: FilterState): AnalyticsSnap {
  const u = applyFilters({
    state: { geoFilters: state.geoFilters, schoolType: state.schoolType, cohort: state.cohort },
    schoolsMaster: SCHOOLS,
    pwcMembers: pwcSnapshot('2024-25'),
    allCohorts: ALL_COHORTS,
  });
  // Per-year membership map. We hold membership steady across the slider
  // years for fixture stability — `deriveAnalytics` still does the per-year
  // lookup it would do in production.
  const pwcByYear: Record<string, PwcMember[]> = {};
  for (const y of SLIDER_YEARS) pwcByYear[y] = pwcSnapshot(y);
  const a = deriveAnalytics({
    indicator,
    year,
    series: seriesFor(indicator.id),
    pwcByYear,
    universe: u,
    timelineYears: SLIDER_YEARS,
  });
  return {
    kpis: {
      pwc: {
        n: a.kpis.pwc.n,
        avg: round(a.kpis.pwc.avg),
        delta: round(a.kpis.pwc.delta),
        status: deltaStatus(a.kpis.pwc.delta, indicator.scale.good_direction),
      },
      citywide: { n: a.kpis.citywide.n, avg: round(a.kpis.citywide.avg) },
      all: { n: a.kpis.all.n, avg: round(a.kpis.all.avg) },
    },
    timeline: a.timeline.map((p) => ({
      year: p.year,
      pwc: round(p.pwc.avg),
      anchor: round(p.anchor.avg),
      healing_arts: round(p.healing_arts.avg),
      allInView: round(p.allInView.avg),
      citywide: round(p.citywide.avg),
    })),
    topList: a.list.slice(0, 5).map((r, i) => ({
      rank: i + 1,
      dbn: r.dbn,
      category: r.category,
      latestValue: round(r.latestValue),
    })),
    fullOrder: a.list.map((r) => r.dbn),
  };
}

const combos: PerCombo[] = [];
for (const ind of [...SCHOOL_INDICATORS, ...COMMUNITY_INDICATORS]) {
  for (const y of SNAP_YEARS) {
    for (const st of FILTER_STATES) {
      combos.push({
        indicator: ind.id,
        family: ind.family,
        year: y,
        filterState: st.name,
        layerYearState: layerYearState(ind, y),
        universe: snapUniverse(st),
        analytics: snapAnalytics(ind, y, st),
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Percentile snapshots (School Detail Panel §1.a)                            */
/* -------------------------------------------------------------------------- */

interface PercentileCase {
  name: string;
  indicator: string;
  year: SliderYear;
  filterState: string;
  selectedDbn: string;
}

const PERCENTILE_CASES: PercentileCase[] = [
  { name: 'math high-good, DBN-01 in defaults', indicator: 'math_proficiency', year: '2024-25', filterState: 'defaults', selectedDbn: 'DBN-01' },
  { name: 'math high-good, DBN-10 (best) in defaults', indicator: 'math_proficiency', year: '2024-25', filterState: 'defaults', selectedDbn: 'DBN-10' },
  { name: 'suspensions low-good, DBN-05 (worst) in defaults', indicator: 'suspension_rate', year: '2024-25', filterState: 'defaults', selectedDbn: 'DBN-05' },
  { name: 'child poverty community, DBN-03 @ 2022-23', indicator: 'child_poverty', year: '2022-23', filterState: 'defaults', selectedDbn: 'DBN-03' },
  { name: 'math 2024-25, DBN-01 in anchor+Brownsville (cohort=1)', indicator: 'math_proficiency', year: '2024-25', filterState: 'anchor+Brownsville', selectedDbn: 'DBN-01' },
  { name: 'arts_ed_score 2022-23 (missing year), DBN-01 in defaults', indicator: 'arts_ed_score', year: '2022-23', filterState: 'defaults', selectedDbn: 'DBN-01' },
];

const indicatorById: Record<string, IndicatorPublic> = {
  math_proficiency: math,
  suspension_rate: suspensions,
  arts_ed_score: artsEd,
  child_poverty: childPoverty,
};

const percentiles = PERCENTILE_CASES.map((c) => {
  const ind = indicatorById[c.indicator]!;
  const fs = FILTER_STATES.find((s) => s.name === c.filterState)!;
  const u = applyFilters({
    state: { geoFilters: fs.geoFilters, schoolType: fs.schoolType, cohort: fs.cohort },
    schoolsMaster: SCHOOLS,
    pwcMembers: pwcSnapshot('2024-25'),
    allCohorts: ALL_COHORTS,
  });
  const result = computePercentile({
    series: seriesFor(ind.id),
    year: c.year,
    universeDbns: u.schoolDbns,
    selectedDbn: c.selectedDbn,
    goodDirection: ind.scale.good_direction,
  });
  return {
    case: c.name,
    indicator: c.indicator,
    year: c.year,
    filterState: c.filterState,
    selectedDbn: c.selectedDbn,
    selfValue: round(result.selfValue),
    rank: result.rank,
    cohortSize: result.cohortSize,
    betterThanFraction: round(result.betterThanFraction),
    cohortValues: result.cohortValues.map((v) => round(v)),
    callout: result.callout,
  };
});

const out = {
  generated_at: '2026-06-01',
  fixture_version: 2,
  schools: SCHOOLS.length,
  pwc_members: pwcSnapshot('2024-25').length,
  filter_states: FILTER_STATES.map((s) => s.name),
  years: SNAP_YEARS,
  indicators: combos.map((c) => c.indicator).filter((v, i, a) => a.indexOf(v) === i),
  combos,
  percentiles,
};

const outPath = resolve('reports/selectors-snapshot.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`wrote ${outPath}`);
console.log(`combos: ${combos.length}`);
