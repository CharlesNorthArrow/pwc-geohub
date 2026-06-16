/**
 * ETL 40 — initialize the Admin Panel versioning tables and seed v1.
 *
 * Idempotent: safe to re-run. Skips seed if `pwc_program_current` already
 * points at a version.
 *
 * Order of operations:
 *  1. Apply `src/db/schema.sql` (adds pwc_program_versions / _rows / _current
 *     if missing — also a no-op for everything else thanks to IF NOT EXISTS).
 *  2. If no current pointer yet AND `pwc_school_program` has rows: snapshot
 *     the live table as version 1 (source='seed', created_by='system') and
 *     point _current at it. This is the only path that creates a version
 *     without going through the Admin UI.
 *
 * Without step 2 the Admin Panel would show an empty version history on day
 * one and have nothing to compare an upload's diff against — which is the
 * exact moment a "looks like every row is new" foot-gun would fire.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execScript, pool } from '../lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, '..', '..', 'src', 'db', 'schema.sql');

const PAYLOAD_COLUMNS = [
  'core_school', 'arts_program', 'social_work_program',
  'community_school_program', 'community_school_program_status', 'arts_program_type',
  'ost_program', 'ost_program_type', 'food_pantry', 'laundry',
  'cohort', 'level', 'grade_served',
  'governance_school_type', 'year_partnership_began',
  'sw_caseload_students', 'students_individual_contacts', 'number_individual_contacts',
  'students_group_contacts', 'number_group_contacts',
  'total_students_served_sw', 'total_contacts_sw', 'school_enrollment_pwc',
] as const;

async function main(): Promise<void> {
  console.log(`[etl:admin-init] applying schema from ${SCHEMA_PATH}`);
  const sqlText = await readFile(SCHEMA_PATH, 'utf-8');
  await execScript(sqlText);

  const p = pool();
  const cur = await p.query(`SELECT version_id FROM pwc_program_current WHERE pin = 1`);
  if (cur.rows.length > 0) {
    console.log(`[etl:admin-init] current pointer already set → v${cur.rows[0].version_id}. Nothing to seed.`);
    return;
  }

  const liveRes = await p.query(
    `SELECT dbn, school_year, ${PAYLOAD_COLUMNS.join(', ')} FROM pwc_school_program`,
  );
  const rows = liveRes.rows as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    console.log(`[etl:admin-init] pwc_school_program is empty — skipping seed. Run etl:pwc first, then re-run this.`);
    return;
  }

  console.log(`[etl:admin-init] seeding version 1 from ${rows.length} live rows`);

  await p.query('BEGIN');
  try {
    const verRes = await p.query(
      `INSERT INTO pwc_program_versions (created_by, source, notes, row_count)
       VALUES ($1, $2, $3, $4)
       RETURNING version_id`,
      ['system', 'seed', 'Initial seed from live pwc_school_program', rows.length],
    );
    const versionId = (verRes.rows[0] as { version_id: number }).version_id;

    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const tuples: string[] = [];
      const params: unknown[] = [];
      let n = 1;
      for (const r of chunk) {
        const payload: Record<string, unknown> = {};
        for (const c of PAYLOAD_COLUMNS) payload[c] = r[c] ?? null;
        tuples.push(`($${n++}, $${n++}, $${n++}, $${n++}::jsonb)`);
        params.push(versionId, r.dbn, r.school_year, JSON.stringify(payload));
      }
      await p.query(
        `INSERT INTO pwc_program_version_rows (version_id, dbn, school_year, payload)
         VALUES ${tuples.join(', ')}`,
        params,
      );
    }

    await p.query(
      `INSERT INTO pwc_program_current (pin, version_id, updated_at)
       VALUES (1, $1, now())
       ON CONFLICT (pin) DO UPDATE SET version_id = EXCLUDED.version_id, updated_at = EXCLUDED.updated_at`,
      [versionId],
    );
    await p.query('COMMIT');
    console.log(`[etl:admin-init] seeded version ${versionId} (${rows.length} rows) as current`);
  } catch (err) {
    await p.query('ROLLBACK');
    throw err;
  }
}

main().catch((err) => {
  console.error('[etl:admin-init] failed:', err);
  process.exit(1);
});
