/**
 * (DBN, school_year) update & append merge — pure logic, server-side.
 *
 * Inputs:
 *   - currentRows: the live version's rows (read from pwc_program_version_rows
 *     WHERE version_id = current).
 *   - incomingRows: normalized upload (post-reconciliation) — schema-shaped,
 *     string-or-null cells. Type coercion happens HERE.
 *
 * Output partitions:
 *   - added       — key in incoming, not in current.
 *   - updated     — key in both, payload differs (with changed-column list).
 *   - unchanged   — key in both, payload identical.
 *   - retained    — key in current, ABSENT from incoming. Preserved verbatim.
 *
 * Invariants (the load-bearing ones — the test suite asserts these):
 *   - len(currentRows) + added.length === newVersionRows.length.
 *     i.e. the new version has every current key PLUS the added keys; no
 *     deletions.
 *   - For every key in currentRows that's also in incomingRows: the new
 *     version's payload at that key equals incoming. (Updates win over old.)
 *   - For every key in currentRows that's NOT in incomingRows: the new
 *     version's payload at that key equals current's. (Retain.)
 *
 * Type coercion contract: values are normalized to (string | number | boolean
 * | null) per the schema field's type before equality comparison. Diff
 * compares the typed values, NOT the raw strings — so "1" vs true (both
 * arriving from current/incoming sides) is NOT a change.
 */

import { PWC_FIELDS } from './pwcSchema';
import { dataFieldsOf, type AdminField, type AdminFieldType } from './schemaTypes';
import { toNullableNumber } from '../lib/normalize';

export type PayloadValue = string | number | boolean | null;
export type Payload = Record<string, PayloadValue>;

export interface CurrentRow {
  dbn: string;
  school_year: string;
  payload: Payload; // already typed (from pwc_program_version_rows.payload)
}

export interface NormalizedRow {
  /** Schema-shaped, post-reconciliation. Keys = PWC_FIELDS ids. Values =
   *  raw strings or nulls from the upload (pre-coercion). */
  [fieldId: string]: string | null;
}

export interface Updated {
  dbn: string;
  school_year: string;
  before: Payload;
  after: Payload;
  changedColumns: string[];
}

export interface Added {
  dbn: string;
  school_year: string;
  payload: Payload;
}

export interface Retained {
  dbn: string;
  school_year: string;
  payload: Payload;
}

export interface MergeResult {
  added: Added[];
  updated: Updated[];
  unchanged: number;
  retained: Retained[];
  /** Materialized row set for the new version — added ∪ updated.after ∪
   *  unchanged-from-current ∪ retained-from-current. PK-unique. */
  newVersionRows: Array<{ dbn: string; school_year: string; payload: Payload }>;
}

export function coerceValue(raw: string | null, type: AdminFieldType): PayloadValue {
  if (raw == null) return null;
  const t = raw.trim();
  if (t === '') return null;
  switch (type) {
    case 'text':
      return t;
    case 'integer': {
      // Reject anything that isn't an int. We return null on un-parseable so
      // a malformed integer isn't silently 0; the upstream code can warn.
      const n = Number(t);
      if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
      return n;
    }
    case 'number':
      // Float column — sentinel strings ("Above 95%", "R", …) and anything
      // unparseable become null via the canonical normalizer.
      return toNullableNumber(t);
    case 'boolean': {
      const v = t.toLowerCase();
      if (['1', 'true', 't', 'yes', 'y'].includes(v)) return true;
      if (['0', 'false', 'f', 'no', 'n'].includes(v)) return false;
      return null;
    }
  }
}

/** Exported so the seed script + upload routes coerce with the same rules. */
export function coerceRow(
  row: NormalizedRow,
  fields: readonly AdminField[],
): { dbn: string; school_year: string; payload: Payload } | null {
  const dbn = row['DBN'];
  const schoolYear = row['school_year'];
  if (!dbn || !schoolYear) return null;
  const payload: Payload = {};
  for (const f of fields) {
    if (f.isKey) continue;
    payload[f.id] = coerceValue(row[f.id] ?? null, f.type);
  }
  return { dbn, school_year: schoolYear, payload };
}

