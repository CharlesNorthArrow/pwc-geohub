/**
 * The "one tidy sheet, filter to school-level rows" shape shared by the
 * state-test, chronic-absenteeism and graduation files (pandas `read_excel`
 * + boolean filter in the Python).
 */

import { cellText, compact, findColumn, findRow, findSheet, type Book, type Cell } from './workbook';
import type { Collector } from './common';

export interface LongTableSpec {
  sheet: { name: string; contains?: string };
  /** Column → required value, e.g. { Grade: 'All Grades' }. */
  filters: Record<string, string>;
  /** Logical key → column header in the DOE file. */
  columns: Record<string, string>;
}

export interface LongTable {
  /** Filtered body rows. */
  rows: Cell[][];
  col: Record<string, number>;
}

export function readLongTable(book: Book, spec: LongTableSpec, c: Collector): LongTable | null {
  const sheet = findSheet(book, spec.sheet, c.errors, c.warnings);
  if (sheet == null) return null;
  const grid = book.grid(sheet);
  const headerRow = findRow(grid, (r) => r.some((v) => compact(v) === 'dbn'));
  if (headerRow == null) {
    c.errors.push({
      code: 'header_not_found',
      file: book.file,
      message: `Could not find the header row (a "DBN" column) in sheet "${sheet}".`,
    });
    return null;
  }
  const headers = grid[headerRow]!;
  const col: Record<string, number> = {};
  const errorsBefore = c.errors.length;
  for (const [key, header] of Object.entries({ ...spec.columns, ...Object.fromEntries(Object.keys(spec.filters).map((f) => [`__filter_${f}`, f])) })) {
    const i = findColumn(headers, header, book.file, c.errors, c.warnings);
    if (i != null) col[key] = i;
  }
  if (c.errors.length > errorsBefore) return null;

  const body = grid.slice(headerRow + 1);
  const rows = body.filter((r) =>
    Object.entries(spec.filters).every(([f, want]) => cellText(r[col[`__filter_${f}`]!]) === want),
  );
  if (rows.length === 0) {
    const sample = (f: string): string =>
      [...new Set(body.map((r) => cellText(r[col[`__filter_${f}`]!])).filter(Boolean))].slice(0, 8).join(' · ');
    c.errors.push({
      code: 'filter_no_rows',
      file: book.file,
      message: `No rows match ${Object.entries(spec.filters).map(([f, v]) => `${f} = "${v}"`).join(' and ')}.`,
      expected: Object.values(spec.filters).join(' / '),
      found: Object.keys(spec.filters).map((f) => `${f}: ${sample(f) || '(empty)'}`).join(' | '),
    });
    return null;
  }
  return { rows, col };
}
