/**
 * Parity harness for the raw-file transforms (src/admin/rawTransforms).
 *
 * Runs every TS transform over the raw DOE files in `<RAW_DIR>/input/<Folder>/`
 * — the same tree the Python scripts in scripts/scripts/ read — and compares
 * the typed values per (DBN, school_year, field) against:
 *   - `<RAW_DIR>/output/<dataset>.csv` (fresh Python run), when present
 *   - `data/<dataset>.csv` (what's loaded in the hub today)
 *
 * The raw files are not in the repo (they live in Charles's Drive).
 *
 * Run: npm run test:raw-transforms -- <RAW_DIR>
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { getRawTransform } from '../src/admin/rawTransforms/index.js';
import { npRound, pyFixed, pyRound } from '../src/admin/rawTransforms/workbook.js';
import { getIndicatorDataset } from '../src/admin/indicatorDatasets.js';
import type { CanonicalRow, TransformContext } from '../src/admin/rawTransforms/types.js';

const RAW_DIR = process.argv[2];
if (!RAW_DIR) {
  console.error('usage: npm run test:raw-transforms -- <RAW_DIR containing input/>');
  process.exit(2);
}

let failed = 0;
const check = (name: string, cond: boolean, detail?: unknown): void => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed++;
    console.error(`  ✗ ${name}`, detail ?? '');
  }
};

console.log('== rounding matches Python ==');
check('pyFixed(12.25, 1) = 12.2 (tie → even)', pyFixed(12.25, 1) === '12.2');
check('pyFixed(12.75, 1) = 12.8', pyFixed(12.75, 1) === '12.8');
check('pyRound(2.675, 2) = 2.67 (binary below tie)', pyRound(2.675, 2) === 2.67);
check('npRound(0.125, 2) = 0.12 (numpy rint)', npRound(0.125, 2) === 0.12);
check('pyFixed(0.05, 1) = 0.1', pyFixed(0.05, 1) === '0.1');

// Dataset → input folder, plus the Python's per-file year rule where the
// generic filename guess differs (teacher 2023-24 file has no year in it).
const FOLDERS: Record<string, string> = {
  arts_ed: 'Arts_Ed',
  suspensions: 'Suspensions',
  temp_housing: 'Temp_Housing',
  math: 'Math',
  ela: 'ELA',
  chronic_absenteeism: 'Chronic_Absenteeism',
  graduation: 'Graduation',
  school_quality: 'School_Quality',
  family_survey: 'Family_Survey',
  teacher_survey: 'Teacher_Survey',
  student_survey: 'Student_Survey',
};
/**
 * Rows where the TS port deliberately differs from the Python output, with
 * the reason. Anything not listed here must match exactly.
 */
const KNOWN_EXTRA: Record<string, Record<string, string>> = {
  teacher_survey: {
    // teacher_survey.py starts 2025 data at row 4, but that file's first
    // school sits at row 3 (the codes row is row 2) — the script drops it.
    '01M015|2024-25': 'teacher_survey.py data_start=4 skips the first 2025 school',
  },
};

const yearOverride = (dataset: string, file: string): string | undefined =>
  dataset === 'teacher_survey' && file.toLowerCase().includes('nycps') ? '2023-24' : undefined;

function readCsv(path: string): Array<Record<string, string>> {
  return parse(readFileSync(path, 'utf8'), { columns: true, bom: true, skip_empty_lines: true }) as Array<
    Record<string, string>
  >;
}

function enrollmentMap(): Map<string, number | null> {
  const m = new Map<string, number | null>();
  for (const r of readCsv('data/schools_master.csv')) {
    const n = r.total_enrollment === '' ? null : Number(r.total_enrollment);
    m.set(`${r.DBN}|${r.school_year}`, Number.isFinite(n) ? n : null);
  }
  return m;
}