/**
 * Stable equality for the payload object. Iteration order is fixed by the
 * schema's data-field list so two payloads with equivalent values but
 * different key insertion order are equal here.
 */
function payloadEquals(a: Payload, b: Payload, dataFields: readonly string[]): boolean {
  for (const k of dataFields) {
    const av = a[k] ?? null;
    const bv = b[k] ?? null;
    if (av !== bv) return false;
  }
  return true;
}

function changedColumns(before: Payload, after: Payload, dataFields: readonly string[]): string[] {
  const out: string[] = [];
  for (const k of dataFields) {
    const a = before[k] ?? null;
    const b = after[k] ?? null;
    if (a !== b) out.push(k);
  }
  return out;
}

const keyOf = (dbn: string, school_year: string): string => `${dbn}|${school_year}`;

/**
 * Core merge — pure. Inputs are immutable; output is fully owned.
 *
 * NB: order of `newVersionRows` is stable: current rows first (in the order
 * given), then added rows in the order they appear in `incomingRows`. The
 * tests rely on this for deterministic snapshots.
 */
export function mergeRows(
  current: CurrentRow[],
  incoming: NormalizedRow[],
  fields: readonly AdminField[] = PWC_FIELDS,
): MergeResult {
  const dataFields = dataFieldsOf(fields);
  const incomingByKey = new Map<string, { dbn: string; school_year: string; payload: Payload }>();
  const addedKeys: string[] = [];
  // Coerce + dedupe incoming. Last write wins on duplicate (DBN, year).
  for (const raw of incoming) {
    const c = coerceRow(raw, fields);
    if (!c) continue;
    const k = keyOf(c.dbn, c.school_year);
    if (!incomingByKey.has(k)) addedKeys.push(k);
    incomingByKey.set(k, c);
  }

  const currentByKey = new Map<string, CurrentRow>();
  for (const r of current) currentByKey.set(keyOf(r.dbn, r.school_year), r);

  const added: Added[] = [];
  const updated: Updated[] = [];
  let unchanged = 0;
  const retained: Retained[] = [];
  const newVersionRows: Array<{ dbn: string; school_year: string; payload: Payload }> = [];

  // Pass 1 — walk current rows. Decide updated / unchanged / retained.
  for (const c of current) {
    const k = keyOf(c.dbn, c.school_year);
    const inc = incomingByKey.get(k);
    if (!inc) {
      // ABSENT from upload — retain verbatim. NEVER delete.
      retained.push({ dbn: c.dbn, school_year: c.school_year, payload: c.payload });
      newVersionRows.push({ dbn: c.dbn, school_year: c.school_year, payload: c.payload });
      continue;
    }
    if (payloadEquals(c.payload, inc.payload, dataFields)) {
      unchanged++;
      newVersionRows.push({ dbn: c.dbn, school_year: c.school_year, payload: inc.payload });
    } else {
      updated.push({
        dbn: c.dbn,
        school_year: c.school_year,
        before: c.payload,
        after: inc.payload,
        changedColumns: changedColumns(c.payload, inc.payload, dataFields),
      });
      newVersionRows.push({ dbn: c.dbn, school_year: c.school_year, payload: inc.payload });
    }
  }

  // Pass 2 — incoming rows whose key isn't in current = added.
  for (const k of addedKeys) {
    if (currentByKey.has(k)) continue;
    const inc = incomingByKey.get(k)!;
    added.push({ dbn: inc.dbn, school_year: inc.school_year, payload: inc.payload });
    newVersionRows.push({ dbn: inc.dbn, school_year: inc.school_year, payload: inc.payload });
  }

  return { added, updated, unchanged, retained, newVersionRows };
}
