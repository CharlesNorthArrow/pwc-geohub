import { readBook, guessSchoolYearFromFilename, SCHOOL_YEAR_RE, type Book } from './workbook';
import type { CanonicalRow, RawFile, TransformContext, TransformIssue, TransformResult } from './types';

export interface Collector {
  rows: CanonicalRow[];
  errors: TransformIssue[];
  warnings: TransformIssue[];
}

export const newCollector = (): Collector => ({ rows: [], errors: [], warnings: [] });

/** Open each file; unreadable ones become blocking errors and are skipped. */
export function openBooks(files: readonly RawFile[], c: Collector): Book[] {
  const books: Book[] = [];
  for (const f of files) {
    const b = readBook(f);
    if ('code' in b) c.errors.push(b);
    else books.push(b);
  }
  return books;
}

/**
 * School year for a file whose year isn't inside the data. Single-file
 * uploads use the year the admin confirmed in the dialog (warning if it
 * disagrees with the filename); multi-file uploads rely on each filename.
 */
export function resolveFileYear(
  file: string,
  fileCount: number,
  ctx: TransformContext,
  c: Collector,
): string | null {
  const guess = guessSchoolYearFromFilename(file);
  if (fileCount === 1 && ctx.schoolYear) {
    if (!SCHOOL_YEAR_RE.test(ctx.schoolYear)) {
      c.errors.push({ code: 'bad_school_year', file, message: 'The selected school year is malformed.', expected: 'e.g. 2024-25', found: ctx.schoolYear });
      return null;
    }
    if (guess && guess !== ctx.schoolYear) {
      c.warnings.push({
        code: 'year_differs_from_filename',
        file,
        message: `You selected ${ctx.schoolYear}, but the filename suggests ${guess}. Using ${ctx.schoolYear}.`,
      });
    }
    return ctx.schoolYear;
  }
  if (guess) return guess;
  c.errors.push({
    code: 'year_unknown',
    file,
    message:
      fileCount === 1
        ? 'Select the school year this file covers.'
        : 'Could not tell which school year this file covers from its name. Upload it on its own and pick the year.',
  });
  return null;
}

/** Sort like the scripts (`sort_values([...])` — plain string order). */
export function sortRows(rows: CanonicalRow[], keys: readonly string[]): CanonicalRow[] {
  return rows.sort((a, b) => {
    for (const k of keys) {
      const x = a[k] ?? '';
      const y = b[k] ?? '';
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  });
}

export function finish(
  c: Collector,
  files: readonly RawFile[],
  sortKeys: readonly string[] = ['school_year', 'DBN'],
): TransformResult {
  if (c.errors.length === 0 && c.rows.length === 0) {
    c.errors.push({ code: 'no_rows', message: 'No school rows were found in the upload.' });
  }
  const rows = c.errors.length > 0 ? [] : sortRows(c.rows, sortKeys);
  return {
    rows,
    errors: c.errors,
    warnings: c.warnings,
    stats: {
      files: files.map((f) => f.name),
      rowCount: rows.length,
      schoolYears: [...new Set(rows.map((r) => r.school_year!).filter(Boolean))].sort(),
    },
  };
}
