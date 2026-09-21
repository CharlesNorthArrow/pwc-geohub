/**
 * Data-collection guidelines for the hosted school-indicator datasets,
 * transcribed from the Public Data Wishlist (🍎 School sheet of
 * `data/reference/PwC Geo Hub - Public Data Wishlist.xlsx`).
 *
 * Rendered on the Admin Panel's School-indicator cards: how to fetch the
 * upstream file, which tab/field/calculation the hub uses for each value, and
 * the source outlink. Keyed by dataset id (src/admin/indicatorDatasets.ts).
 *
 * The admin uploads the raw download as-is; the hub transforms it
 * (src/admin/rawTransforms). `fieldCalc`
 * describes what that transformation computes.
 */

export interface DatasetGuidelines {
  /** Upstream source, e.g. 'NYC DOE Annual Arts in Schools Report'. */
  sourceLabel: string;
  /** Canonical landing page (normalized to https://). */
  sourceUrl: string;
  /** How to fetch + prepare the data, in order. */
  steps: string[];
  /** Which tab/field/calculation the hub uses for each indicator value. */
  fieldCalc: string[];
  /** Coverage caveats worth knowing before hunting for missing years. */
  notes?: string;
  /** Shown on the card itself (not folded away) — e.g. file-size limits. */
  warning?: string;
}

