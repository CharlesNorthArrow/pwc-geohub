/**
 * School-indicator dataset configs — the Admin Panel's view of the 11 hosted
 * CSVs that power the 13 school indicators.
 *
 * Each config declares the canonical column list (`AdminField[]`, ordered to
 * match the data/*.csv headers) plus which registry indicators the dataset
 * powers. Column reconciliation, merge, versioning, and the API routes are
 * all parameterized by this — adding a hosted dataset = one entry here.
 *
 * `teacher_survey` and `student_survey` each power TWO indicators (spec §11.2's
 * one-dataset-many-indicators case) — apply re-derives all of them at once.
 */

import { indicatorsById } from '../registry/indicators';
import type { HostedSource } from '../registry/types';
import type { AdminField } from './schemaTypes';

export interface IndicatorDatasetConfig {
  /** URL segment, DB `dataset` value, blob path segment. */
  id: string;
  /** Source file under data/ (also `source.dataset` in the registry). */
  csvFile: string;
  /** Card title. */
  title: string;
  /** Card body copy. */
  description: string;
  /** 'cohort_year' only for graduation — upload may derive school_year. */
  yearMode: 'school_year' | 'cohort_year';
  /** Canonical columns, ordered to match the hosted CSV headers. */
  fields: readonly AdminField[];
  /** Registry indicator ids this dataset powers. */
  indicatorIds: readonly string[];
}

const KEYS: readonly AdminField[] = [
  { id: 'DBN', type: 'text', isKey: true, description: 'NYC DOE school code — join key. Leading zeros preserved.' },
  { id: 'school_year', type: 'text', isKey: true, description: 'School year, e.g. "2024-25".' },
];

