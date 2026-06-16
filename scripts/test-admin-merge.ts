/**
 * Tests for the Admin Panel merge logic + column reconciliation.
 *
 * The load-bearing tests:
 *   1. Update & append, NEVER delete.
 *      A (DBN, year) pair in the current version that's absent from the
 *      upload must end up in the new version with identical payload.
 *   2. Missing KEY column → hard block (validation fails regardless of acks).
 *   3. Missing DATA column → block unless explicitly acknowledged.
 *   4. Renamed column → mapping decision is honored end-to-end.
 *   5. Extra column → default Ignore; the field doesn't show up in the
 *      merged row's payload.
 *   6. All-null program rows are accepted as valid (inactive year).
 *
 * Plus a few coercion sanity checks.
 *
 * Run: `npm run test:admin-merge`.
 */

import { classifyColumns, applyDecisions, validateDecisions } from '../src/admin/columnReconciliation.js';
import { mergeRows, coerceValue, type CurrentRow, type NormalizedRow } from '../src/admin/merge.js';
import { PWC_DATA_FIELDS } from '../src/admin/pwcSchema.js';

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

function eq<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

console.log('== merge ==');
{
  // Setup: current has 3 schools across 2 years; upload touches 2 of them
  // (one update, one unchanged), introduces 1 new, and omits 1 entirely.
  const current: CurrentRow[] = [
    { dbn: '01M001', school_year: '2023-24', payload: pl({ core_school: true, cohort: 'A', sw_caseload_students: 30 }) },
    { dbn: '01M001', school_year: '2024-25', payload: pl({ core_school: true, cohort: 'A', sw_caseload_students: 35 }) },
    { dbn: '02K222', school_year: '2024-25', payload: pl({ core_school: false, arts_program: true, cohort: 'B' }) },
  ];
  const incoming: NormalizedRow[] = [
    // 01M001/2024-25 — update sw_caseload_students 35 → 40
    row({ DBN: '01M001', school_year: '2024-25', core_school: '1', cohort: 'A', sw_caseload_students: '40' }),
    // 02K222/2024-25 — unchanged
    row({ DBN: '02K222', school_year: '2024-25', core_school: '0', arts_program: '1', cohort: 'B' }),
    // 03Q333/2024-25 — NEW
    row({ DBN: '03Q333', school_year: '2024-25', core_school: '1', cohort: 'C' }),
    // 01M001/2023-24 OMITTED — must be retained.
  ];

  const merged = mergeRows(current, incoming);

  check('added.length === 1', merged.added.length === 1);
  check('updated.length === 1', merged.updated.length === 1);
  check('unchanged === 1', merged.unchanged === 1);
  check('retained.length === 1 (the omitted pair)', merged.retained.length === 1);
  check('zero deletions invariant: current.length === retained.length + updated.length + unchanged',
    current.length === merged.retained.length + merged.updated.length + merged.unchanged);
  check('newVersionRows.length === current.length + added.length',
    merged.newVersionRows.length === current.length + merged.added.length,
    { newRows: merged.newVersionRows.length, current: current.length, added: merged.added.length });

  // RETAIN check — the omitted pair survives byte-identical.
  const retainedRow = merged.retained[0]!;
  check('retained pair is the right one (01M001/2023-24)',
    retainedRow.dbn === '01M001' && retainedRow.school_year === '2023-24');
  check('retained payload is identical to current',
    eq(retainedRow.payload, current[0]!.payload), { got: retainedRow.payload, want: current[0]!.payload });

  // UPDATE check
  const u = merged.updated[0]!;
  check('update is on (01M001, 2024-25)', u.dbn === '01M001' && u.school_year === '2024-25');
  check('update changedColumns contains sw_caseload_students',
    u.changedColumns.includes('sw_caseload_students'));
  check('update.after.sw_caseload_students === 40', u.after.sw_caseload_students === 40);

  // ADD check
  const a = merged.added[0]!;
  check('added is 03Q333/2024-25', a.dbn === '03Q333' && a.school_year === '2024-25');
  check('added payload preserves new DBN value', a.payload.core_school === true);
}

console.log('\n== merge :: all-null incoming row accepted ==');
{
  const current: CurrentRow[] = [];
  const incoming: NormalizedRow[] = [
    row({ DBN: '04R444', school_year: '2024-25' }), // every data column null
  ];
  const merged = mergeRows(current, incoming);
  check('all-null row is added, not rejected', merged.added.length === 1);
  check('payload contains every data field as null',
    PWC_DATA_FIELDS.every((c) => merged.added[0]!.payload[c] === null));
}

console.log('\n== column reconciliation :: missing KEY hard block ==');
{
  const headers = ['school_year', 'core_school']; // no DBN
  const cls = classifyColumns(headers);
  const v = validateDecisions(cls, {
    unmatched: [],
    acknowledgedMissing: Object.fromEntries(cls.missing.filter(m => !m.isKey).map(m => [m.fieldId, true])),
    ignoredExtra: [],
  });
  check('validation fails when DBN is missing', !v.ok);
  check('error message mentions DBN', v.errors.some((e) => e.includes('DBN')));
}

