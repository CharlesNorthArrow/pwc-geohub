/**
 * Shared plumbing for the raw-file transforms: reading .xlsx/.xlsb/.xls/.csv,
 * tolerant sheet/column lookup (with drift warnings), value parsing and the
 * rounding the historical loads were produced with. Pure — no DB, no I/O beyond the bytes handed in.
 */

import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import type { RawFile, TransformIssue } from './types';

export type Cell = string | number | boolean | null;
export type Grid = Cell[][];

export interface Book {
  file: string;
  kind: 'excel' | 'csv';
  sheetNames: string[];
  grid(sheetName: string): Grid;
}

export const extOf = (name: string): string => {
  const m = /\.[^.]+$/.exec(name.toLowerCase());
  return m ? m[0] : '';
};

/**
 * Parse a file into a Book. CSVs go through csv-parse (all cells stay text,
 * so "30.7%" and "01M015" survive untouched); spreadsheets through SheetJS
 * with raw cell values. Grids are anchored at A1 so column indices are
 * absolute.
 */
export function readBook(file: RawFile): Book | TransformIssue {
  const ext = extOf(file.name);
  if (ext === '.csv') {
    let rows: string[][];
    try {
      rows = parse(Buffer.from(file.data).toString('utf8'), {
        bom: true,
        relax_quotes: true,
        relax_column_count: true,
        skip_empty_lines: false,
      }) as string[][];
    } catch (err) {
      return { code: 'unreadable_file', file: file.name, message: `Could not read this CSV: ${(err as Error).message}` };
    }
    const grid: Grid = rows.map((r) => r.map((c) => (c === '' ? null : c)));
    return { file: file.name, kind: 'csv', sheetNames: ['(csv)'], grid: () => grid };
  }
  if (!['.xlsx', '.xlsb', '.xls', '.xlsm'].includes(ext)) {
    return {
      code: 'unsupported_file_type',
      file: file.name,
      message: 'This file type is not supported.',
      expected: '.xlsx, .xlsb, .xls or .csv',
      found: ext || '(no extension)',
    };
  }
  // DOE workbooks run to ~90 MB with many sheets the transform never reads.
  // List the names first (cheap), then parse only the sheets asked for —
  // keeps a 50 MB state-test file around 600 MB peak instead of several GB.
  let sheetNames: string[];
  try {
    sheetNames = XLSX.read(file.data, { type: 'array', bookSheets: true }).SheetNames;
  } catch (err) {
    return { code: 'unreadable_file', file: file.name, message: `Could not open this spreadsheet: ${(err as Error).message}` };
  }
  const cache = new Map<string, Grid>();
  return {
    file: file.name,
    kind: 'excel',
    sheetNames,
    grid(name: string): Grid {
      const hit = cache.get(name);
      if (hit) return hit;
      const wb = XLSX.read(file.data, {
        type: 'array',
        dense: true,
        sheets: [name],
        cellDates: false,
        cellFormula: false,
        cellHTML: false,
        cellText: false,
      });
      const ws = wb.Sheets[name];
      let grid: Grid = [];
      if (ws && ws['!ref']) {
        const range = XLSX.utils.decode_range(ws['!ref']);
        range.s.r = 0;
        range.s.c = 0;
        grid = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true, range });
      }
      cache.set(name, grid);
      return grid;
    },
  };
}

/** Lower-case, all whitespace removed — "Annual Report --R-P-S TOTALS" ≈ "Annual Report--R-P-S TOTALS". */
export const compact = (s: unknown): string => String(s ?? '').toLowerCase().replace(/\s+/g, '');

export const cellText = (v: Cell | undefined): string => (v == null ? '' : String(v).trim());

/**
 * Find a sheet by name: exact → whitespace/case-insensitive → the optional
 * `contains` fragment. Anything but an exact hit adds a drift warning; no hit
 * adds a blocking error and returns null.
 */
