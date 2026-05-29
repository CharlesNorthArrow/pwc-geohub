/**
 * Indicator registry — spec §3.2 (school) and §3.3 (community).
 *
 * Adding or removing an indicator is a registry edit. The ETL loops over
 * entries with `source.type === 'hosted'` to ingest school indicators; the
 * ACS/CDC clients loop over `family === 'community'` entries.
 *
 * Q1 default applied: Anchor=core_school=1, Healing Arts=arts_program=1 — not
 * surfaced here (PWC program columns live in pwc_school_program, not in the
 * indicator contract).
 *
 * Q3 default applied: `safety_climate` is wired to the numeric
 * `safety_pct_positive` for the gradient; the categorical rating is kept on
 * the side via `categorical_field` for tooltip use later.
 *
 * Q4 default applied: graduation source uses `cohort_year`; ETL maps it to
 * `school_year` (cohort 2012 → 2015-16, etc.).
 */

import type { IndicatorRegistryEntry } from './types.js';

/* -------------------------------------------------------------------------- */
/* School indicators — hosted, point layer                                    */
/* -------------------------------------------------------------------------- */

const SCHOOL_INDICATORS: IndicatorRegistryEntry[] = [
  {
    id: 'arts_ed_score',
    family: 'school',
    theme: 'Educational Enrichment',
    label: 'Arts education access (# disciplines, 0–4)',
    source: {
      type: 'hosted',
      dataset: 'arts_ed.csv',
      value_field: 'arts_ed_score',
      label_field: 'arts_ed_score_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'integer',
    scale: { type: 'sequential', good_direction: 'high', ramp: 'viridis' },
    geometry: 'point',
    // Discontinuous — only these two years exist. Spec §3.2 #1.
    years: ['2020-21', '2024-25'],
    status: 'active',
    notes: 'Discontinuous: gap years must show "Data not available".',
  },
  {
    id: 'suspension_rate',
    family: 'school',
    theme: 'Student Demographics & Equity',
    label: 'Suspension / disciplinary rate (per 100)',
    source: {
      type: 'hosted',
      dataset: 'suspensions.csv',
      value_field: 'suspension_rate',
      label_field: 'suspension_rate_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'rate_per_100',
    scale: { type: 'sequential', good_direction: 'low', ramp: 'rocket_r' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
    notes: '"R" redactions and "Data suppressed" labels → null.',
  },
  {
    id: 'temp_housing_rate',
    family: 'school',
    theme: 'Student Demographics & Equity',
    label: '% students in temporary housing',
    source: {
      type: 'hosted',
      dataset: 'temp_housing.csv',
      value_field: 'temp_housing_rate',
      label_field: 'temp_housing_rate_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'low', ramp: 'rocket_r' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  {
    id: 'math_proficiency',
    family: 'school',
    theme: 'Academic Outcomes',
    label: 'Math proficiency (gr 3–8, % L3+4)',
    source: {
      type: 'hosted',
      dataset: 'math.csv',
      value_field: 'math_pct_proficient',
      label_field: 'math_pct_proficient_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'high', ramp: 'viridis' },
    geometry: 'point',
    years: ['2017-18', '2018-19', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
    notes: '2019-20 is COVID-year null. Deeper history than the 5-yr window.',
  },
  {
    id: 'ela_proficiency',
    family: 'school',
    theme: 'Academic Outcomes',
    label: 'ELA proficiency (gr 3–8, % L3+4)',
    source: {
      type: 'hosted',
      dataset: 'ela.csv',
      value_field: 'ela_pct_proficient',
      label_field: 'ela_pct_proficient_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'high', ramp: 'viridis' },
    geometry: 'point',
    years: ['2017-18', '2018-19', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  {
    id: 'chronic_absent_rate',
    family: 'school',
    theme: 'Academic Outcomes',
    label: 'Chronic absenteeism rate',
    source: {
      type: 'hosted',
      dataset: 'chronic_absenteeism.csv',
      value_field: 'chronic_absent_rate',
      label_field: 'chronic_absent_rate_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'low', ramp: 'rocket_r' },
    geometry: 'point',
    years: ['2018-19', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  {
    id: 'graduation_rate',
    family: 'school',
    theme: 'Academic Outcomes',
    label: '4-yr HS graduation rate',
    source: {
      type: 'hosted',
      dataset: 'graduation.csv',
      value_field: 'graduation_rate',
      label_field: 'graduation_rate_label',
      key: 'dbn',
      year_field: 'cohort_year',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'high', ramp: 'viridis' },
    geometry: 'point',
    // ETL maps cohort_year → school_year (e.g., 2012 → '2015-16'); years here
    // are the school_year values that will land in the contract.
    years: ['2015-16', '2016-17', '2017-18', '2018-19', '2019-20', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
    notes: 'HS only; non-HS schools = "n/a" (§12 Q4 default).',
  },
  {
    id: 'safety_climate',
    family: 'school',
    theme: 'Strengthening Support Network',
    label: 'Safety & school climate (% positive)',
    source: {
      type: 'hosted',
      dataset: 'school_quality.csv',
      value_field: 'safety_pct_positive',
      label_field: 'safety_pct_positive_label',
      key: 'dbn',
      year_field: 'school_year',
      // Categorical sibling field — kept available for tooltip use later.
      categorical_field: 'safety_climate_rating',
      categorical_label_field: 'safety_climate_rating_label',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'high', ramp: 'viridis' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
    notes: 'Q3 default: numeric pct_positive drives the gradient; rating in tooltip.',
  },
  {
    id: 'family_q36_satisfied',
    family: 'school',
    theme: 'Strengthening Support Network',
    label: 'Family satisfaction with education (q36)',
    source: {
      type: 'hosted',
      dataset: 'family_survey.csv',
      value_field: 'family_q36_pct_satisfied',
      label_field: 'family_q36_pct_satisfied_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'high', ramp: 'viridis' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  {
    id: 'teacher_q120_supports',
    family: 'school',
    theme: 'Strengthening Support Network',
    label: 'Teacher: access to behavioral supports (q120)',
    source: {
      type: 'hosted',
      dataset: 'teacher_survey.csv',
      value_field: 'teacher_q120_access_supports',
      label_field: 'teacher_q120_access_supports_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'high', ramp: 'viridis' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  {
    id: 'student_q20_mental_health',
    family: 'school',
    theme: 'Health',
    label: 'Student: knows where to go for mental-health support (q20)',
    source: {
      type: 'hosted',
      dataset: 'student_survey.csv',
      value_field: 'student_q20_mental_health',
      label_field: 'student_q20_mental_health_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'high', ramp: 'viridis' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  {
    id: 'student_q22_felt_happy',
    family: 'school',
    theme: 'Health',
    label: 'Student: felt happy at school (q22)',
    source: {
      type: 'hosted',
      dataset: 'student_survey.csv',
      value_field: 'student_q22_felt_happy',
      label_field: 'student_q22_felt_happy_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'high', ramp: 'viridis' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  /* --- "Maybe" candidate from §3.2 footnote — kept enabled so the Phase 0
     acceptance test (registry-only add) is demonstrated by the initial ETL run. */
  {
    id: 'teacher_q119_disruptive_sel',
    family: 'school',
    theme: 'Strengthening Support Network',
    label: 'Teacher: recognizes disruptive behavior as SEL opportunity (q119)',
    source: {
      type: 'hosted',
      dataset: 'teacher_survey.csv',
      value_field: 'teacher_q119_disruptive_sel',
      label_field: 'teacher_q119_disruptive_sel_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'high', ramp: 'viridis' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
    notes:
      'Spec §3.2 "Maybe" — included to demonstrate that a second indicator can ' +
      'share a dataset (with q120) and that an add is registry-only.',
  },
];

/* -------------------------------------------------------------------------- */
/* Community indicators — API, polygon layer (tract)                          */
/* -------------------------------------------------------------------------- */

/**
 * ACS 5-year endpoint year. Centralized so future updates touch one constant.
 * Use the most recent available 5-yr vintage. The 2024 release (covering
 * 2020–2024) was published Dec 2025 and is the current target, but some
 * tables / endpoints take longer to publish — fall back to 2023 if needed.
 */
export const ACS_YEAR = '2023';

/** CDC PLACES release year — refreshed annually; populated by the fetch script. */
export const CDC_PLACES_YEAR_DEFAULT = '2024';

const COMMUNITY_INDICATORS: IndicatorRegistryEntry[] = [
  {
    id: 'adult_mental_health',
    family: 'community',
    theme: 'Health',
    label: 'Adult mental-health distress (≥14 days, age 18+)',
    source: {
      type: 'api',
      provider: 'cdc_places',
      resource: 'cwsq-ngmh',
      measure_id: 'MHLTH',
      geo: 'tract',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'low', ramp: 'rocket_r' },
    geometry: 'polygon',
    years: [CDC_PLACES_YEAR_DEFAULT],
    status: 'active',
  },
  {
    id: 'child_poverty',
    family: 'community',
    theme: 'Economic Conditions',
    label: 'Child poverty rate (<18 below poverty)',
    source: {
      type: 'api',
      provider: 'acs5',
      endpoint: 'acs5',
      table: 'B17001',
      // Numerator = children under 18 below poverty (sum of male+female age <18 below).
      // Denominator = total children under 18 for whom poverty status is determined.
      // Specific variables resolved in the ETL — listed here for transparency.
      fields: [
        'B17001_004E', 'B17001_005E', 'B17001_006E', 'B17001_007E', 'B17001_008E', 'B17001_009E',
        'B17001_018E', 'B17001_019E', 'B17001_020E', 'B17001_021E', 'B17001_022E', 'B17001_023E',
        'B17001_033E', 'B17001_034E', 'B17001_035E', 'B17001_036E', 'B17001_037E', 'B17001_038E',
        'B17001_047E', 'B17001_048E', 'B17001_049E', 'B17001_050E', 'B17001_051E', 'B17001_052E',
      ],
      geo: 'tract',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'low', ramp: 'rocket_r' },
    geometry: 'polygon',
    years: [ACS_YEAR],
    status: 'active',
  },
  {
    id: 'unemployment_hh_children',
    family: 'community',
    theme: 'Economic Conditions',
    label: 'Adult unemployment (proxy: civilian unemployment rate)',
    source: {
      type: 'api',
      provider: 'acs5',
      endpoint: 'acs5/subject',
      table: 'S2301',
      // S2301_C04_001E = unemployment rate, population 16+
      fields: ['S2301_C04_001E'],
      geo: 'tract',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'low', ramp: 'rocket_r' },
    geometry: 'polygon',
    years: [ACS_YEAR],
    status: 'active',
    notes:
      'S2301 does not split by "households with children" at tract grain. ' +
      'Using overall civilian unemployment as the closest tract proxy; flag for PWC.',
  },
  {
    id: 'single_parent_hh',
    family: 'community',
    theme: 'Family Type',
    label: 'Single-parent household rate (own children <18)',
    source: {
      type: 'api',
      provider: 'acs5',
      endpoint: 'acs5',
      table: 'B11003',
      // (male householder no spouse + female householder no spouse) / total family households w/ own children.
      fields: ['B11003_001E', 'B11003_010E', 'B11003_016E'],
      geo: 'tract',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'low', ramp: 'rocket_r' },
    geometry: 'polygon',
    years: [ACS_YEAR],
    status: 'active',
  },
  {
    id: 'housing_insecurity',
    family: 'community',
    theme: 'Housing & Stability',
    label: 'Housing insecurity (past 12 mo, age 18+)',
    source: {
      type: 'api',
      provider: 'cdc_places',
      resource: 'cwsq-ngmh',
      // PLACES measure id from the SDOH module: "Housing Insecurity".
      measure_id: 'HOUSINSECU',
      geo: 'tract',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'low', ramp: 'rocket_r' },
    geometry: 'polygon',
    years: [CDC_PLACES_YEAR_DEFAULT],
    status: 'active',
  },
  {
    id: 'overcrowded_units',
    family: 'community',
    theme: 'Housing & Stability',
    label: 'Overcrowded household units (1.51+ occupants/room)',
    source: {
      type: 'api',
      provider: 'acs5',
      endpoint: 'acs5/profile',
      table: 'DP04',
      // DP04_0078PE is the percent estimate for "1.51 or more occupants per room".
      fields: ['DP04_0078PE'],
      geo: 'tract',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'low', ramp: 'rocket_r' },
    geometry: 'polygon',
    years: [ACS_YEAR],
    status: 'active',
  },
  {
    id: 'children_immigrant_families',
    family: 'community',
    theme: 'Immigration & Language',
    label: 'Children in immigrant families (foreign-born)',
    source: {
      type: 'api',
      provider: 'acs5',
      endpoint: 'acs5',
      table: 'B05009',
      // ETL computes (children in foreign-born-parent households) / (total own children <18).
      // Specific cells resolved at fetch time after schema introspection — kept conservative here.
      fields: ['B05009_001E'],
      geo: 'tract',
    },
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'none', ramp: 'viridis' },
    geometry: 'polygon',
    years: [ACS_YEAR],
    status: 'active',
    notes: 'ETL resolves the exact B05009 cell decomposition at fetch time.',
  },
  {
    id: 'racial_predominance',
    family: 'community',
    theme: 'Demographics',
    label: 'Racial predominance (argmax of Black/White/Asian/Hispanic)',
    source: {
      type: 'api',
      provider: 'acs5',
      endpoint: 'acs5',
      table: 'B03002',
      // B03002_003E=White NH; _004E=Black NH; _006E=Asian NH; _012E=Hispanic any race.
      fields: ['B03002_001E', 'B03002_003E', 'B03002_004E', 'B03002_006E', 'B03002_012E'],
      geo: 'tract',
    },
    format: 'categorical',
    scale: {
      type: 'categorical',
      good_direction: 'none',
      ramp: 'qualitative_d3_category10',
      categories: ['White', 'Black', 'Asian', 'Hispanic'],
    },
    geometry: 'polygon',
    years: [ACS_YEAR],
    status: 'active',
  },
  /* --- Crime: deferred per §3.3. Slot reserved so the future add is config + ETL. */
  {
    id: 'crime_near_schools',
    family: 'community',
    theme: 'Safety',
    label: 'Violent incidents near schools (deferred)',
    source: {
      type: 'deferred',
      planned_method:
        'NYPD Complaint Data + spatial join: 5-minute walk buffer per DBN, ' +
        'count violent incidents per year; keyed to DBN, not tract.',
    },
    format: 'count',
    scale: { type: 'sequential', good_direction: 'low', ramp: 'rocket_r' },
    geometry: 'site',
    years: [],
    status: 'deferred',
    notes: 'Point/site-grained — the one community indicator that would not be a choropleth.',
  },
];

export const INDICATORS: readonly IndicatorRegistryEntry[] = [
  ...SCHOOL_INDICATORS,
  ...COMMUNITY_INDICATORS,
];

export const indicatorsById: ReadonlyMap<string, IndicatorRegistryEntry> = new Map(
  INDICATORS.map((i) => [i.id, i]),
);

export function indicatorsByFamily(
  family: IndicatorRegistryEntry['family'],
): IndicatorRegistryEntry[] {
  return INDICATORS.filter((i) => i.family === family);
}

export function activeHostedIndicators(): IndicatorRegistryEntry[] {
  return INDICATORS.filter(
    (i) => i.status === 'active' && i.source.type === 'hosted',
  );
}

export function activeAcsIndicators(): IndicatorRegistryEntry[] {
  return INDICATORS.filter(
    (i) => i.status === 'active' && i.source.type === 'api' && i.source.provider === 'acs5',
  );
}

export function activeCdcIndicators(): IndicatorRegistryEntry[] {
  return INDICATORS.filter(
    (i) =>
      i.status === 'active' &&
      i.source.type === 'api' &&
      i.source.provider === 'cdc_places',
  );
}