const sameValue = (a: string | undefined, b: string | undefined): boolean => {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  if (x === y) return true;
  const nx = Number(x);
  const ny = Number(y);
  return x !== '' && y !== '' && Number.isFinite(nx) && Number.isFinite(ny) && Math.abs(nx - ny) < 1e-9;
};

/** Last-wins by (DBN, school_year) — the loader's dedupe semantics. */
const keyed = (rows: ReadonlyArray<Record<string, string>>): Map<string, Record<string, string>> =>
  new Map(rows.map((r) => [`${r.DBN}|${r.school_year}`, r]));

function compare(
  label: string,
  ours: CanonicalRow[],
  theirs: Array<Record<string, string>>,
  fields: string[],
  knownExtra: Record<string, string> = {},
): void {
  const a = keyed(ours);
  const b = keyed(theirs);
  const missing = [...b.keys()].filter((k) => !a.has(k));
  const allExtra = [...a.keys()].filter((k) => !b.has(k));
  const extra = allExtra.filter((k) => !(k in knownExtra));
  for (const k of allExtra.filter((k) => k in knownExtra)) console.log(`    ℹ known extra ${k}: ${knownExtra[k]}`);
  const diffs: string[] = [];
  let diffCount = 0;
  for (const [k, r] of a) {
    const t = b.get(k);
    if (!t) continue;
    for (const f of fields) {
      if (!sameValue(r[f], t[f])) {
        diffCount++;
        if (diffs.length < 6) diffs.push(`${k} ${f}: ts=${JSON.stringify(r[f])} ref=${JSON.stringify(t[f])}`);
      }
    }
  }
  check(
    `${label}: ${a.size} keys vs ${b.size} — missing ${missing.length}, extra ${extra.length}, field diffs ${diffCount}`,
    missing.length === 0 && extra.length === 0 && diffCount === 0,
    { missing: missing.slice(0, 5), extra: extra.slice(0, 5), diffs },
  );
}

const enrollment = enrollmentMap();
const only = process.argv[3];

for (const [dataset, folder] of Object.entries(FOLDERS)) {
  if (only && only !== dataset) continue;
  const dir = join(RAW_DIR, 'input', folder);
  console.log(`\n== ${dataset} ==`);
  if (!existsSync(dir)) {
    console.log(`  (skipped — ${dir} not found)`);
    continue;
  }
  const transform = getRawTransform(dataset)!;
  const cfg = getIndicatorDataset(dataset)!;
  const fields = cfg.fields.map((f) => f.id).filter((f) => f !== 'DBN' && f !== 'school_year');
  const names = readdirSync(dir).filter((f) => transform.accepts.some((e) => f.toLowerCase().endsWith(e))).sort();

  // Run per file (as the admin would, one year at a time) — except
  // school_quality, whose five files per year belong to one upload.
  const batches = dataset === 'school_quality' ? [names] : names.map((n) => [n]);
  const rows: CanonicalRow[] = [];
  for (const batch of batches) {
    const files = batch.map((n) => ({ name: n, data: new Uint8Array(readFileSync(join(dir, n))) }));
    const ctx: TransformContext = { enrollment };
    const override = batch.length === 1 ? yearOverride(dataset, batch[0]!) : undefined;
    if (override) ctx.schoolYear = override;
    const t0 = Date.now();
    const res = transform.run(files, ctx);
    const label = batch.length === 1 ? batch[0] : `${batch.length} files`;
    check(`${label}: no blocking errors (${res.rows.length} rows, ${Date.now() - t0} ms)`, res.errors.length === 0, res.errors);
    for (const w of res.warnings) console.log(`    ⚠ [${w.code}] ${w.file ?? ''} ${w.message}`);
    rows.push(...res.rows);
  }

  const pyOut = join(RAW_DIR, 'output', cfg.csvFile);
  const known = KNOWN_EXTRA[dataset];
  if (existsSync(pyOut)) compare('vs Python output', rows, readCsv(pyOut), fields, known);
  compare('vs data/ (loaded today)', rows, readCsv(join('data', cfg.csvFile)), fields, known);
}

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
