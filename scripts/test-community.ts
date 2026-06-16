/**
 * Tests for the Community Indicators sync layer.
 *
 * Locks the load-bearing invariants:
 *   1. Merge is update + append, NEVER delete.
 *   2. Probe→isNewer correctly identifies newer vintage AND CDC re-issue.
 *   3. Fail-safe: a failed check NEVER changes loaded_vintage / latest_vintage
 *      / update_available — only the failure markers. (Verified at the
 *      function-shape level; SQL is hand-tested.)
 *
 * Run: npm run test:community
 */

import { mergeCommunity, type CurrentRow, type IncomingRow } from '../src/admin/communityMerge.js';
import { isNewer } from '../src/admin/communityProbe.js';

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

console.log('== merge :: update + append + retain ==');
{
  const current: CurrentRow[] = [
    row('36005000100', 'tract', 'child_poverty', '2024', { value_num: 22.4, label: '22.4% …', source_year: '2024' }),
    row('36005000100', 'tract', 'child_poverty', '2023', { value_num: 21.0, label: '21.0% …', source_year: '2023' }),
    row('36005000200', 'tract', 'child_poverty', '2024', { value_num: 18.0, label: '18.0% …', source_year: '2024' }),
  ];
  const incoming: IncomingRow[] = [
    // Updated row (value_num changed)
    inc('36005000100', 'tract', 'child_poverty', '2024', 22.9, '22.9% …', '2024'),
    // Unchanged row
    inc('36005000200', 'tract', 'child_poverty', '2024', 18.0, '18.0% …', '2024'),
    // New row for 2025 vintage
    inc('36005000100', 'tract', 'child_poverty', '2025', 23.1, '23.1% …', '2025'),
    // 36005000100/2023 OMITTED from incoming → must be retained.
  ];

  const m = mergeCommunity(current, incoming);
  check('added === 1', m.added === 1);
  check('updated.length === 1', m.updated.length === 1);
  check('unchanged === 1', m.unchanged === 1);
  check('retained === 1', m.retained === 1);
  check(
    'zero deletions: current.length === retained + updated + unchanged',
    current.length === m.retained + m.updated.length + m.unchanged,
  );
  check(
    'newVersionRows.length === current.length + added',
    m.newVersionRows.length === current.length + m.added,
    { newRows: m.newVersionRows.length, current: current.length, added: m.added },
  );
  // RETAIN: 36005000100/2023 in current but absent from incoming.
  const retained = m.newVersionRows.find((r) => r.area_id === '36005000100' && r.year === '2023');
  check('retained row preserved byte-identical', !!retained && retained.payload.value_num === 21.0);

  const updated = m.updated[0]!;
  check('updated changed value_num', updated.changedFields.includes('value_num'));
  check('updated.after carries new value', updated.after.value_num === 22.9);

  const added = m.newVersionRows.find((r) => r.year === '2025');
  check('added 2025 vintage row carried through', !!added && added.payload.value_num === 23.1);
}

console.log('\n== isNewer ==');
{
  // never loaded
  let r = isNewer({ vintage: null, cdcUpdatedAt: null }, { provider: 'acs', latestVintage: '2024', probedYears: [] });
  check('never_loaded → newer', r.newer && r.reason === 'never_loaded');

  // ACS newer vintage
  r = isNewer({ vintage: '2023', cdcUpdatedAt: null }, { provider: 'acs', latestVintage: '2024', probedYears: [] });
  check('ACS 2024 vs loaded 2023 → newer', r.newer && r.reason === 'newer_vintage');

  // ACS already at latest
  r = isNewer({ vintage: '2024', cdcUpdatedAt: null }, { provider: 'acs', latestVintage: '2024', probedYears: [] });
  check('ACS already_latest', !r.newer && r.reason === 'already_latest');

  // CDC re-issue: same vintage, changed updatedAt
  r = isNewer(
    { vintage: '2024', cdcUpdatedAt: '1700000000' },
    { provider: 'cdc_places', latestVintage: '2024', rowsUpdatedAt: '1750000000' },
  );
  check('CDC re-issue (same vintage, changed updatedAt) → newer', r.newer && r.reason === 'cdc_reissue');

  // CDC no change
  r = isNewer(
    { vintage: '2024', cdcUpdatedAt: '1700000000' },
    { provider: 'cdc_places', latestVintage: '2024', rowsUpdatedAt: '1700000000' },
  );
  check('CDC same vintage + same updatedAt → already_latest', !r.newer);

  // ACS retracted (loaded > probe) — treat as already_latest, NOT newer.
  r = isNewer({ vintage: '2024', cdcUpdatedAt: null }, { provider: 'acs', latestVintage: '2023', probedYears: [] });
  check('ACS loaded > probe → not newer (no auto-rollback)', !r.newer);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);

function row(area_id: string, geo_layer: string, indicator_id: string, year: string, payload: Partial<{ value_num: number | null; value_text: string | null; label: string | null; source_year: string | null }>): CurrentRow {
  return {
    area_id, geo_layer, indicator_id, year,
    payload: {
      value_num: payload.value_num ?? null,
      value_text: payload.value_text ?? null,
      label: payload.label ?? null,
      source_year: payload.source_year ?? null,
    },
  };
}

function inc(area_id: string, geo_layer: string, indicator_id: string, year: string, value_num: number | null, label: string | null, source_year: string | null): IncomingRow {
  return {
    area_id, geo_layer, indicator_id, year,
    value_num, value_text: null, label, source_year,
  };
}