export const INDICATOR_DATASETS: readonly IndicatorDatasetConfig[] = [
  {
    id: 'arts_ed',
    csvFile: 'arts_ed.csv',
    title: 'Arts Education Score',
    description: 'NYC DOE Arts Education Survey. Updated annually; per-school score.',
    yearMode: 'school_year',
    indicatorIds: ['arts_ed_score'],
    fields: [
      ...KEYS,
      { id: 'arts_ed_score', type: 'number', isKey: false, description: 'Count of arts disciplines (0–4) with active instruction.' },
      { id: 'arts_ed_score_label', type: 'text', isKey: false, description: 'Display label, e.g. "4 of 4 disciplines".' },
      { id: 'arts_ed_disciplines', type: 'text', isKey: false, description: 'Comma-separated active disciplines, e.g. "Dance, Music".' },
    ],
  },
  {
    id: 'suspensions',
    csvFile: 'suspensions.csv',
    title: 'Suspension Rate',
    description: 'NYC DOE suspensions / enrollment by school × year.',
    yearMode: 'school_year',
    indicatorIds: ['suspension_rate'],
    fields: [
      ...KEYS,
      { id: 'suspension_total', type: 'number', isKey: false, description: 'Total removals/suspensions ("R" redactions → blank).' },
      { id: 'suspension_rate', type: 'number', isKey: false, description: 'Suspensions per 100 enrolled students.' },
      { id: 'suspension_rate_label', type: 'text', isKey: false, description: 'Display label.' },
    ],
  },
  {
    id: 'temp_housing',
    csvFile: 'temp_housing.csv',
    title: 'Temporary Housing',
    description: 'NYC DOE temp-housing rate (students in shelter / temporary housing).',
    yearMode: 'school_year',
    indicatorIds: ['temp_housing_rate'],
    fields: [
      ...KEYS,
      { id: 'temp_housing_count', type: 'number', isKey: false, description: 'Students in temporary housing (count).' },
      { id: 'temp_housing_rate', type: 'number', isKey: false, description: '% of students in temporary housing.' },
      { id: 'temp_housing_rate_label', type: 'text', isKey: false, description: 'Display label.' },
    ],
  },
  {
    id: 'math',
    csvFile: 'math.csv',
    title: 'Math Proficiency',
    description: 'NY State 3-8 Math — % proficient (Levels 3+4).',
    yearMode: 'school_year',
    indicatorIds: ['math_proficiency'],
    fields: [
      ...KEYS,
      { id: 'math_number_tested', type: 'number', isKey: false, description: 'Students tested.' },
      { id: 'math_mean_scale_score', type: 'number', isKey: false, description: 'Mean scale score.' },
      { id: 'math_pct_proficient', type: 'number', isKey: false, description: '% at Levels 3+4.' },
      { id: 'math_pct_proficient_label', type: 'text', isKey: false, description: 'Display label.' },
    ],
  },
  {
    id: 'ela',
    csvFile: 'ela.csv',
    title: 'ELA Proficiency',
    description: 'NY State 3-8 ELA — % proficient (Levels 3+4).',
    yearMode: 'school_year',
    indicatorIds: ['ela_proficiency'],
    fields: [
      ...KEYS,
      { id: 'ela_number_tested', type: 'number', isKey: false, description: 'Students tested.' },
      { id: 'ela_mean_scale_score', type: 'number', isKey: false, description: 'Mean scale score.' },
      { id: 'ela_pct_proficient', type: 'number', isKey: false, description: '% at Levels 3+4.' },
      { id: 'ela_pct_proficient_label', type: 'text', isKey: false, description: 'Display label.' },
    ],
  },
  {
    id: 'chronic_absenteeism',
    csvFile: 'chronic_absenteeism.csv',
    title: 'Chronic Absenteeism',
    description: '% students chronically absent (≥10% of school days).',
    yearMode: 'school_year',
    indicatorIds: ['chronic_absent_rate'],
    fields: [
      ...KEYS,
      { id: 'chronic_absent_count', type: 'number', isKey: false, description: 'Chronically absent students (count).' },
      { id: 'chronic_absent_rate', type: 'number', isKey: false, description: '% chronically absent.' },
      { id: 'chronic_absent_rate_label', type: 'text', isKey: false, description: 'Display label.' },
    ],
  },
  {
    id: 'graduation',
    csvFile: 'graduation.csv',
    title: 'Graduation Rate',
    description: 'NYC DOE 4-yr cohort graduation rate (HS only).',
    yearMode: 'cohort_year',
    indicatorIds: ['graduation_rate'],
    fields: [
      { id: 'DBN', type: 'text', isKey: true, description: 'NYC DOE school code — join key. Leading zeros preserved.' },
      { id: 'cohort_year', type: 'text', isKey: false, description: 'Entry year of the 4-yr cohort (e.g. 2021 → school year 2024-25).' },
      { id: 'school_year', type: 'text', isKey: true, description: 'School year of graduation — derived from cohort_year when absent.' },
      { id: 'cohort_size', type: 'number', isKey: false, description: 'Cohort size.' },
      { id: 'graduation_rate', type: 'number', isKey: false, description: '% graduating in 4 years.' },
      { id: 'graduation_rate_label', type: 'text', isKey: false, description: 'Display label.' },
    ],
  },
  {
    id: 'school_quality',
    csvFile: 'school_quality.csv',
    title: 'School Quality / Safety',
    description: 'NYC DOE School Quality Reports — safety & climate.',
    yearMode: 'school_year',
    indicatorIds: ['safety_climate'],
    fields: [
      ...KEYS,
      { id: 'school_type', type: 'text', isKey: false, description: 'Report type (EMS, HS, Transfer HS, D75, Early Childhood).' },
      { id: 'safety_climate_rating', type: 'text', isKey: false, description: 'Categorical rating (Excellent … Not Meeting Target).' },
      { id: 'safety_climate_rating_label', type: 'text', isKey: false, description: 'Display label for the rating.' },
      { id: 'safety_pct_positive', type: 'number', isKey: false, description: '% positive responses on safety & climate.' },
      { id: 'safety_pct_positive_label', type: 'text', isKey: false, description: 'Display label.' },
    ],
  },
  {
    id: 'family_survey',
    csvFile: 'family_survey.csv',
    title: 'Family Survey',
    description: 'NYC DOE Family Survey responses.',
    yearMode: 'school_year',
    indicatorIds: ['family_q36_satisfied'],
    fields: [
      ...KEYS,
      { id: 'family_q36_pct_satisfied', type: 'number', isKey: false, description: 'q36 — % satisfied/very satisfied with child’s education.' },
      { id: 'family_q36_pct_satisfied_label', type: 'text', isKey: false, description: 'Display label.' },
    ],
  },
  {
    id: 'teacher_survey',
    csvFile: 'teacher_survey.csv',
    title: 'Teacher Survey',
    description: 'NYC DOE Teacher Survey responses.',
    yearMode: 'school_year',
    indicatorIds: ['teacher_q120_supports', 'teacher_q119_disruptive_sel'],
    fields: [
      ...KEYS,
      { id: 'teacher_q119_disruptive_sel', type: 'number', isKey: false, description: 'q119 — % A lot/All: disruptive behavior seen as SEL opportunity.' },
      { id: 'teacher_q119_disruptive_sel_label', type: 'text', isKey: false, description: 'Display label.' },
      { id: 'teacher_q120_access_supports', type: 'number', isKey: false, description: 'q120 — % A lot/All: access to behavioral/emotional supports.' },
      { id: 'teacher_q120_access_supports_label', type: 'text', isKey: false, description: 'Display label.' },
    ],
  },
  {
    id: 'student_survey',
    csvFile: 'student_survey.csv',
    title: 'Student Survey',
    description: 'NYC DOE Student Survey responses (incl. mental-health items).',
    yearMode: 'school_year',
    indicatorIds: ['student_q20_mental_health', 'student_q22_felt_happy'],
    fields: [
      ...KEYS,
      { id: 'student_q20_mental_health', type: 'number', isKey: false, description: 'q20 — % Agree/Strongly agree: knows where to go for mental-health support.' },
      { id: 'student_q20_mental_health_label', type: 'text', isKey: false, description: 'Display label.' },
      { id: 'student_q22_felt_happy', type: 'number', isKey: false, description: 'q22 — % Agree/Strongly agree: felt happy at school most days.' },
      { id: 'student_q22_felt_happy_label', type: 'text', isKey: false, description: 'Display label.' },
    ],
  },
];

