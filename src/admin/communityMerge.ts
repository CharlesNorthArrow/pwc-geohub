/**
 * (area_id, geo_layer, indicator_id, year) update & append merge for
 * community indicators.
 *
 * Mirrors the pwc_school_program merge invariants:
 *   - update existing rows whose values changed
 *   - append new rows
 *   - retain rows present in current but absent from incoming (NEVER delete)
 *
 * Practical implication for community sync:
 *   - ACS sync that pulls vintage 2025 leaves vintages 2020-2024 alone.
 *   - CDC sync that re-pulls the whole feed lays new rows on top of old
 *     ones; older tracts/years stay intact even if CDC dropped a tract.
 */

export type CellValue = number | string | null;

export interface RowKey {
  area_id: string;
  geo_layer: string;
  indicator_id: string;
  year: string;
}

export interface Payload {
  value_num: number | null;
  value_text: string | null;
  label: string | null;
  source_year: string | null;
}

export interface CurrentRow extends RowKey {
  payload: Payload;
}

export interface IncomingRow extends RowKey {
  value_num: number | null;
  value_text: string | null;
  label: string | null;
  source_year: string | null;
}

export interface Updated {
  key: string;
  before: Payload;
  after: Payload;
  changedFields: string[];
}

export interface MergeResult {
  added: number;
  updated: Updated[];
  unchanged: number;
  retained: number;
  newVersionRows: Array<CurrentRow>;
}

const keyOf = (r: RowKey): string =>
  `${r.area_id}|${r.geo_layer}|${r.indicator_id}|${r.year}`;

function payloadEquals(a: Payload, b: Payload): boolean {
  return (
    a.value_num === b.value_num &&
    a.value_text === b.value_text &&
    a.label === b.label &&
    a.source_year === b.source_year
  );
}

function changedFields(a: Payload, b: Payload): string[] {
  const out: string[] = [];
  if (a.value_num !== b.value_num) out.push('value_num');
  if (a.value_text !== b.value_text) out.push('value_text');
  if (a.label !== b.label) out.push('label');
  if (a.source_year !== b.source_year) out.push('source_year');
  return out;
}

export function mergeCommunity(current: CurrentRow[], incoming: IncomingRow[]): MergeResult {
  const currentByKey = new Map<string, CurrentRow>();
  for (const r of current) currentByKey.set(keyOf(r), r);

  const incomingByKey = new Map<string, IncomingRow>();
  // Dedupe incoming — last write wins on duplicate keys (defensive).
  for (const r of incoming) incomingByKey.set(keyOf(r), r);

  const updated: Updated[] = [];
  let unchanged = 0;
  let retained = 0;
  let added = 0;
  const newVersionRows: CurrentRow[] = [];

  for (const c of current) {
    const k = keyOf(c);
    const inc = incomingByKey.get(k);
    if (!inc) {
      // ABSENT from incoming → retain verbatim. Never delete.
      retained++;
      newVersionRows.push(c);
      continue;
    }
    const after: Payload = {
      value_num: inc.value_num,
      value_text: inc.value_text,
      label: inc.label,
      source_year: inc.source_year,
    };
    if (payloadEquals(c.payload, after)) {
      unchanged++;
      newVersionRows.push(c);
    } else {
      updated.push({
        key: k,
        before: c.payload,
        after,
        changedFields: changedFields(c.payload, after),
      });
      newVersionRows.push({ ...c, payload: after });
    }
  }

  // Incoming rows that aren't in current → added.
  for (const [k, inc] of incomingByKey) {
    if (currentByKey.has(k)) continue;
    added++;
    newVersionRows.push({
      area_id: inc.area_id,
      geo_layer: inc.geo_layer,
      indicator_id: inc.indicator_id,
      year: inc.year,
      payload: {
        value_num: inc.value_num,
        value_text: inc.value_text,
        label: inc.label,
        source_year: inc.source_year,
      },
    });
  }

  return { added, updated, unchanged, retained, newVersionRows };
}
