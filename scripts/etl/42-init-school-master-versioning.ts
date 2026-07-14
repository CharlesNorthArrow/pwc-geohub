/**
 * ETL 42 — initialize the "School data master" versioning tables and seed v1.
 *
 * Idempotent: safe to re-run. Skips seed if `school_master_current` already
 * points at a version.
 *
 * Order of operations:
 *  1. Apply `src/db/schema.sql` (adds school_master_versions / _rows /
 *     _current if missing — no-op for everything else via IF NOT EXISTS).
 *  2. If no current pointer yet: read `data/schools_master.csv` and store it
 *     as version 1 (source='seed', created_by='system'). Seeding from the
 *     CSV (through the SAME coercion the upload path uses) keeps v1
 *     byte-faithful to the original data — the first real upload then diffs
 *     cleanly instead of reporting phantom changes.
 *
 * The live `schools` / `schools_year` tables are NOT touched here — they're
 * loaded by `etl:schools`. This script only records the version snapshot.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execScript, pool } from '../lib/db.js';
import { readCsv } from '../lib/csv.js';
import { masterCsvToVersionRows } from '../../src/admin/schoolMasterTransform';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, '..', '..', 'src', 'db', 'schema.sql');
const MASTER_PATH = resolve(__dirname, '..', '..', 'data', 'schools_master.csv');

async function main(): Promise<void> {
  console.log(`[etl:school-master-init] applying schema from ${SCHEMA_PATH}`);
  const sqlText = await readFile(SCHEMA_PATH, 'utf-8');
  await execScript(sqlText);

  const p = pool();
  const cur = await p.query(`SELECT version_id FROM school_master_current WHERE pin = 1`);
  if (cur.rows.length > 0) {
    console.log(`[etl:school-master-init] current pointer already set → v${cur.rows[0].version_id}. Nothing to seed.`);
    return;
  }

  console.log(`[etl:school-master-init] reading ${MASTER_PATH}`);
  const rawRows = (await readCsv(MASTER_PATH)) as Array<Record<string, string>>;
  const { rows, remapCount } = masterCsvToVersionRows(rawRows);
  if (rows.length === 0) {
    console.log(`[etl:school-master-init] no rows in schools_master.csv — skipping seed.`);
    return;
  }
  console.log(`[etl:school-master-init] seeding version 1 from ${rows.length} CSV rows (remaps applied: ${remapCount})`);

  await p.query('BEGIN');
  try {
    const verRes = await p.query(
      `INSERT INTO school_master_versions (created_by, source, notes, row_count)
       VALUES ($1, $2, $3, $4)
       RETURNING version_id`,
      ['system', 'seed', 'Initial seed from data/schools_master.csv', rows.length],
    );
    const versionId = (verRes.rows[0] as { version_id: number }).version_id;

    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const tuples: string[] = [];
      const params: unknown[] = [];
      let n = 1;
      for (const r of chunk) {
        tuples.push(`($${n++}, $${n++}, $${n++}, $${n++}::jsonb)`);
        params.push(versionId, r.dbn, r.school_year, JSON.stringify(r.payload));
      }
      await p.query(
        `INSERT INTO school_master_version_rows (version_id, dbn, school_year, payload)
         VALUES ${tuples.join(', ')}`,
        params,
      );
    }

    await p.query(
      `INSERT INTO school_master_current (pin, version_id, updated_at)
       VALUES (1, $1, now())
       ON CONFLICT (pin) DO UPDATE SET version_id = EXCLUDED.version_id, updated_at = EXCLUDED.updated_at`,
      [versionId],
    );
    await p.query('COMMIT');
    console.log(`[etl:school-master-init] seeded version ${versionId} (${rows.length} rows) as current`);
  } catch (err) {
    await p.query('ROLLBACK');
    throw err;
  }
}

main()
  .then(() => {
    // Explicit exit — the Neon WebSocket pool's idle connections can throw
    // during implicit shutdown behind this network's TLS proxy.
    process.exit(0);
  })
  .catch((err) => {
    console.error('[etl:school-master-init] failed:', err);
    process.exit(1);
  });
