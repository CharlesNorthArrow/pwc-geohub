/**
 * Data-collection guidelines for the hosted school-indicator datasets,
 * transcribed from the Public Data Wishlist (🍎 School sheet of
 * `data/reference/PwC Geo Hub - Public Data Wishlist.xlsx`).
 *
 * Rendered on the Admin Panel's School-indicator cards: how to fetch the
 * upstream file, which tab/field/calculation produces each value, and the
 * source outlink. Keyed by dataset id (src/admin/indicatorDatasets.ts).
 *
 * Every card's upload expects a CSV shaped like the dataset schema (use the
 * "Download template" button) — these steps describe how to get from the raw
 * DOE/State download to those columns.
 */

export interface DatasetGuidelines {
  /** Upstream source, e.g. 'NYC DOE Annual Arts in Schools Report'. */
  sourceLabel: string;
  /** Canonical landing page (normalized to https://). */
  sourceUrl: string;
  /** How to fetch + prepare the data, in order. */
  steps: string[];
  /** Which tab/field/calculation produces each indicator value. */
  fieldCalc: string[];
  /** Coverage caveats worth knowing before hunting for missing years. */
  notes?: string;
}

export const DATASET_GUIDELINES: Record<string, DatasetGuidelines> = {
  arts_ed: {
    sourceLabel: 'NYC DOE Annual Arts in Schools Report',
    sourceUrl: 'https://sites.google.com/schools.nyc.gov/nycdoe-oasp/nycps-arts-data',
    steps: [
      'Click on "[YEAR] ArtsCount Survey Data" and download the spreadsheet.',
      'Compute the score per school (see calculation below), then prepare a CSV matching the template.',
    ],
    fieldCalc: [
      "Calc: count of arts disciplines (Dance, Music, Theater, Visual Arts) with active instruction — a discipline counts as active if its 'Instruction Not Provided' field is blank. Score ranges 0–4. Source columns: 'Dance - Instruction Not Provided', 'Music - …', 'Theater - …', 'VA - …' (ArtsCount Survey Data, Sheet0).",
    ],
    notes: 'Data only exists for 2021 and 2024-25 — nothing in between. Gap years show "Data not available" on the dashboard.',
  },
  suspensions: {
    sourceLabel: 'NYC DOE Suspension Reports (Local Law 93)',
    sourceUrl: 'https://infohub.nyced.org/reports/government-reports/suspension-reports',
    steps: [
      'Download "Student Discipline - Annual Report on Student Discipline [YEAR]".',
      'Compute the rate per school (see calculation below), then prepare a CSV matching the template.',
    ],
    fieldCalc: [
      "Calc: total removals/suspensions per 100 enrolled students. Numerator: 'TOTAL REMOVALS/SUSPENSIONS' from the 'Annual Report--R-P-S TOTALS' tab (System_Code = DBN). Denominator: total enrollment from the NYC DOE Demographic Snapshot. Values of 'R' (redacted for small counts) are treated as blank. Formula: (TOTAL REMOVALS/SUSPENSIONS ÷ Total Enrollment) × 100.",
    ],
  },
  temp_housing: {
    sourceLabel: 'NYC DOE Students in Temporary Housing Reports',
    sourceUrl: 'https://infohub.nyced.org/reports/government-reports/students-in-temporary-housing-reports',
    steps: ['Download "Reporting Data for School Year [YEAR]".'],
    fieldCalc: ['Field: % Students in Temporary Housing.'],
  },
  math: {
    sourceLabel: 'NYC DOE / NYSED state test results',
    sourceUrl: 'https://infohub.nyced.org/reports/academics/test-results',
    steps: ['Download the "School" file under "Math Test Results 2018 to 2025". School-level tab; DBN is the key field.'],
    fieldCalc: ['Field: % Level 3+4 (proficiency).'],
    notes: '2019-20 is a COVID-year gap — no test results exist for it.',
  },
  ela: {
    sourceLabel: 'NYC DOE / NYSED state test results',
    sourceUrl: 'https://infohub.nyced.org/reports/academics/test-results',
    steps: ["Download the 'All Students — ELA' Excel file. School-level tab; DBN is the key field."],
    fieldCalc: ['Field: % Level 3+4 (proficiency).'],
    notes: '2019-20 is a COVID-year gap — no test results exist for it.',
  },
  chronic_absenteeism: {
    sourceLabel: 'NYC DOE End-of-Year Attendance & Chronic Absenteeism Data',
    sourceUrl:
      'https://infohub.nyced.org/reports/students-and-schools/school-quality/information-and-data-overview/end-of-year-attendance-and-chronic-absenteeism-data',
    steps: ['Download the "School" file under "End-of-Year Attendance and Chronic Absenteeism Data".'],
    fieldCalc: ['Field: % Chronically Absent.'],
  },
  graduation: {
    sourceLabel: 'NYC DOE Graduation Results',
    sourceUrl: 'https://infohub.nyced.org/reports/academics/graduation-results',
    steps: [
      'Download the Graduation Results Excel file for "School".',
      'The file is cohort-keyed — a cohort_year column is fine: the upload derives school_year automatically (cohort Y graduates in school year (Y+3)-(Y+4), e.g. cohort 2021 → 2024-25).',
    ],
    fieldCalc: ['Field: % grads (4-year cohort rate). High schools only — other schools have no rows.'],
  },
  school_quality: {
    sourceLabel: 'NYC DOE School Quality Reports — Citywide Results',
    sourceUrl:
      'https://infohub.nyced.org/reports/students-and-schools/school-quality/school-quality-reports-and-resources/school-quality-reports-citywide-results',
    steps: [
      'Download all five school-type Excel files (EMS, HS, Transfer HS, D75, Early Childhood) and stack them into one table.',
    ],
    fieldCalc: ['Sheet: "Scoring" — Field: "Safety and School Climate - Rating" (plus the % positive sibling).'],
  },
  family_survey: {
    sourceLabel: 'NYC School Survey — Family Data File',
    sourceUrl: 'https://infohub.nyced.org/reports/students-and-schools/school-quality/nyc-school-survey',
    steps: ["Download the '[YEAR] Family survey data' Excel file under the section \"Understand Your Survey Results\"."],
    fieldCalc: ['Tab: "Family Pos & Neg%" — Field: q36 (Satisfied/Very satisfied).'],
  },
  teacher_survey: {
    sourceLabel: 'NYC School Survey — Teacher Data File',
    sourceUrl: 'https://infohub.nyced.org/reports/students-and-schools/school-quality/nyc-school-survey',
    steps: ["Download the '[YEAR] Teacher survey data' Excel file under the section \"Understand Your Survey Results\"."],
    fieldCalc: [
      'Tab: "Teacher Pos & Neg%" — Field: q120 (A lot/All): access to school-based behavioral/emotional supports.',
      'Tab: "Teacher Pos & Neg%" — Field: q119 (A lot/All): disruptive behavior recognized as SEL opportunity.',
    ],
  },
  student_survey: {
    sourceLabel: 'NYC School Survey — Student Data File',
    sourceUrl: 'https://infohub.nyced.org/reports/students-and-schools/school-quality/nyc-school-survey',
    steps: ["Download the '[YEAR] Student survey data' Excel file under the section \"Understand Your Survey Results\"."],
    fieldCalc: [
      'Tab: "Student Pos & Neg%" — Field: q20 (Agree/Strongly agree): knows where to go for mental-health support.',
      'Tab: "Student Pos & Neg%" — Field: q22 (Agree/Strongly agree): felt happy at school most days.',
    ],
  },
};