export function findSheet(
  book: Book,
  wanted: { name: string; contains?: string },
  errors: TransformIssue[],
  warnings: TransformIssue[],
): string | null {
  if (book.kind === 'csv') return book.sheetNames[0]!;
  // Surrounding whitespace is noise, not drift ("Student Pos & Neg % " 2025).
  const exact = book.sheetNames.find((s) => s.trim() === wanted.name.trim());
  if (exact) return exact;
  const loose = book.sheetNames.find((s) => compact(s) === compact(wanted.name));
  const partial =
    loose ?? (wanted.contains ? book.sheetNames.find((s) => compact(s).includes(compact(wanted.contains!))) : undefined);
  if (partial) {
    warnings.push({
      code: 'sheet_name_changed',
      file: book.file,
      message: `Sheet name differs slightly from last time; used "${partial}".`,
      expected: wanted.name,
      found: partial,
    });
    return partial;
  }
  errors.push({
    code: 'sheet_not_found',
    file: book.file,
    message: `Required sheet "${wanted.name}" is missing.`,
    expected: wanted.name,
    found: book.sheetNames.join(' · ') || '(no sheets)',
  });
  return null;
}

/**
 * Locate a column in a header row: exact (trimmed) → whitespace/case-
 * insensitive → contains. Non-exact hits warn; misses are blocking errors.
 */
export function findColumn(
  headers: readonly Cell[],
  name: string,
  file: string,
  errors: TransformIssue[],
  warnings: TransformIssue[],
  opts: { alternatives?: readonly string[]; optional?: boolean } = {},
): number | null {
  const candidates = [name, ...(opts.alternatives ?? [])];
  for (const c of candidates) {
    const i = headers.findIndex((h) => cellText(h) === c);
    if (i >= 0) return i;
  }
  for (const c of candidates) {
    const i = headers.findIndex((h) => compact(h) === compact(c));
    if (i >= 0) {
      warnings.push({
        code: 'column_name_changed',
        file,
        message: `Column name differs slightly from last time; used "${cellText(headers[i])}".`,
        expected: c,
        found: cellText(headers[i]),
      });
      return i;
    }
  }
  for (const c of candidates) {
    const i = headers.findIndex((h) => compact(h).includes(compact(c)));
    if (i >= 0) {
      warnings.push({
        code: 'column_name_changed',
        file,
        message: `Exact column not found; matched "${cellText(headers[i])}" instead — please double-check the preview values.`,
        expected: c,
        found: cellText(headers[i]),
      });
      return i;
    }
  }
  if (!opts.optional) {
    errors.push({
      code: 'column_not_found',
      file,
      message: `Required column "${name}" is missing.`,
      expected: candidates.join(' or '),
      found: `${headers.filter((h) => cellText(h)).length} columns, none matching`,
    });
  }
  return null;
}

/** Index of the first row (within the first `scan` rows) where `pred` holds. */
export function findRow(grid: Grid, pred: (row: Cell[]) => boolean, scan = 15): number | null {
  const n = Math.min(scan, grid.length);
  for (let i = 0; i < n; i++) if (pred(grid[i] ?? [])) return i;
  return null;
}

/** A school DBN: 6 chars, third is a letter (borough code). */
export function isValidDbn(dbn: string): boolean {
  return dbn.length === 6 && /[A-Za-z]/.test(dbn[2]!);
}

// --- Value parsing ----------------------------------------------------------

const PY_FLOAT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export type CellKind = 'number' | 'blank' | 'sentinel' | 'junk';

/**
 * Value parsing: blank → null; a sentinel (case-insensitive,
 * e.g. "s", "r", "n/a") → null; anything float() accepts → number; else null
 * (reported as 'junk' so drift in a value column can be detected).
 */
