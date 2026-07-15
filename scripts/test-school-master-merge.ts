/**
 * Tests for the "School data master" admin pieces built on the generalized
 * merge/reconciliation layer.
 *
 * The load-bearing tests:
 *   1. number coercion — floats parse; sentinels ("Above 95%", "R") and
 *      thousands separators behave like the ETL normalizer.
 *   2. mergeRows with MASTER_FIELDS — update & append, never delete.
 *   3. Identity derivation — latest year WITH coordinates wins; fallback to
 *      latest year overall; EWKT geometry string.
 *   4. schools_year fanout — count columns rounded, fractions kept as-is.
 *   5. masterCsvToVersionRows — 08X208→84X208 remap + duplicate last-wins.
 *   6. applyRollbackOverlay — target payloads win; rows added after the
 *      target survive (no-delete invariant).
 *
 * Run: `npm run test:school-master-merge`.
 */

import { classifyColumns } from '../src/admin/columnReconciliation.js';
import { mergeRows, coerceValue, type CurrentRow, type NormalizedRow } from '../src/admin/merge.js';
import { MASTER_FIELDS, MASTER_DATA_FIELDS } from '../src/admin/schoolMasterSchema.js';
import {
  deriveSchoolIdentities,
  deriveSchoolYearRecords,
  masterCsvToVersionRows,
  applyRollbackOverlay,
  SCHOOLS_YEAR_COLUMNS,
  type MasterVersionRow,
} from '../src/admin/schoolMasterTransform.js';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
    if (detail !== undefined) console.error('    detail:', detail);
  }
}

console.log('== coerceValue :: number ==');
{
  check('coerce "0.85" → 0.85', coerceValue('0.85', 'number') === 0.85);
  check('coerce "1,234" → 1234 (thousands sep)', coerceValue('1,234', 'number') === 1234);
  check('coerce "Above 95%" → null (sentinel)', coerceValue('Above 95%', 'number') === null);
  check('coerce "R" → null (redaction sentinel)', coerceValue('R', 'number') === null);
  check('coerce "N/A" → null', coerceValue('N/A', 'number') === null);
  check('coerce "" → null', coerceValue('', 'number') === null);
  check('coerce "abc" → null', coerceValue('abc', 'number') === null);
}

console.log('\n== classifyColumns against MASTER_FIELDS ==');
{
  const headers = MASTER_FIELDS.map((f) => f.id);
  const cls = classifyColumns(headers, MASTER_FIELDS);
  check('all 35 columns match exactly', cls.matched.length === 35 && cls.missing.length === 0 && cls.unmatched.length === 0);
}

console.log('\n== mergeRows with MASTER_FIELDS :: update & append, never delete ==');
{
  const current: CurrentRow[] = [
    { dbn: '13K067', school_year: '2023-24', payload: pl({ school_name: 'P.S. 067', total_enrollment: 196, pct_poverty: 0.9 }) },
    { dbn: '13K067', school_year: '2024-25', payload: pl({ school_name: 'P.S. 067', total_enrollment: 200, pct_poverty: 0.92 }) },
  ];
  const incoming: NormalizedRow[] = [
    row({ DBN: '13K067', school_year: '2024-25', school_name: 'P.S. 067', total_enrollment: '210', pct_poverty: '0.92' }),
    row({ DBN: '99Z999', school_year: '2025-26', school_name: 'New School', total_enrollment: '500' }),
    // 2023-24 omitted — retained.
  ];
  const m = mergeRows(current, incoming, MASTER_FIELDS);
  check('one update, one add, one retained', m.updated.length === 1 && m.added.length === 1 && m.retained.length === 1);
  check('no deletions: newVersionRows === current + added', m.newVersionRows.length === current.length + m.added.length);
  check('update changed total_enrollment only', JSON.stringify(m.updated[0]!.changedColumns) === JSON.stringify(['total_enrollment']));
  check('sentinel-free typed equality: pct_poverty 0.92 unchanged', !m.updated[0]!.changedColumns.includes('pct_poverty'));
}

