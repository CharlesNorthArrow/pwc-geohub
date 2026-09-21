/**
 * ETL 44 — seed the school-master source extracts from a folder of raw files.
 *
 * The admin "Update sources" flow rebuilds the master from the stored extract
 * of every source, so the store needs one complete set before the first
 * admin update. Point this at the folder holding the files the current
 * master was built from (the Drive "Public Data Indicators/Input/Main
 * Dataset" folder): Demographic Snapshot, Directory data, both LCGMS files,
 * the Community Schools PDF. Other files in the folder are skipped.
 *
 * Idempotent: applies src/db/schema.sql (adds the table if missing) and
 * upserts one row per source slot. Does NOT create a master version or touch
 * `schools` / `schools_year`.
 *
 * Run: npm run etl:school-master-sources-init -- "<folder>"
 */

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { execScript, pool } from '../lib/db.js';
import { parseMasterSourceFile } from '../../src/admin/schoolMaster/parseSources';
import { buildMaster } from '../../src/admin/schoolMaster/build';
import { saveSources } from '../../src/server/schoolMasterSourcesDb';
import type { SourceRecord } from '../../src/admin/schoolMaster/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, '..', '..', 'src', 'db', 'schema.sql');

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: npm run etl:school-master-sources-init -- "<folder of raw source files>"');

  const bySlot = new Map<string, SourceRecord>();
  let blocked = 0;
  for (const name of (await readdir(dir)).sort()) {
    const parsed = await parseMasterSourceFile({ name, data: new Uint8Array(await readFile(join(dir, name))) });
    if (!parsed.record) {
      if (parsed.errors.every((e) => e.code === 'not_recognized')) {
        console.log(`  · ${name} — not a master source, skipped`);
      } else {
        blocked++;
        console.error(`  ✗ ${name}: ${parsed.errors.map((e) => e.message).join(' | ')}`);
      }
      continue;
    }
    if (bySlot.has(parsed.record.slot)) {
      console.log(`  ! ${name} and ${bySlot.get(parsed.record.slot)!.filename} are the same source — keeping ${name}`);
    }
    bySlot.set(parsed.record.slot, parsed.record);
    console.log(`  ✓ ${name} → ${parsed.record.slot} (${parsed.record.summary})`);
  }
  if (blocked > 0) throw new Error(`${blocked} file(s) could not be parsed — nothing stored.`);

  const records = [...bySlot.values()];
  const check = buildMaster(records);
  if (check.errors.length > 0) {
    throw new Error(`Incomplete source set — ${check.errors.map((e) => e.message).join(' ')}`);
  }
  console.log(`[etl:school-master-sources-init] set builds ${check.coverage!.rowCount} master rows`);

  console.log(`[etl:school-master-sources-init] applying schema from ${SCHEMA_PATH}`);
  await execScript(await readFile(SCHEMA_PATH, 'utf-8'));
  await saveSources(pool(), records, 'seed');
  console.log(`[etl:school-master-sources-init] stored ${records.length} source extracts`);
}

main()
  .then(() => {
    // Explicit exit — the Neon WebSocket pool's idle connections can throw
    // during implicit shutdown behind this network's TLS proxy.
    process.exit(0);
  })
  .catch((err) => {
    console.error('[etl:school-master-sources-init] failed:', err);
    process.exit(1);
  });