const byId = new Map(INDICATOR_DATASETS.map((c) => [c.id, c]));

export function getIndicatorDataset(id: string): IndicatorDatasetConfig | undefined {
  return byId.get(id);
}

/** The registry's HostedSource for one of a config's indicators. */
export function hostedSourceOf(indicatorId: string): HostedSource {
  const ind = indicatorsById.get(indicatorId);
  if (!ind || ind.source.type !== 'hosted') {
    throw new Error(`indicatorDatasets: ${indicatorId} is not a hosted school indicator`);
  }
  return ind.source;
}

// --- Registry ↔ config drift guard (runs once at module load) ---------------
// Every registry field the derivation reads must exist in the config's field
// list, and the registry must agree on the dataset file. Throws early (dev &
// build time) rather than silently writing nulls into the live table.
for (const cfg of INDICATOR_DATASETS) {
  const fieldIds = new Set(cfg.fields.map((f) => f.id));
  for (const indicatorId of cfg.indicatorIds) {
    const source = hostedSourceOf(indicatorId);
    if (source.dataset !== cfg.csvFile) {
      throw new Error(
        `indicatorDatasets: ${cfg.id} lists ${indicatorId}, but the registry sources it from ${source.dataset}, not ${cfg.csvFile}`,
      );
    }
    for (const f of [source.value_field, source.label_field, source.categorical_field, source.categorical_label_field]) {
      if (f && !fieldIds.has(f)) {
        throw new Error(`indicatorDatasets: ${cfg.id} is missing registry field "${f}" (${indicatorId})`);
      }
    }
  }
}