export function parseCell(
  v: Cell | undefined,
  sentinels: readonly string[],
  opts: { stripPercent?: boolean } = {},
): { value: number | null; kind: CellKind } {
  if (v == null) return { value: null, kind: 'blank' };
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v, kind: 'number' } : { value: null, kind: 'blank' };
  if (typeof v === 'boolean') return { value: v ? 1 : 0, kind: 'number' };
  let s = v.trim().toLowerCase();
  if (s === '') return { value: null, kind: 'blank' };
  if (sentinels.includes(s)) return { value: null, kind: 'sentinel' };
  if (opts.stripPercent) {
    s = s.replace(/%/g, '').trim();
    if (sentinels.includes(s) || s === '') return { value: null, kind: 'sentinel' };
  }
  if (PY_FLOAT.test(s)) return { value: Number(s), kind: 'number' };
  return { value: null, kind: 'junk' };
}

/** Per-value-column tallies → drift checks after the rows are read. */
export class ColumnTally {
  number = 0;
  junk = 0;
  max = -Infinity;
  junkSamples = new Set<string>();

  constructor(
    readonly label: string,
    readonly file: string,
  ) {}

  add(raw: Cell | undefined, parsed: { value: number | null; kind: CellKind }): void {
    if (parsed.kind === 'number') {
      this.number++;
      if (parsed.value! > this.max) this.max = parsed.value!;
    } else if (parsed.kind === 'junk') {
      this.junk++;
      if (this.junkSamples.size < 5) this.junkSamples.add(String(raw));
    }
  }

  /** No numbers at all → blocking (wrong column?); >5% junk → warning. */
  check(rowCount: number, errors: TransformIssue[], warnings: TransformIssue[]): void {
    if (rowCount > 0 && this.number === 0) {
      errors.push({
        code: 'no_numeric_values',
        file: this.file,
        message: `"${this.label}" has no numeric values in any school row — the column may have moved or changed meaning.`,
        expected: 'numbers (with occasional redaction codes)',
        found: this.junkSamples.size > 0 ? [...this.junkSamples].join(' · ') : 'only blanks / redactions',
      });
      return;
    }
    const denom = this.number + this.junk;
    if (denom > 0 && this.junk / denom > 0.05) {
      warnings.push({
        code: 'unparsable_values',
        file: this.file,
        message: `${this.junk} of ${denom} values in "${this.label}" aren't numbers and will be stored blank.`,
        found: [...this.junkSamples].join(' · '),
      });
    }
  }
}

// --- Rounding — matches the historical loads (pandas / Python semantics) ----

/** pandas/numpy `.round(d)`: rint(x·10^d)/10^d with half-to-even on the scaled float. */
export function npRound(x: number, d: number): number {
  const f = 10 ** d;
  const y = x * f;
  const r = Math.abs(y % 1) === 0.5 ? 2 * Math.round(y / 2) : Math.round(y);
  return r / f;
}

/** Python builtin `round(x, d)`: correctly rounded, exact ties to even. */
export function pyRound(x: number, d: number): number {
  if (!Number.isFinite(x)) return x;
  const neg = x < 0;
  const exact = Math.abs(x).toFixed(100);
  const [int, frac = ''] = exact.split('.');
  const isTie = frac[d] === '5' && /^0*$/.test(frac.slice(d + 1));
  if (!isTie) return Number(x.toFixed(d));
  const truncated = Number(`${int}.${frac.slice(0, d) || '0'}`);
  const lastDigit = Number(d > 0 ? frac[d - 1] : int!.slice(-1));
  const mag = lastDigit % 2 === 1 ? Number((truncated + 10 ** -d).toFixed(d)) : truncated;
  return neg ? -mag : mag;
}

/** Python `"{:.Nf}".format(x)`. */
export const pyFixed = (x: number, d: number): string => pyRound(x, d).toFixed(d);

/** Number → CSV cell ('' for null/NaN/∞). */
export const numCell = (x: number | null | undefined): string =>
  x == null || !Number.isFinite(x) ? '' : String(x);

// --- School years ------------------------------------------------------------

export { schoolYearFromEndYear, guessSchoolYearFromFilename } from '../../lib/schoolYear';

export const SCHOOL_YEAR_RE = /^\d{4}-\d{2}$/;
