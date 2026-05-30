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

import type { IndicatorRegistryEntry } from './types';

/* -------------------------------------------------------------------------- */
/* School indicators — hosted, point layer                                    */
/* -------------------------------------------------------------------------- */

const SCHOOL_INDICATORS: IndicatorRegistryEntry[] = [
  {
    id: 'arts_ed_score',
    family: 'school',
    theme: 'Student experience',
    label: 'Arts education access (# disciplines, 0–4)',
    short_label: 'Arts education',
    data_source: 'NYC DOE Annual Arts in Schools Report',
    data_source_url:
      'https://sites.google.com/schools.nyc.gov/nycdoe-oasp/nycps-arts-data',
    source: {
      type: 'hosted',
      dataset: 'arts_ed.csv',
      value_field: 'arts_ed_score',
      label_field: 'arts_ed_score_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'integer',
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_pugn_muted' },
    geometry: 'point',
    // Discontinuous — only these two years exist. Spec §3.2 #1.
    years: ['2020-21', '2024-25'],
    status: 'active',
    notes: 'Discontinuous: gap years must show "Data not available".',
  },
  {
    id: 'suspension_rate',
    family: 'school',
    theme: 'Student experience',
    label: 'Suspension / disciplinary rate (per 100)',
    short_label: 'Suspension rate',
    data_source: 'NYC DOE Suspension Reports (Local Law 93)',
    data_source_url:
      'https://infohub.nyced.org/reports/government-reports/suspension-reports',
    source: {
      type: 'hosted',
      dataset: 'suspensions.csv',
      value_field: 'suspension_rate',
      label_field: 'suspension_rate_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'rate_per_100',
    scale: { type: 'diverging', good_direction: 'low', ramp: 'diverging_pugn_muted' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
    notes: '"R" redactions and "Data suppressed" labels → null.',
  },
  {
    id: 'temp_housing_rate',
    family: 'school',
    theme: 'Student need',
    label: '% students in temporary housing',
    short_label: 'Temp housing',
    data_source: 'NYC DOE Students in Temporary Housing Reports',
    data_source_url:
      'https://infohub.nyced.org/reports/government-reports/students-in-temporary-housing-reports',
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
    theme: 'Student outcomes',
    label: 'Math proficiency (gr 3–8, % L3+4)',
    short_label: 'Math proficiency',
    data_source: 'NYC DOE / NYSED — state test results',
    data_source_url: 'https://infohub.nyced.org/reports/academics/test-results',
    source: {
      type: 'hosted',
      dataset: 'math.csv',
      value_field: 'math_pct_proficient',
      label_field: 'math_pct_proficient_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_rdbu_muted' },
    geometry: 'point',
    years: ['2017-18', '2018-19', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
    notes: '2019-20 is COVID-year null. Deeper history than the 5-yr window.',
  },
  {
    id: 'ela_proficiency',
    family: 'school',
    theme: 'Student outcomes',
    label: 'ELA proficiency (gr 3–8, % L3+4)',
    short_label: 'ELA proficiency',
    data_source: 'NYC DOE / NYSED — state test results',
    data_source_url: 'https://infohub.nyced.org/reports/academics/test-results',
    source: {
      type: 'hosted',
      dataset: 'ela.csv',
      value_field: 'ela_pct_proficient',
      label_field: 'ela_pct_proficient_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_rdbu_muted' },
    geometry: 'point',
    years: ['2017-18', '2018-19', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  {
    id: 'chronic_absent_rate',
    family: 'school',
    theme: 'Student outcomes',
    label: 'Chronic absenteeism rate',
    short_label: 'Chronic absenteeism',
    data_source: 'NYC DOE — End-of-Year Attendance & Chronic Absenteeism',
    data_source_url:
      'https://infohub.nyced.org/reports/students-and-schools/school-quality/information-and-data-overview/end-of-year-attendance-and-chronic-absenteeism-data',
    source: {
      type: 'hosted',
      dataset: 'chronic_absenteeism.csv',
      value_field: 'chronic_absent_rate',
      label_field: 'chronic_absent_rate_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'diverging', good_direction: 'low', ramp: 'diverging_rdbu_muted' },
    geometry: 'point',
    years: ['2018-19', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  {
    id: 'graduation_rate',
    family: 'school',
    theme: 'Student outcomes',
    label: '4-yr HS graduation rate',
    short_label: 'HS graduation',
    data_source: 'NYC DOE Graduation Results',
    data_source_url:
      'https://infohub.nyced.org/reports/academics/graduation-results',
    source: {
      type: 'hosted',
      dataset: 'graduation.csv',
      value_field: 'graduation_rate',
      label_field: 'graduation_rate_label',
      key: 'dbn',
      year_field: 'cohort_year',
    },
    format: 'percent',
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_rdbu_muted' },
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
    theme: 'Student experience',
    label: 'Safety & school climate (% positive)',
    short_label: 'Safety & climate',
    data_source: 'NYC DOE School Quality Reports — Citywide Results',
    data_source_url:
      'https://infohub.nyced.org/reports/students-and-schools/school-quality/school-quality-reports-and-resources/school-quality-reports-citywide-results',
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
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_pugn_muted' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
    notes: 'Q3 default: numeric pct_positive drives the gradient; rating in tooltip.',
  },
  {
    id: 'family_q36_satisfied',
    family: 'school',
    theme: 'Staff & school culture',
    label: 'Family satisfaction with education (q36)',
    short_label: 'Family satisfaction',
    data_source: 'NYC School Survey — Family Data File',
    data_source_url:
      'https://infohub.nyced.org/reports/students-and-schools/school-quality/nyc-school-survey',
    source: {
      type: 'hosted',
      dataset: 'family_survey.csv',
      value_field: 'family_q36_pct_satisfied',
      label_field: 'family_q36_pct_satisfied_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_greyteal_muted' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  {
    id: 'teacher_q120_supports',
    family: 'school',
    theme: 'Staff & school culture',
    label: 'Teacher: access to behavioral supports (q120)',
    short_label: 'Teacher: supports access',
    data_source: 'NYC School Survey — Teacher Data File',
    data_source_url:
      'https://infohub.nyced.org/reports/students-and-schools/school-quality/nyc-school-survey',
    source: {
      type: 'hosted',
      dataset: 'teacher_survey.csv',
      value_field: 'teacher_q120_access_supports',
      label_field: 'teacher_q120_access_supports_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_greyteal_muted' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  {
    id: 'student_q20_mental_health',
    family: 'school',
    theme: 'Student experience',
    label: 'Student: knows where to go for mental-health support (q20)',
    short_label: 'Student: MH support',
    data_source: 'NYC School Survey — Student Data File',
    data_source_url:
      'https://infohub.nyced.org/reports/students-and-schools/school-quality/nyc-school-survey',
    source: {
      type: 'hosted',
      dataset: 'student_survey.csv',
      value_field: 'student_q20_mental_health',
      label_field: 'student_q20_mental_health_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_pugn_muted' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  {
    id: 'student_q22_felt_happy',
    family: 'school',
    theme: 'Student experience',
    label: 'Student: felt happy at school (q22)',
    short_label: 'Student: felt happy',
    data_source: 'NYC School Survey — Student Data File',
    data_source_url:
      'https://infohub.nyced.org/reports/students-and-schools/school-quality/nyc-school-survey',
    source: {
      type: 'hosted',
      dataset: 'student_survey.csv',
      value_field: 'student_q22_felt_happy',
      label_field: 'student_q22_felt_happy_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_pugn_muted' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  /* --- "Maybe" candidate from §3.2 footnote — kept enabled so the Phase 0
     acceptance test (registry-only add) is demonstrated by the initial ETL run. */
  {
    id: 'teacher_q119_disruptive_sel',
    family: 'school',
    theme: 'Staff & school culture',
    label: 'Teacher: recognizes disruptive behavior as SEL opportunity (q119)',
    short_label: 'Teacher: SEL view',
    data_source: 'NYC School Survey — Teacher Data File',
    data_source_url:
      'https://infohub.nyced.org/reports/students-and-schools/school-quality/nyc-school-survey',
    source: {
      type: 'hosted',
      dataset: 'teacher_survey.csv',
      value_field: 'teacher_q119_disruptive_sel',
      label_field: 'teacher_q119_disruptive_sel_label',
      key: 'dbn',
      year_field: 'school_year',
    },
    format: 'percent',
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_greyteal_muted' },
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
 * ACS 5-year vintages we ingest. Each year is a separate
 * `api.census.gov/data/YYYY/acs/acs5` endpoint; the ETL loops over them. The
 * 2020 release (covering 2016–2020) was the special COVID-disrupted release
 * with several tables suppressed — we still fetch it and record per-(indicator,
 * year) findings for anything that 404s or comes back empty.
 *
 * The slider's school_year → calendar year mapping (`toCommunityYear`) is:
 *   2020-21 → 2021, 2021-22 → 2022, 2022-23 → 2023, 2023-24 → 2024, 2024-25 → 2025.
 * 2025 isn't released yet (≈Dec 2026), so the rightmost slider stop stays 🗓️
 * for community indicators until next year's vintage lands.
 */
export const ACS_YEARS = ['2020', '2021', '2022', '2023', '2024'] as const;

/** Convenience: the latest vintage we expect, used for fallback / display. */
export const ACS_YEAR_LATEST = ACS_YEARS[ACS_YEARS.length - 1];

/**
 * CDC PLACES vintages currently on disk. The active `cwsq-ngmh` Socrata
 * dataset is a CURRENT-release feed and holds ONE year of estimates at a
 * time (today: 2023). Historical PLACES releases live in separate dataset
 * endpoints whose IDs change per release and which Socrata sometimes
 * deprecates; pulling them in is a follow-up if PWC wants CDC longitudinal.
 * For now we honestly advertise just what we have.
 */
export const CDC_PLACES_YEARS = ['2023'] as const;
export const CDC_PLACES_YEAR_DEFAULT = CDC_PLACES_YEARS[CDC_PLACES_YEARS.length - 1];

const COMMUNITY_INDICATORS: IndicatorRegistryEntry[] = [
  {
    id: 'adult_mental_health',
    family: 'community',
    theme: 'Health',
    label: 'Adult mental-health distress (≥14 days, age 18+)',
    short_label: 'Adult mental health',
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
    years: [...CDC_PLACES_YEARS],
    status: 'active',
  },
  {
    id: 'child_poverty',
    family: 'community',
    theme: 'Economic Conditions',
    label: 'Child poverty rate (<18 below poverty)',
    short_label: 'Child poverty',
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
    years: [...ACS_YEARS],
    status: 'active',
  },
  {
    id: 'unemployment_hh_children',
    family: 'community',
    theme: 'Economic Conditions',
    label: 'Adult unemployment (proxy: civilian unemployment rate)',
    short_label: 'Adult unemployment',
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
    years: [...ACS_YEARS],
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
    short_label: 'Single-parent HH',
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
    years: [...ACS_YEARS],
    status: 'active',
  },
  {
    id: 'housing_insecurity',
    family: 'community',
    theme: 'Housing & Stability',
    label: 'Housing insecurity (past 12 mo, age 18+)',
    short_label: 'Housing insecurity',
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
    years: [...CDC_PLACES_YEARS],
    status: 'active',
  },
  {
    id: 'overcrowded_units',
    family: 'community',
    theme: 'Housing & Stability',
    label: 'Overcrowded household units (1.51+ occupants/room)',
    short_label: 'Overcrowded units',
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
    years: [...ACS_YEARS],
    status: 'active',
  },
  {
    id: 'children_immigrant_families',
    family: 'community',
    theme: 'Immigration & Language',
    label: 'Children in immigrant families (foreign-born)',
    short_label: 'Immigrant family kids',
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
    years: [...ACS_YEARS],
    status: 'active',
    notes: 'ETL resolves the exact B05009 cell decomposition at fetch time.',
  },
  {
    id: 'racial_predominance',
    family: 'community',
    theme: 'Demographics',
    label: 'Racial predominance (argmax of Black/White/Asian/Hispanic)',
    short_label: 'Racial predominance',
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
    years: [...ACS_YEARS],
    status: 'active',
  },
  /* --- Crime: deferred per §3.3. Slot reserved so the future add is config + ETL. */
  {
    id: 'crime_near_schools',
    family: 'community',
    theme: 'Safety',
    label: 'Violent incidents near schools (deferred)',
    short_label: 'Crime near schools',
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

/**
 * Canonical display order for the four school-indicator themes. The selector
 * renders headers in this order; indicators whose theme isn't listed appear
 * at the end. Edit here to reorder the panel without touching component code.
 */
export const SCHOOL_THEME_ORDER: readonly string[] = [
  'Student outcomes',
  'Student experience',
  'Student need',
  'Staff & school culture',
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
