/**
 * ETL 00 — initialize the Neon schema.
 *
 * Enables PostGIS and applies `src/db/schema.sql` (idempotent). Run once at
 * setup and after any schema change.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execScript, db } from '../lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, '..', '..', 'src', 'db', 'schema.sql');

async function main(): Promise<void> {
  console.log(`[etl:init] applying schema from ${SCHEMA_PATH}`);
  const sqlText = await readFile(SCHEMA_PATH, 'utf-8');
  await execScript(sqlText);

  // Sanity check: confirm PostGIS is live and required tables exist.
  const sql = db();
  const postgis = (await sql`SELECT postgis_version() AS v`) as Array<{ v: string }>;
  console.log(`[etl:init] PostGIS: ${postgis[0]?.v ?? 'unknown'}`);

  const tables = (await sql`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public'
     ORDER BY table_name
  `) as Array<{ table_name: string }>;
  console.log(`[etl:init] public tables: ${tables.map((t) => t.table_name).join(', ')}`);
}

main().catch((err) => {
  console.error('[etl:init] failed:', err);
  process.exit(1);
});
