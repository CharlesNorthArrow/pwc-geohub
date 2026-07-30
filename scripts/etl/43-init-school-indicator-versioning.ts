/**
 * ETL 43 — initialize the "School indicators" versioning tables and seed v1
 * for each of the 11 hosted datasets.
 *
 * Idempotent: safe to re-run. Per dataset, skips seed if
 * `school_indicator_dataset_current` already points at a version.
 *
 * Order of operations:
 *  1. Apply `src/db/schema.sql` (adds the school_indicator_dataset_* trio if
 *     missing — no-op for everything else via IF NOT EXISTS).
 *  2. For each dataset with no current pointer: read `data/<csvFile>` and
 *     store it as version 1 (source='seed', created_by='system'). Seeding
 *     through the SAME coercion the upload path uses keeps v1 byte-faithful
 *     to the original data — the first real upload diffs cleanly instead of
 *     reporting phantom changes.
 *
 * The live `school_indicator_values` table is NOT touched here — it's loaded
 * by `etl:indicators`. This script only records the version snapshots.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execScript, pool } from '../lib/db.js';
import { readCsv } from '../lib/csv.js';
import { INDICATOR_DATASETS } from '../../src/admin/indicatorDatasets';
import { indicatorCsvToVersionRows } from '../../src/admin/indicatorTransform';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, '..', '..', 'src', 'db', 'schema.sql');
const DATA_DIR = resolve(__dirname, '..', '..', 'data');

async function main(): Promise<void> {
  console.log(`[etl:indicator-init] applying schema from ${SCHEMA_PATH}`);
  const sqlText = await readFile(SCHEMA_PATH, 'utf-8');
  await execScript(sqlText);

  const p = pool();
  const cur = await p.query(`SELECT dataset FROM school_indicator_dataset_current`);
  const seeded = new Set<string>((cur.rows as Array<{ dataset: string }>).map((r) => r.dataset));

  for (const cfg of INDICATOR_DATASETS) {
    if (seeded.has(cfg.id)) {
      console.log(`[etl:indicator-init] ${cfg.id}: current pointer already set. Skipping.`);
      continue;
    }
    const path = resolve(DATA_DIR, cfg.csvFile);
    const rawRows = (await readCsv(path)) as Array<Record<string, string>>;
    const { rows, remapCount } = indicatorCsvToVersionRows(rawRows, cfg);
    if (rows.length === 0) {
      console.log(`[etl:indicator-init] ${cfg.id}: no rows in ${cfg.csvFile} — skipping seed.`);
      continue;
    }

    await p.query('BEGIN');
    try {
      const verRes = await p.query(
        `INSERT INTO school_indicator_dataset_versions (dataset, created_by, source, notes, row_count)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING version_id`,
        [cfg.id, 'system', 'seed', `Initial seed from data/${cfg.csvFile}`, rows.length],
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
          `INSERT INTO school_indicator_dataset_version_rows (version_id, dbn, school_year, payload)
           VALUES ${tuples.join(', ')}`,
          params,
        );
      }

      await p.query(
        `INSERT INTO school_indicator_dataset_current (dataset, version_id, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (dataset) DO UPDATE SET version_id = EXCLUDED.version_id, updated_at = EXCLUDED.updated_at`,
        [cfg.id, versionId],
      );
      await p.query('COMMIT');
      console.log(
        `[etl:indicator-init] ${cfg.id}: seeded v${versionId} (${rows.length} rows, remaps: ${remapCount}) as current`,
      );
    } catch (err) {
      await p.query('ROLLBACK');
      throw err;
    }
  }
}

main()
  .then(() => {
    // Explicit exit — the Neon WebSocket pool's idle connections can throw
    // during implicit shutdown behind this network's TLS proxy.
    process.exit(0);
  })
  .catch((err) => {
    console.error('[etl:indicator-init] failed:', err);
    process.exit(1);
  });
