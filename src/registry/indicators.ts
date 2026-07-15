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
    theme: 'Student Experience',
    label: 'Art Education Access',
    short_label: 'Art Education Access',
    description: '# of artistic disciplines taught',
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
      // arts_ed_disciplines is a comma-separated multi-set of disciplines
      // taught at the school (e.g. "Dance, Music, Theater, Visual Arts").
      // We stash it in `value_text` via the same side-text mechanism that
      // safety_climate uses for its rating — the School Detail Panel's
      // Arts Education block reads it back through `getSchoolArtsEd`.
      categorical_field: 'arts_ed_disciplines',
    },
    format: 'integer',
    // arts_ed_score is "N of 4 disciplines taught" — values are exactly
    // 0, 1, 2, 3, 4. Use discrete_values so each integer gets its own color
    // and the legend reads "0", "1", "2", "3", "4" instead of nonsensical
    // bracket ranges (0.8, 1.6, 2.4, 3.2 from equal-interval over [0, 4]).
    scale: {
      type: 'diverging',
      good_direction: 'high',
      ramp: 'diverging_rdbu_muted',
      discrete_values: [0, 1, 2, 3, 4],
    },
    geometry: 'point',
    // Discontinuous — only these two years exist. Spec §3.2 #1.
    years: ['2020-21', '2024-25'],
    status: 'active',
    notes: 'Discontinuous: gap years must show "Data not available".',
  },
  {
    id: 'suspension_rate',
    family: 'school',
    theme: 'Student Experience',
    label: 'Suspension / Disciplinary Rate (per 100)',
    short_label: 'Suspension Rate',
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
    // NYC suspension rates cluster ~0–5% across most schools, with a long
    // right tail of outlier schools. Equal-interval bins would waste 4 out
    // of 5 colors on the tail; quintile bins spread color across the
    // distribution so within-cluster variation is readable. Breaks are
    // computed citywide over schools with a value for the displayed year
    // (stable across filter state).
    scale: {
      type: 'diverging',
      good_direction: 'low',
      ramp: 'diverging_rdbu_muted',
      bin_method: 'quantile',
    },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
    notes: '"R" redactions and "Data suppressed" labels → null.',
  },
  {
    id: 'temp_housing_rate',
    family: 'school',
    theme: 'Student Needs',
    label: '% Students in Temporary Housing',
    short_label: 'Temp Housing',
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
    theme: 'Student Outcomes',
    label: 'Math Proficiency (Gr 3–8, % L3+4)',
    short_label: 'Math Proficiency',
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
    theme: 'Student Outcomes',
    label: 'ELA Proficiency (Gr 3–8, % L3+4)',
    short_label: 'ELA Proficiency',
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
    theme: 'Student Outcomes',
    label: 'Chronic Absenteeism Rate',
    short_label: 'Chronic Absenteeism',
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
    theme: 'Student Outcomes',
    label: '4-Yr HS Graduation Rate',
    short_label: 'HS Graduation',
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
    // Task 10 (2026-07): moved from Student Experience into the renamed
    // School Culture group alongside the parent + teacher survey questions.
    theme: 'School Culture',
    label: 'Safety & School Climate (% Positive)',
    short_label: 'Safety & Climate',
    description:
      'The Safety and School Climate rating looks at how well the school establishes a culture ' +
      'where students feel safe, challenged to grow, and supported to meet high expectations; ' +
      'how well school leadership inspires the school community; and how well teachers participate ' +
      'in the continuous improvement of the school community. The rating is a combination of ' +
      'student attendance and NYC School Survey measures.',
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
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_rdbu_muted' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
    notes: 'Q3 default: numeric pct_positive drives the gradient; rating in tooltip.',
  },
  {
    id: 'family_q36_satisfied',
    family: 'school',
    theme: 'School Culture',
    label: 'Parent: Satisfaction w/ School (q36)',
    short_label: 'Parent: Satisfaction w/ School',
    full_question:
      'I am satisfied with the education my child has received this year.',
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
    // NYC survey % positive values cluster tightly in a narrow band (most
    // schools 80-100%); equal-interval bins put every school in 1-2 colors
    // so the choropleth reads as monotone. Quintile binning spreads color
    // across the distribution. Same rationale applied to the other four
    // survey indicators below.
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_rdbu_muted', bin_method: 'quantile' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  {
    id: 'teacher_q120_supports',
    family: 'school',
    theme: 'School Culture',
    label: 'Teacher: Access to Behavioral Supports (q120)',
    short_label: 'Teacher: Behavioral Supports',
    full_question:
      'Adults at this school have access to school-based supports to assist in behavioral/emotional escalations.',
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
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_rdbu_muted', bin_method: 'quantile' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  {
    id: 'student_q20_mental_health',
    family: 'school',
    theme: 'Student Experience',
    label: 'Student: Knows Where to Go for Mental-Health Support (q20)',
    short_label: 'Student: Mental Health Support',
    full_question:
      'I know where to go at my school if I need additional support with my mental-health.',
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
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_rdbu_muted', bin_method: 'quantile' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  {
    id: 'student_q22_felt_happy',
    family: 'school',
    theme: 'Student Experience',
    label: 'Student: Felt Happy at School (q22)',
    short_label: 'Student: Felt Happy at School',
    full_question:
      'During this school year, most days I have felt happy when at school.',
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
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_rdbu_muted', bin_method: 'quantile' },
    geometry: 'point',
    years: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'],
    status: 'active',
  },
  /* --- "Maybe" candidate from §3.2 footnote — kept enabled so the Phase 0
     acceptance test (registry-only add) is demonstrated by the initial ETL run. */
  {
    id: 'teacher_q119_disruptive_sel',
    family: 'school',
    theme: 'School Culture',
    label: 'Teacher: Recognizes Disruptive Behavior as SEL Opportunity (q119)',
    short_label: 'Teacher: SEL Awareness',
    full_question:
      'Adults at this school recognize disruptive behavior as social-emotional learning opportunities.',
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
    scale: { type: 'diverging', good_direction: 'high', ramp: 'diverging_rdbu_muted', bin_method: 'quantile' },
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
    label: 'Adult Mental-Health Distress (≥14 Days, Age 18+)',
    short_label: 'Adult Mental Health',
    source: {
      type: 'api',
      provider: 'cdc_places',
      resource: 'cwsq-ngmh',
      measure_id: 'MHLTH',
      geo: 'tract',
    },
    format: 'percent',
    // Continuous 5-stop ramp transcribed VERBATIM from the PWC IIT renderer
    // JSON (colorInfo on MHLTH_CrudePrev). The first THREE stops are all
    // cool blue-grey — that's what keeps the citywide mean (~15.4) reading
    // cool. The warm turn happens between 15 and 17.5; deep brick only
    // appears near/above 20. Below 10 clamps to #D7E1EE, above 20 clamps to
    // #991F17. Anchors are FIXED registry constants — never view- or
    // domain-relative. `layer_opacity: 0.85` matches the IIT layer setting
    // (overrides the map's 0.65 default for this indicator only).
    scale: {
      type: 'continuous',
      good_direction: 'low',
      ramp: 'pwc_iit_mh_5stop',
      layer_opacity: 0.85,
      stops: [
        { value: 10.0, color: '#D7E1EE' }, // cool light blue   (clamps below)
        { value: 12.5, color: '#CBD6E4' }, // cool
        { value: 15.0, color: '#B3BFD1' }, // STILL cool — pale steel-blue
        { value: 17.5, color: '#C86558' }, // warm (red)
        { value: 20.0, color: '#991F17' }, // deep brick        (clamps above)
      ],
    },
    geometry: 'polygon',
    years: [...CDC_PLACES_YEARS],
    status: 'active',
  },
  {
    id: 'child_poverty',
    family: 'community',
    theme: 'Economic Conditions',
    label: 'Child Poverty Rate (<18 Below Poverty)',
    short_label: 'Child Poverty',
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
    label: 'Adult Unemployment (Proxy: Civilian Unemployment Rate)',
    short_label: 'Adult Unemployment',
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
    scale: {
      type: 'sequential',
      good_direction: 'low',
      ramp: 'rocket_r',
      // NYC unemployment is right-skewed (most tracts cluster <10%); quantile
      // binning gives each color ~the same number of tracts.
      bin_method: 'quantile',
    },
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
    label: 'Single-Parent Household Rate (Own Children <18)',
    short_label: 'Single-Parent HH',
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
    label: 'Housing Insecurity (Past 12 Mo, Age 18+)',
    short_label: 'Housing Insecurity',
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
    label: 'Overcrowded Household Units (1.51+ Occupants/Room)',
    short_label: 'Overcrowded Units',
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
    scale: {
      type: 'sequential',
      good_direction: 'low',
      ramp: 'rocket_r',
      // Severe overcrowding is rare (most tracts at ~0%); quantile binning
      // surfaces the relative gradient that's invisible under equal-interval.
      bin_method: 'quantile',
    },
    geometry: 'polygon',
    years: [...ACS_YEARS],
    status: 'active',
  },
  {
    id: 'children_immigrant_families',
    family: 'community',
    theme: 'Immigration & Language',
    label: 'Children in Immigrant Families (Foreign-Born)',
    short_label: 'Children in Immigrant Families',
    source: {
      type: 'api',
      provider: 'acs5',
      endpoint: 'acs5',
      table: 'B05009',
      // Numerator: own children under 18 with at least one foreign-born parent.
      //   _005E = under 6, two-parent, one or both foreign born
      //   _012E = under 6, single-parent, foreign-born parent
      //   _016E = 6-17,    two-parent, one or both foreign born
      //   _023E = 6-17,    single-parent, foreign-born parent
      // Denominator: _001E = total own children under 18.
      // Pct = (sum numerator / denominator) * 100. ETL handles missing cells.
      fields: ['B05009_001E', 'B05009_005E', 'B05009_012E', 'B05009_016E', 'B05009_023E'],
      geo: 'tract',
    },
    format: 'percent',
    scale: {
      type: 'sequential',
      good_direction: 'none',
      ramp: 'viridis',
      bin_method: 'quantile',
    },
    geometry: 'polygon',
    years: [...ACS_YEARS],
    status: 'active',
    notes:
      'Numerator = B05009 cells _005E + _012E + _016E + _023E (children with ≥1 ' +
      'foreign-born parent across both age groups + parent structures). Denom = _001E.',
  },
  {
    id: 'racial_predominance',
    family: 'community',
    theme: 'Demographics',
    label: 'Racial Predominance',
    short_label: 'Racial Predominance',
    source: {
      type: 'api',
      provider: 'acs5',
      endpoint: 'acs5',
      table: 'B03002',
      // B03002 cells used for the 6-way argmax that matches the PWC IIT
      // renderer. _001E=total denominator; _003E=White NH; _004E=Black NH;
      // _005E=Am Indian / Alaska Native NH; _006E=Asian NH; _007E=Native
      // Hawaiian / Pacific Islander NH; _008E=Some Other Race NH;
      // _009E=Two or More Races NH; _012E=Hispanic / Latinx (any race).
      // _005E and _008E feed the argmax but their winners are suppressed to
      // no-data ("Other" → not rendered) — matches PWC's IIT convention.
      fields: [
        'B03002_001E', 'B03002_003E', 'B03002_004E', 'B03002_005E',
        'B03002_006E', 'B03002_007E', 'B03002_008E', 'B03002_009E', 'B03002_012E',
      ],
      geo: 'tract',
    },
    format: 'categorical',
    scale: {
      type: 'categorical',
      good_direction: 'none',
      ramp: 'qualitative_pwc_iit',
      categories: ['White', 'Latinx', 'Black', 'Asian', 'Pacific Islander', 'Two or More Races'],
      // Transparency by predominance — share of population in the predominant
      // group is mapped linearly to opacity, clamped outside [17%, 94%].
      // Tracts where one group only barely leads fade out; strongly-
      // predominant tracts render solid. Matches PWC's IIT renderer.
      opacity_stretch: { value_min: 17, value_max: 94, opacity_min: 0, opacity_max: 1 },
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
    label: 'Violent Incidents Near Schools (Deferred)',
    short_label: 'Crime Near Schools',
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
  'Student Outcomes',
  'Student Experience',
  'Student Needs',
  'School Culture',
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
