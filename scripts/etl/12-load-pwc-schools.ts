/**
 * ETL 12 — load `pwc_schools - pwc_schools.csv` → `pwc_school_program`.
 *
 * - Apply DBN remap.
 * - Rename source `school_type` (DOE/Charter/D75 governance) → `governance_school_type`.
 * - Coerce 0/1 fields to BOOLEAN; preserve all-null program rows.
 * - Emit the Anchor / Healing Arts overlap count for the data-quality report
 *   (Q1 default: Anchor=core_school=1, Healing Arts=arts_program=1, overlap allowed).
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../lib/db.js';
import { readCsv } from '../lib/csv.js';
import { normalizeDbn, wasDbnRemapped, KNOWN_UNMATCHED_DBNS } from '../lib/dbn.js';
import { toNullableBool, toNullableInt, toNullableText } from '../lib/normalize.js';
import { recordFinding } from '../lib/findings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', '..', 'data');
const PWC_PATH = resolve(DATA_DIR, 'pwc_schools - pwc_schools.csv');

interface PwcRow {
  DBN: string;
  school_year: string;
  core_school: string;
  level: string;
  grade_served: string;
  school_type: string;
  cohort: string;
  year_partnership_began: string;
  social_work_program: string;
  community_school_program: string;
  community_school_program_status: string;
  arts_program: string;
  arts_program_type: string;
  ost_program: string;
  ost_program_type: string;
  food_pantry: string;
  laundry: string;
  sw_caseload_students: string;
  students_individual_contacts: string;
  number_individual_contacts: string;
  students_group_contacts: string;
  number_group_contacts: string;
  total_students_served_sw: string;
  total_contacts_sw: string;
  school_enrollment_pwc: string;
}

async function main(): Promise<void> {
  console.log(`[etl:pwc] reading ${PWC_PATH}`);
  const rows = (await readCsv(PWC_PATH)) as unknown as PwcRow[];

  const sql = db();
  const validDbns = (await sql`SELECT dbn FROM schools`) as Array<{ dbn: string }>;
  const validSet = new Set(validDbns.map((r) => r.dbn));

  let inserted = 0;
  let unmatched = 0;
  let remapApplied = 0;
  const uniqueDbns = new Set<string>();
  const dbnYearAnchor = new Map<string, boolean>();
  const dbnYearArts = new Map<string, boolean>();

  for (const r of rows) {
    if (wasDbnRemapped(r.DBN)) remapApplied++;
    const dbn = normalizeDbn(r.DBN);
    if (!dbn || !r.school_year) continue;
    uniqueDbns.add(dbn);
    if (!validSet.has(dbn)) {
      unmatched++;
      await recordFinding('unmatched_dbn', `pwc:${dbn}`, {
        dbn,
        known_closed: KNOWN_UNMATCHED_DBNS.has(dbn),
        school_year: r.school_year,
      });
      continue;
    }

    const core_school = toNullableBool(r.core_school);
    const arts_program = toNullableBool(r.arts_program);
    // Track overlap on the latest year only (the spec's overlap figure).
    if (r.school_year === '2024-25') {
      if (core_school) dbnYearAnchor.set(dbn, true);
      if (arts_program) dbnYearArts.set(dbn, true);
    }

    await sql`
      INSERT INTO pwc_school_program (
        dbn, school_year, core_school, arts_program, social_work_program,
        community_school_program, community_school_program_status, arts_program_type,
        ost_program, ost_program_type, food_pantry, laundry, cohort, level, grade_served,
        governance_school_type, year_partnership_began,
        sw_caseload_students, students_individual_contacts, number_individual_contacts,
        students_group_contacts, number_group_contacts,
        total_students_served_sw, total_contacts_sw, school_enrollment_pwc
      ) VALUES (
        ${dbn}, ${r.school_year},
        ${core_school}, ${arts_program}, ${toNullableBool(r.social_work_program)},
        ${toNullableBool(r.community_school_program)},
        ${toNullableText(r.community_school_program_status)},
        ${toNullableText(r.arts_program_type)},
        ${toNullableBool(r.ost_program)}, ${toNullableText(r.ost_program_type)},
        ${toNullableBool(r.food_pantry)}, ${toNullableBool(r.laundry)},
        ${toNullableText(r.cohort)}, ${toNullableText(r.level)}, ${toNullableText(r.grade_served)},
        ${toNullableText(r.school_type)}, ${toNullableInt(r.year_partnership_began)},
        ${toNullableInt(r.sw_caseload_students)},
        ${toNullableInt(r.students_individual_contacts)},
        ${toNullableInt(r.number_individual_contacts)},
        ${toNullableInt(r.students_group_contacts)},
        ${toNullableInt(r.number_group_contacts)},
        ${toNullableInt(r.total_students_served_sw)},
        ${toNullableInt(r.total_contacts_sw)},
        ${toNullableInt(r.school_enrollment_pwc)}
      )
      ON CONFLICT (dbn, school_year) DO UPDATE SET
        core_school = EXCLUDED.core_school,
        arts_program = EXCLUDED.arts_program,
        social_work_program = EXCLUDED.social_work_program,
        community_school_program = EXCLUDED.community_school_program,
        community_school_program_status = EXCLUDED.community_school_program_status,
        arts_program_type = EXCLUDED.arts_program_type,
        ost_program = EXCLUDED.ost_program, ost_program_type = EXCLUDED.ost_program_type,
        food_pantry = EXCLUDED.food_pantry, laundry = EXCLUDED.laundry,
        cohort = EXCLUDED.cohort, level = EXCLUDED.level, grade_served = EXCLUDED.grade_served,
        governance_school_type = EXCLUDED.governance_school_type,
        year_partnership_began = EXCLUDED.year_partnership_began,
        sw_caseload_students = EXCLUDED.sw_caseload_students,
        students_individual_contacts = EXCLUDED.students_individual_contacts,
        number_individual_contacts = EXCLUDED.number_individual_contacts,
        students_group_contacts = EXCLUDED.students_group_contacts,
        number_group_contacts = EXCLUDED.number_group_contacts,
        total_students_served_sw = EXCLUDED.total_students_served_sw,
        total_contacts_sw = EXCLUDED.total_contacts_sw,
        school_enrollment_pwc = EXCLUDED.school_enrollment_pwc
    `;
    inserted++;
  }

  const overlap = [...dbnYearAnchor.keys()].filter((d) => dbnYearArts.get(d) === true);
  await recordFinding('anchor_healing_overlap', '2024-25', {
    anchor_count: dbnYearAnchor.size,
    healing_arts_count: dbnYearArts.size,
    overlap_count: overlap.length,
    q1_defaults: {
      anchor: 'core_school = 1',
      healing_arts: 'arts_program = 1',
      note: 'Spec §12 Q1 defaults; confirm with PWC before Phase 2.',
    },
  });

  await recordFinding('ingestion_summary', 'pwc_schools', {
    csv_rows: rows.length,
    unique_dbns: uniqueDbns.size,
    inserted,
    unmatched_dbns: unmatched,
    remaps_applied: remapApplied,
  });

  console.log(
    `[etl:pwc] ${inserted} inserted, ${unmatched} unmatched, ${uniqueDbns.size} unique DBNs ` +
      `(2024-25: Anchor=${dbnYearAnchor.size}, HealingArts=${dbnYearArts.size}, both=${overlap.length})`,
  );
}

main().catch((err) => {
  console.error('[etl:pwc] failed:', err);
  process.exit(1);
});
