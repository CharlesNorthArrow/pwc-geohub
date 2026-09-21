/**
 * Port of scripts/scripts/temp_housing.py. The 2021 CSV carries the rate as
 * "30.7%" strings; 2022+ xlsx ("School-level" sheet) as proportions (0.307).
 * Both → percent 0–100. The scale is re-checked from the data so a format
 * flip is caught instead of silently producing 3070%.
 */

import { finish, newCollector, openBooks, resolveFileYear } from './common';
import { cellText, ColumnTally, compact, findColumn, findRow, findSheet, numCell, parseCell, pyFixed, pyRound } from './workbook';
import type { RawTransform } from './types';

const SENTINELS = ['s', 'r'];
const PCT_COL = '% Students in Temporary Housing';
const COUNT_COL = '# Students in Temporary Housing';

export const tempHousingTransform: RawTransform = {
  datasetId: 'temp_housing',
  multiFile: true,
  yearSource: 'filename_or_pick',
  accepts: ['.xlsx', '.xls', '.csv'],
  run(files, ctx) {
    const c = newCollector();
    const books = openBooks(files, c);
    for (const book of books) {
      const schoolYear = resolveFileYear(book.file, files.length, ctx, c);
      const sheet = findSheet(book, { name: 'School-level', contains: 'school' }, c.errors, c.warnings);
      if (!schoolYear || sheet == null) continue;
      const grid = book.grid(sheet);
      const headerRow = findRow(grid, (r) => r.some((v) => compact(v) === 'dbn'));
      if (headerRow == null) {
        c.errors.push({ code: 'header_not_found', file: book.file, message: `No "DBN" header row in sheet "${sheet}".` });
        continue;
      }
      const headers = grid[headerRow]!;
      const errorsBefore = c.errors.length;
      const dbnCol = findColumn(headers, 'DBN', book.file, c.errors, c.warnings);
      const pctCol = findColumn(headers, PCT_COL, book.file, c.errors, c.warnings);
      const countCol = findColumn(headers, COUNT_COL, book.file, c.errors, c.warnings);
      if (c.errors.length > errorsBefore) continue;

      const body = grid.slice(headerRow + 1).filter((r) => cellText(r[dbnCol!]) !== '');
      const tally = new ColumnTally(PCT_COL, book.file);
      const parsed = body.map((r) => {
        const p = parseCell(r[pctCol!], SENTINELS, { stripPercent: true });
        tally.add(r[pctCol!], p);
        return p.value;
      });

      // Script rule: CSV = already percent, spreadsheet = proportion. Verify.
      let isProportion = book.kind === 'excel';
      const max = tally.max;
      const hasPercentSign = body.some((r) => typeof r[pctCol!] === 'string' && (r[pctCol!] as string).includes('%'));
      if (isProportion && max > 1) {
        isProportion = false;
        c.warnings.push({
          code: 'scale_changed',
          file: book.file,
          message: 'Rates are already percentages (0–100) rather than proportions (0–1) as in past files; used as-is.',
        });
      } else if (!isProportion && !hasPercentSign && max <= 1) {
        isProportion = true;
        c.warnings.push({
          code: 'scale_changed',
          file: book.file,
          message: 'Rates look like proportions (0–1) rather than percent strings; multiplied by 100.',
        });
      }

      body.forEach((r, i) => {
        const raw = parsed[i];
        const rate = raw == null ? null : pyRound(isProportion ? raw * 100 : raw, 2);
        const count = parseCell(r[countCol!], SENTINELS).value;
        c.rows.push({
          DBN: cellText(r[dbnCol!]),
          school_year: schoolYear,
          temp_housing_count: numCell(count == null ? null : Math.trunc(count)),
          temp_housing_rate: numCell(rate),
          temp_housing_rate_label: rate == null ? 'Data suppressed' : `${pyFixed(rate, 1)}% of students in temporary housing`,
        });
      });
      tally.check(body.length, c.errors, c.warnings);
    }
    return finish(c, files);
  },
};