export const DATASET_GUIDELINES: Record<string, DatasetGuidelines> = {
  arts_ed: {
    sourceLabel: 'NYC DOE Annual Arts in Schools Report',
    sourceUrl: 'https://sites.google.com/schools.nyc.gov/nycdoe-oasp/nycps-arts-data',
    steps: [
      'Click on "[YEAR] ArtsCount Survey Data" and download the spreadsheet.',
    ],
    fieldCalc: [
      "The hub computes the count of arts disciplines (Dance, Music, Theater, Visual Arts) with active instruction — a discipline counts as active if its 'Instruction Not Provided' field is blank. Score ranges 0–4. Source columns: 'Dance - Instruction Not Provided', 'Music - …', 'Theater - …', 'VA - …' (ArtsCount Survey Data, Sheet0).",
    ],
    notes: 'Data only exists for 2021 and 2024-25 — nothing in between. Gap years show "Data not available" on the dashboard.',
  },
  suspensions: {
    sourceLabel: 'NYC DOE Suspension Reports (Local Law 93)',
    sourceUrl: 'https://infohub.nyced.org/reports/government-reports/suspension-reports',
    steps: [
      'Download "Student Discipline - Annual Report on Student Discipline [YEAR]".',
    ],
    fieldCalc: [
      "The hub computes total removals/suspensions per 100 enrolled students. Numerator: 'TOTAL REMOVALS/SUSPENSIONS' from the 'Annual Report--R-P-S TOTALS' tab (SchoolDBN / System_Code = DBN). Denominator: total enrollment for the same year from the schools master (NYC DOE Demographic Snapshot) — load that year's schools master first. Values of 'R' (redacted for small counts) are treated as blank. Formula: (TOTAL REMOVALS/SUSPENSIONS ÷ Total Enrollment) × 100.",
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
    warning:
      'Large file: DOE’s download is ~88 MB and the hub accepts up to 95 MB (a hosting-platform limit). The upload and check take ~30 seconds. If a future file is refused as too large, contact North Arrow.',
  },
  graduation: {
    sourceLabel: 'NYC DOE Graduation Results',
    sourceUrl: 'https://infohub.nyced.org/reports/academics/graduation-results',
    steps: [
      'Download the Graduation Results Excel file for "School".',
      'The file is cohort-keyed — the hub derives school_year automatically (cohort Y graduates in school year (Y+3)-(Y+4), e.g. cohort 2021 → 2024-25).',
    ],
    fieldCalc: ['Field: % grads (4-year cohort rate). High schools only — other schools have no rows.'],
  },
  school_quality: {
    sourceLabel: 'NYC DOE School Quality Reports — Citywide Results',
    sourceUrl:
      'https://infohub.nyced.org/reports/students-and-schools/school-quality/school-quality-reports-and-resources/school-quality-reports-citywide-results',
    steps: [
      'Download all five school-type Excel files (EMS, HS, Transfer HS, D75, Early Childhood) and upload them together, keeping their original filenames.',
    ],
    fieldCalc: ['Sheet: "Summary" — Fields: "Safety - School Percent Positive" (map value) and "Safety and School Climate - Rating" (EMS/HS/Transfer HS, 2023-24 on).'],
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

// --- School master sources ---------------------------------------------------

export interface MasterSourceGuide {
  /** Matches SourceKind in src/admin/schoolMaster/types.ts. */
  kind: 'snapshot' | 'directory' | 'lcgms' | 'community_schools';
  title: string;
  required: boolean;
  sourceLabel: string;
  sourceUrl: string;
  /** What to download, as named on the source page → the file you get. */
  files: Array<{ link: string; filename: string }>;
  /** What the hub takes from it. */
  provides: string;
  /** When a new version usually appears / how often to refresh. */
  cadence: string;
  note?: string;
}

/**
 * The public files the school master is built from, in the order the admin
 * panel lists them. Upload a file as downloaded; the hub recognizes which
 * source it is.
 */
export const MASTER_SOURCE_GUIDES: readonly MasterSourceGuide[] = [
  {
    kind: 'snapshot',
    title: 'Demographic Snapshot',
    required: true,
    sourceLabel: 'NYC DOE InfoHub — Information and Data Overview',
    sourceUrl: 'https://infohub.nyced.org/reports/students-and-schools/school-quality/information-and-data-overview',
    files: [{ link: '“Demographic Snapshot”', filename: 'demographic-snapshot-[year]-to-[year]-public.xlsx' }],
    provides:
      'The school list for every year, school names, enrollment (circle size on the map) and demographics (poverty, ENI, ELL, disability, race, gender). Sheet “School”.',
    cadence: 'Once a year — each release covers five school years.',
  },
  {
    kind: 'directory',
    title: 'Directory Data',
    required: false,
    sourceLabel: 'NYC DOE InfoHub — Directory Data',
    sourceUrl: 'https://infohub.nyced.org/reports/admissions-and-enrollment/directory-data',
    files: [
      { link: '“Fall [Year] High School Data”', filename: 'fall-[year]---hs-directory-data….xlsx' },
      { link: '“Fall [Year] Middle School Data”', filename: 'fall-[year]-middle-school-data.xlsx' },
      { link: '“Fall [Year] Elementary Schools Data”', filename: 'fall-[year]---es-directory-data….xlsx' },
    ],
    provides:
      'Adds real schools the snapshot is missing for a year (name and grades). Pre-K-only centers are left out.',
    cadence: 'Three files per fall. A fall year is used once the snapshot covers that school year (Fall 2025 → 2025-26).',
    note: 'Keep the “fall-[year]” part of the filename — the year is read from it.',
  },
  {
    kind: 'lcgms',
    title: 'LCGMS school data',
    required: true,
    sourceLabel: 'NYC DOE InfoHub — LCGMS',
    sourceUrl: 'https://infohub.nyced.org/in-our-schools/operations/lcgms',
    files: [
      { link: 'LCGMS school data with geocoded fields', filename: 'LCGMS_SchoolData_additional_geocoded_fields_added_.csv' },
      { link: 'LCGMS School Data export', filename: 'LCGMS_SchoolData_[YYYYMMDD]_[time].xls' },
    ],
    provides:
      'Map location (latitude / longitude), borough, address, school type, managing entity and grades — from the geocoded CSV; exact 12-digit BEDS numbers — from the .xls export.',
    cadence: 'When schools open, close or move — refresh both files together.',
    note: 'Both files are needed: the geocoded CSV stores BEDS numbers rounded (e.g. 6.61E+11), and the exact BEDS number is how schools are matched to the Community Schools list.',
  },
  {
    kind: 'community_schools',
    title: 'Community Schools list',
    required: true,
    sourceLabel: 'NYSED — Community Schools Resources',
    sourceUrl: 'https://www.nysed.gov/student-support-services/community-schools-resources',
    files: [
      {
        link: '“Self-reported Community Schools in New York State for the [year] School Year”',
        filename: 'community-schools-list-[year]-[year].pdf',
      },
    ],
    provides: 'The Community School flag: a school is flagged when its BEDS number appears on the list (SED code).',
    cadence: 'Once a year, when NYSED publishes the new list.',
  },
];
