/**
 * Port of scripts/scripts/arts_ed.py. Two DOE layouts:
 *  - 2021 raw survey export: sheet "2021", DBN = Q0_DBN, Pre-K grid columns
 *    Q11_R{1..4}_C4 where 1 = instruction NOT provided, 0/blank = provided.
 *  - 2025+ processed export: sheet "Sheet0", two header rows (labels on the
 *    second), "<Discipline> - Instruction Not Provided" text columns.
 * Score = number of disciplines with instruction provided (0–4).
 */

import { finish, newCollector, openBooks, resolveFileYear } from './common';
import { cellText, compact, findColumn, findRow, type Book, type Cell } from './workbook';
import type { Collector } from './common';
import type { RawTransform } from './types';

const DISCIPLINES = ['Dance', 'Music', 'Theater', 'Visual Arts'] as const;
const INP_2021 = ['Q11_R1_C4', 'Q11_R2_C4', 'Q11_R3_C4', 'Q11_R4_C4'];
const INP_2025 = [
  'Dance - Instruction Not Provided',
  'Music - Instruction Not Provided',
  'Theater - Instruction Not Provided',
  'VA - Instruction Not Provided',
];
const INP_TEXT = 'Instruction Not Provided';

type Layout = { kind: '2021' | '2025+'; sheet: string; headerRow: number };

function detectLayout(book: Book, c: Collector): Layout | null {
  if (book.sheetNames.includes('2021')) return { kind: '2021', sheet: '2021', headerRow: 0 };
  // 2025+: expected on "Sheet0"; otherwise any sheet carrying the INP columns.
  const ordered = [...book.sheetNames].sort((a, b) => (a === 'Sheet0' ? -1 : b === 'Sheet0' ? 1 : 0));
  for (const sheet of ordered) {
    const grid = book.grid(sheet);
    const headerRow = findRow(grid, (r) => r.some((v) => compact(v) === compact(INP_2025[0])), 6);
    if (headerRow != null) {
      if (sheet !== 'Sheet0') {
        c.warnings.push({
          code: 'sheet_name_changed',
          file: book.file,
          message: `Arts data found on sheet "${sheet}" instead of "Sheet0".`,
          expected: 'Sheet0',
          found: sheet,
        });
      }
      return { kind: '2025+', sheet, headerRow };
    }
  }
  c.errors.push({
    code: 'layout_not_recognized',
    file: book.file,
    message: 'This file matches neither known ArtsCount layout.',
    expected: `a sheet with "DBN" and "${INP_2025[0]}" … columns (2025+ export), or the 2021 raw sheet "2021"`,
    found: `sheets: ${book.sheetNames.join(' · ')}`,
  });
  return null;
}

export const artsEdTransform: RawTransform = {
  datasetId: 'arts_ed',
  multiFile: true,
  yearSource: 'filename_or_pick',
  accepts: ['.xlsx', '.xls'],
  run(files, ctx) {
    const c = newCollector();
    const books = openBooks(files, c);
    for (const book of books) {
      const schoolYear = resolveFileYear(book.file, files.length, ctx, c);
      const layout = detectLayout(book, c);
      if (!schoolYear || !layout) continue;

      const grid = book.grid(layout.sheet);
      const headers = grid[layout.headerRow] ?? [];
      const errorsBefore = c.errors.length;
      const dbnCol = findColumn(headers, layout.kind === '2021' ? 'Q0_DBN' : 'DBN', book.file, c.errors, c.warnings);
      const inpCols = (layout.kind === '2021' ? INP_2021 : INP_2025).map((h) =>
        findColumn(headers, h, book.file, c.errors, c.warnings),
      );
      if (c.errors.length > errorsBefore) continue;

      const isProvided =
        layout.kind === '2021'
          ? (v: Cell | undefined) => v == null || v === 0
          : (v: Cell | undefined) => cellText(v) !== INP_TEXT;
      const isKnownValue =
        layout.kind === '2021'
          ? (v: Cell | undefined) => v == null || v === 0 || v === 1
          : (v: Cell | undefined) => v == null || cellText(v) === '' || cellText(v) === INP_TEXT;

      let unexpected = 0;
      const unexpectedSamples = new Set<string>();
      let notProvidedMarks = 0;
      for (const r of grid.slice(layout.headerRow + 1)) {
        const dbn = cellText(r[dbnCol!]);
        if (!dbn) continue;
        const flags = inpCols.map((ci) => {
          const v = r[ci!];
          if (!isKnownValue(v)) {
            unexpected++;
            if (unexpectedSamples.size < 5) unexpectedSamples.add(String(v));
          }
          const provided = isProvided(v);
          if (!provided) notProvidedMarks++;
          return provided;
        });
        const score = flags.filter(Boolean).length;
        c.rows.push({
          DBN: dbn,
          school_year: schoolYear,
          arts_ed_score: String(score),
          arts_ed_score_label: `${score} of 4 discipline${score !== 1 ? 's' : ''}`,
          arts_ed_disciplines: DISCIPLINES.filter((_, i) => flags[i]).join(', '),
        });
      }
      if (unexpected > 0) {
        c.warnings.push({
          code: 'unexpected_values',
          file: book.file,
          message: `${unexpected} cells in the "Instruction Not Provided" columns hold unexpected values; they were counted as instruction provided.`,
          expected: layout.kind === '2021' ? '0, 1 or blank' : `"${INP_TEXT}" or blank`,
          found: [...unexpectedSamples].join(' · '),
        });
      }
      if (notProvidedMarks === 0) {
        c.warnings.push({
          code: 'no_not_provided_marks',
          file: book.file,
          message: 'No school is marked "Instruction Not Provided" for any discipline — every school scores 4 of 4. The file encoding may have changed.',
        });
      }
    }
    return finish(c, files);
  },
};
