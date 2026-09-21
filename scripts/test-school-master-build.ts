/**
 * Parity harness for the school master build (src/admin/schoolMaster).
 *
 * Parses every source file in <SRC_DIR> (the Drive "Main Dataset" folder
 * layout — unrecognized files are skipped), builds the master, and compares
 * it per (DBN, school_year, field) with a reference CSV — typically the
 * current live version (admin "Download current CSV"). Both sides go through
 * the upload path's DBN remap + schema coercion, so the comparison is on the
 * values the hub would actually store.
 *
 * Run: npm run test:school-master-build -- <SRC_DIR> <reference.csv>
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { parseMasterSourceFile } from '../src/admin/schoolMaster/parseSources.js';
import { buildMaster } from '../src/admin/schoolMaster/build.js';
import { MASTER_FIELDS } from '../src/admin/schoolMasterSchema.js';
import { coerceRow, type NormalizedRow, type Payload } from '../src/admin/merge.js';
import { normalizeDbn } from '../src/lib/dbn.js';
import type { SourceRecord } from '../src/admin/schoolMaster/types.js';

const [SRC_DIR, REF] = process.argv.slice(2);
if (!SRC_DIR || !REF) {
  console.error('usage: npm run test:school-master-build -- <SRC_DIR> <reference.csv>');
  process.exit(2);
}

const toPayloads = (rows: ReadonlyArray<Record<string, string>>): Map<string, Payload> => {
  const out = new Map<string, Payload>();
  for (const raw of rows) {
    const n: NormalizedRow = {};
    for (const f of MASTER_FIELDS) n[f.id] = raw[f.id] == null || raw[f.id] === '' ? null : raw[f.id]!;
    n.DBN = normalizeDbn(n.DBN);
    const c = coerceRow(n, MASTER_FIELDS);
    if (c) out.set(`${c.dbn}|${c.school_year}`, c.payload);
  }
  return out;
};

const same = (a: unknown, b: unknown): boolean =>
  a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);

const slots = new Map<string, SourceRecord>();
for (const name of readdirSync(SRC_DIR).sort()) {
  const t0 = Date.now();
  const parsed = await parseMasterSourceFile({ name, data: new Uint8Array(readFileSync(join(SRC_DIR, name))) });
  const ms = Date.now() - t0;
  if (!parsed.record) {
    const codes = parsed.errors.map((e) => e.code).join(', ');
    console.log(`  · ${name}: ${codes === 'not_recognized' ? 'not a master source — skipped' : `BLOCKED [${codes}]`}`);
    if (codes !== 'not_recognized') for (const e of parsed.errors) console.log(`      ${e.message}`);
    continue;
  }
  if (slots.has(parsed.record.slot)) console.log(`  ! ${name}: same slot as ${slots.get(parsed.record.slot)!.filename} — using ${name}`);
  slots.set(parsed.record.slot, parsed.record);
  console.log(`  ✓ ${name} → ${parsed.record.slot} (${parsed.record.summary}, ${ms} ms)`);
  for (const w of parsed.warnings) console.log(`      ⚠ [${w.code}] ${w.message}`);
}

const built = buildMaster([...slots.values()]);
for (const e of built.errors) console.log(`  ✗ ${e.message}`);
for (const w of built.warnings) console.log(`  ⚠ [${w.code}] ${w.message}`);
console.log('coverage', JSON.stringify(built.coverage));

const ours = toPayloads(built.rows);
const ref = toPayloads(parse(readFileSync(REF, 'utf8'), { columns: true, bom: true, skip_empty_lines: true }));
const missing = [...ref.keys()].filter((k) => !ours.has(k));
const extra = [...ours.keys()].filter((k) => !ref.has(k));
let diffs = 0;
const samples: string[] = [];
const byField: Record<string, number> = {};
for (const [k, a] of ours) {
  const b = ref.get(k);
  if (!b) continue;
  for (const f of MASTER_FIELDS) {
    if (f.isKey) continue;
    if (!same(a[f.id] ?? null, b[f.id] ?? null)) {
      diffs++;
      byField[f.id] = (byField[f.id] ?? 0) + 1;
      if (samples.length < 8) samples.push(`${k} ${f.id}: built=${JSON.stringify(a[f.id])} ref=${JSON.stringify(b[f.id])}`);
    }
  }
}
const ok = built.errors.length === 0 && missing.length === 0 && extra.length === 0 && diffs === 0;
console.log(
  `\n${ok ? '✓' : '✗'} ${ours.size} keys vs ${ref.size} — missing ${missing.length}, extra ${extra.length}, field diffs ${diffs}`,
);
if (!ok) console.log({ missing: missing.slice(0, 8), extra: extra.slice(0, 8), byField, samples });
process.exit(ok ? 0 : 1);