console.log('\n== column reconciliation :: missing DATA column ack required ==');
{
  // Build the full schema set BUT drop `sw_caseload_students`.
  const headers = PWC_DATA_FIELDS.filter((c) => c !== 'sw_caseload_students').concat(['DBN', 'school_year']);
  const cls = classifyColumns(headers);
  check('exactly one missing data column', cls.missing.length === 1 && cls.missing[0]!.fieldId === 'sw_caseload_students');

  // Without ack → block
  const vBlocked = validateDecisions(cls, { unmatched: [], acknowledgedMissing: {}, ignoredExtra: [] });
  check('blocked without acknowledgment', !vBlocked.ok);

  // With ack → pass
  const vOk = validateDecisions(cls, {
    unmatched: [],
    acknowledgedMissing: { sw_caseload_students: true },
    ignoredExtra: [],
  });
  check('passes once acknowledged', vOk.ok, vOk.errors);
}

console.log('\n== column reconciliation :: renamed column mapping ==');
{
  // CSV has `sw_caseload` (renamed from `sw_caseload_students`).
  const headers = PWC_DATA_FIELDS
    .filter((c) => c !== 'sw_caseload_students')
    .concat(['DBN', 'school_year', 'sw_caseload']);
  const cls = classifyColumns(headers);
  check('sw_caseload is unmatched', cls.unmatched.some((u) => u.csvHeader === 'sw_caseload'));
  check('top suggestion for sw_caseload is sw_caseload_students',
    cls.unmatched.find((u) => u.csvHeader === 'sw_caseload')!.suggestions[0]!.fieldId === 'sw_caseload_students');

  const decisions = {
    unmatched: [{ kind: 'map' as const, csvHeader: 'sw_caseload', fieldId: 'sw_caseload_students' }],
    acknowledgedMissing: {} as Record<string, boolean>,
    ignoredExtra: [],
  };
  const v = validateDecisions(cls, decisions);
  check('validation passes with mapping', v.ok, v.errors);

  // Apply to raw rows.
  const rawRow: Record<string, string> = { DBN: '05X555', school_year: '2024-25', sw_caseload: '50' };
  for (const c of headers) if (rawRow[c] === undefined) rawRow[c] = '';
  const normalized = applyDecisions([rawRow], cls, decisions);
  check('mapped column ends up in normalized row under the schema field name',
    normalized[0]!.sw_caseload_students === '50');
}

console.log('\n== column reconciliation :: extra column ignored ==');
{
  const headers = ['DBN', 'school_year', 'core_school', 'random_extra'];
  const cls = classifyColumns(headers);
  check('random_extra surfaces as unmatched', cls.unmatched.some((u) => u.csvHeader === 'random_extra'));

  const decisions = {
    unmatched: [{ kind: 'ignore' as const, csvHeader: 'random_extra' }],
    acknowledgedMissing: Object.fromEntries(cls.missing.filter(m => !m.isKey).map(m => [m.fieldId, true])),
    ignoredExtra: ['random_extra'],
  };
  const v = validateDecisions(cls, decisions);
  check('validation passes with ignore decision', v.ok, v.errors);

  const norm = applyDecisions([{ DBN: '06X666', school_year: '2024-25', core_school: '1', random_extra: 'whatever' }], cls, decisions);
  check('random_extra does NOT appear in normalized row', !('random_extra' in norm[0]!));
}

console.log('\n== coerceValue ==');
{
  check('coerce "1" → true (boolean)', coerceValue('1', 'boolean') === true);
  check('coerce "0" → false (boolean)', coerceValue('0', 'boolean') === false);
  check('coerce "" → null (any)', coerceValue('', 'text') === null);
  check('coerce "42" → 42 (integer)', coerceValue('42', 'integer') === 42);
  check('coerce "4.5" → null (integer rejects floats)', coerceValue('4.5', 'integer') === null);
  check('coerce null → null', coerceValue(null, 'text') === null);
}

console.log('\n== alias match ==');
{
  // school_type is the historical alias for governance_school_type.
  const headers = ['DBN', 'school_year', 'school_type'];
  const cls = classifyColumns(headers);
  const m = cls.matched.find((m) => m.csvHeader === 'school_type');
  check('school_type → governance_school_type via alias', !!m && m.fieldId === 'governance_school_type' && m.viaAlias === true);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);

function pl(p: Partial<Record<string, unknown>>): import('../src/admin/merge.js').Payload {
  const out: import('../src/admin/merge.js').Payload = {};
  for (const c of PWC_DATA_FIELDS) out[c] = (p[c] as never) ?? null;
  return out;
}

function row(r: Record<string, string>): NormalizedRow {
  const out: NormalizedRow = {};
  for (const c of PWC_DATA_FIELDS) out[c] = null;
  out.DBN = r.DBN ?? '';
  out.school_year = r.school_year ?? '';
  for (const k of Object.keys(r)) {
    if (k === 'DBN' || k === 'school_year') continue;
    out[k] = r[k] ?? null;
  }
  return out;
}