console.log('\n== deriveSchoolIdentities :: latest year with coords wins ==');
{
  const rows: MasterVersionRow[] = [
    mr('01M001', '2022-23', { school_name: 'Old Name', latitude: 40.7, longitude: -73.9, address: 'Old Addr' }),
    mr('01M001', '2024-25', { school_name: 'New Name', latitude: null, longitude: null, address: 'New Addr' }),
    mr('01M001', '2023-24', { school_name: 'Mid Name', latitude: 40.8, longitude: -74.0, address: 'Mid Addr' }),
  ];
  const ids = deriveSchoolIdentities(rows);
  check('one identity per DBN', ids.length === 1);
  const id = ids[0]!;
  check('identity from 2023-24 (latest WITH coords)', id.identity_source_year === '2023-24' && id.school_name === 'Mid Name');
  check('EWKT geometry is POINT(lon lat)', id.geom_ewkt === 'SRID=4326;POINT(-74 40.8)');
}
{
  const rows: MasterVersionRow[] = [
    mr('02M002', '2023-24', { school_name: 'No Coords A', latitude: null, longitude: null }),
    mr('02M002', '2024-25', { school_name: 'No Coords B', latitude: null, longitude: null }),
  ];
  const id = deriveSchoolIdentities(rows)[0]!;
  check('coordless school falls back to latest year overall', id.identity_source_year === '2024-25' && id.school_name === 'No Coords B');
  check('coordless school has null geometry', id.geom_ewkt === null && id.latitude === null);
}

console.log('\n== deriveSchoolYearRecords :: counts rounded, fractions kept ==');
{
  const rows: MasterVersionRow[] = [
    mr('03M003', '2024-25', { total_enrollment: 540.4, n_poverty: 99.6, pct_poverty: 0.856, economic_need_index: 0.91 }),
  ];
  const recs = deriveSchoolYearRecords(rows);
  check('one record per (dbn, year)', recs.length === 1);
  const vals = Object.fromEntries(SCHOOLS_YEAR_COLUMNS.map((c, i) => [c, recs[0]!.values[i]]));
  check('total_enrollment rounded 540.4 → 540', vals.total_enrollment === 540);
  check('n_poverty rounded 99.6 → 100', vals.n_poverty === 100);
  check('pct_poverty kept as fraction 0.856', vals.pct_poverty === 0.856);
  check('economic_need_index kept 0.91', vals.economic_need_index === 0.91);
}

console.log('\n== masterCsvToVersionRows :: remap + duplicate last-wins ==');
{
  const raw = [
    csvRow({ DBN: '08X208', school_year: '2024-25', school_name: 'Charter Coding', total_enrollment: '300' }),
    csvRow({ DBN: '84X208', school_year: '2024-25', school_name: 'Canonical Row', total_enrollment: '310' }),
    csvRow({ DBN: '01M001', school_year: '2024-25', school_name: 'Regular', total_enrollment: '100' }),
  ];
  const { rows, remapCount } = masterCsvToVersionRows(raw);
  check('remap counted once', remapCount === 1);
  check('remap collision deduped last-wins (2 unique keys)', rows.length === 2);
  const x208 = rows.find((r) => r.dbn === '84X208')!;
  check('84X208 kept the LAST row (Canonical Row)', x208.payload.school_name === 'Canonical Row' && x208.payload.total_enrollment === 310);
  check('no 08X208 key survives', rows.every((r) => r.dbn !== '08X208'));
}

console.log('\n== applyRollbackOverlay :: revert values, keep newer rows ==');
{
  const target: MasterVersionRow[] = [
    mr('01M001', '2024-25', { school_name: 'V1 Name', total_enrollment: 100 }),
  ];
  const current: MasterVersionRow[] = [
    mr('01M001', '2024-25', { school_name: 'V2 Name', total_enrollment: 150 }),
    mr('99Z999', '2025-26', { school_name: 'Added in V2', total_enrollment: 500 }),
  ];
  const out = applyRollbackOverlay(current, target);
  check('row count preserved (no deletes)', out.length === 2);
  const reverted = out.find((r) => r.dbn === '01M001')!;
  check('target payload wins for shared key', reverted.payload.school_name === 'V1 Name' && reverted.payload.total_enrollment === 100);
  const kept = out.find((r) => r.dbn === '99Z999')!;
  check('row added after target survives with its payload', kept.payload.school_name === 'Added in V2');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);

// ---- helpers ---------------------------------------------------------------

function pl(p: Partial<Record<string, unknown>>): import('../src/admin/merge.js').Payload {
  const out: import('../src/admin/merge.js').Payload = {};
  for (const c of MASTER_DATA_FIELDS) out[c] = (p[c] as never) ?? null;
  return out;
}

function row(r: Record<string, string>): NormalizedRow {
  const out: NormalizedRow = {};
  for (const f of MASTER_FIELDS) out[f.id] = null;
  for (const k of Object.keys(r)) out[k] = r[k] ?? null;
  return out;
}

function mr(dbn: string, school_year: string, p: Partial<Record<string, unknown>>): MasterVersionRow {
  return { dbn, school_year, payload: pl(p) };
}

function csvRow(r: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of MASTER_FIELDS) out[f.id] = '';
  for (const k of Object.keys(r)) out[k] = r[k] ?? '';
  return out;
}
