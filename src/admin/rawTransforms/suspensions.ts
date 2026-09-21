/**
 * Port of scripts/scripts/suspensions.py. Rate = TOTAL REMOVALS/SUSPENSIONS ÷
 * total enrollment × 100. Enrollment comes from the schools master for the
 * same (DBN, school_year) — supplied by the caller in ctx.enrollment (the
 * live DB on upload, schools_master.csv in the parity harness).
 */

import { finish, newCollector, openBooks, resolveFileYear } from './common';
import { cellText, ColumnTally, compact, findColumn, findRow, npRound, numCell, parseCell, pyFixed } from './workbook';
import type { RawTransform } from './types';

const TOTAL_COL = 'TOTAL REMOVALS/SUSPENSIONS';
const DBN_COLS = ['SchoolDBN', 'System_Code'];
const KNOWN_SHEETS = ['Annual Report--R-P-S TOTALS', 'Annual Report --R-P-S TOTALS'];

export const suspensionsTransform: RawTransform = {
  datasetId: 'suspensions',
  multiFile: true,
  yearSource: 'filename_or_pick',
  accepts: ['.xlsx', '.xls', '.csv'],
  needsEnrollment: true,
  run(files, ctx) {
    const c = newCollector();
    if (!ctx.enrollment) {
      c.errors.push({ code: 'enrollment_unavailable', message: 'Enrollment data could not be loaded, so rates cannot be computed.' });
      return finish(c, files);
    }
    const books = openBooks(files, c);
    let missingEnrollment = 0;
    for (const book of books) {
      const schoolYear = resolveFileYear(book.file, files.length, ctx, c);
      // Script rule: the first sheet whose name contains "TOTAL".
      let sheet: string | undefined = book.sheetNames[0];
      if (book.kind === 'excel') {
        sheet = book.sheetNames.find((s) => s.toUpperCase().includes('TOTAL'));
        if (!sheet) {
          c.errors.push({
            code: 'sheet_not_found',
            file: book.file,
            message: 'No totals sheet (name containing "TOTAL") in this workbook.',
            expected: KNOWN_SHEETS[0],
            found: book.sheetNames.join(' · '),
          });
          continue;
        }
        if (!KNOWN_SHEETS.includes(sheet)) {
          c.warnings.push({
            code: 'sheet_name_changed',
            file: book.file,
            message: `Totals sheet name differs from past files; used "${sheet}".`,
            expected: KNOWN_SHEETS[0],
            found: sheet,
          });
        }
      }
      if (!schoolYear || !sheet) continue;

      const grid = book.grid(sheet);
      const headerRow = findRow(grid, (r) => r.some((v) => compact(v) === compact(TOTAL_COL)));
      if (headerRow == null) {
        c.errors.push({
          code: 'column_not_found',
          file: book.file,
          message: `Required column "${TOTAL_COL}" is missing.`,
          expected: TOTAL_COL,
        });
        continue;
      }
      const headers = grid[headerRow]!;
      const errorsBefore = c.errors.length;
      const dbnCol = findColumn(headers, DBN_COLS[0]!, book.file, c.errors, c.warnings, { alternatives: DBN_COLS.slice(1) });
      const totalCol = findColumn(headers, TOTAL_COL, book.file, c.errors, c.warnings);
      if (c.errors.length > errorsBefore) continue;

      const tally = new ColumnTally(TOTAL_COL, book.file);
      let rows = 0;
      for (const r of grid.slice(headerRow + 1)) {
        const dbn = cellText(r[dbnCol!]);
        if (!dbn) continue;
        rows++;
        const parsed = parseCell(r[totalCol!], ['r']);
        tally.add(r[totalCol!], parsed);
        const total = parsed.value;
        const key = `${dbn}|${schoolYear}`;
        const enrollment = ctx.enrollment.get(key) ?? null;
        if (!ctx.enrollment.has(key) || enrollment == null) missingEnrollment++;
        const rate =
          total == null || enrollment == null || enrollment === 0 ? null : npRound((total / enrollment) * 100, 2);
        c.rows.push({
          DBN: dbn,
          school_year: schoolYear,
          suspension_total: numCell(total),
          suspension_rate: numCell(rate),
          suspension_rate_label: rate == null ? 'Data suppressed' : `${pyFixed(rate, 1)}% of students suspended`,
        });
      }
      tally.check(rows, c.errors, c.warnings);
    }
    if (missingEnrollment > 0) {
      c.warnings.push({
        code: 'enrollment_missing',
        message: `${missingEnrollment} rows have no enrollment in the schools master for that year, so their rate is blank.`,
      });
    }
    return finish(c, files);
  },
};
