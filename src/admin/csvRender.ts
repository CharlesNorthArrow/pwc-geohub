/**
 * Materialize a version's row set as CSV text, schema-shaped. Shared by the
 * apply route (Blob snapshot) and the download route so the two can never
 * drift. (The pwc routes predate this module and carry their own copy.)
 */

import type { AdminField } from './schemaTypes';

export function renderCsv(
  fields: readonly AdminField[],
  rows: ReadonlyArray<{ dbn: string; school_year: string; payload: Record<string, unknown> }>,
): string {
  const headers = fields.map((f) => f.id);
  const lines: string[] = [headers.join(',')];
  for (const r of rows) {
    const cells: string[] = [];
    for (const f of fields) {
      const v = f.isKey
        ? (f.id === 'DBN' ? r.dbn : r.school_year)
        : (r.payload[f.id] ?? null);
      cells.push(csvCell(v));
    }
    lines.push(cells.join(','));
  }
  return lines.join('\n') + '\n';
}

export function csvCell(v: unknown): string {
  if (v == null) return '';
  let s: string;
  if (typeof v === 'boolean') s = v ? '1' : '0';
  else s = String(v);
  if (/[",\n\r]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
