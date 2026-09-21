/** ELA and Math: NY State 3-8 test results, all grades, all students. */

import { finish, newCollector, openBooks } from './common';
import { readLongTable } from './longTable';
import { cellText, ColumnTally, npRound, numCell, parseCell, pyFixed, schoolYearFromEndYear } from './workbook';
import type { RawTransform } from './types';

const SENTINELS = ['s', 'r'];

function stateTestTransform(datasetId: 'ela' | 'math', sheet: string, subject: string): RawTransform {
  const p = datasetId;
  return {
    datasetId,
    multiFile: false,
    yearSource: 'in_file',
    accepts: ['.xlsx', '.xls'],
    run(files) {
      const c = newCollector();
      if (files.length > 1) {
        c.warnings.push({ code: 'multiple_files', message: `Expected one file; used "${files[0]!.name}" and ignored the rest.` });
      }
      const [book] = openBooks(files.slice(0, 1), c);
      if (!book) return finish(c, files);
      const t = readLongTable(
        book,
        {
          sheet: { name: sheet, contains: subject },
          filters: { Grade: 'All Grades', Category: 'All Students' },
          columns: {
            dbn: 'DBN',
            year: 'Year',
            tested: 'Number Tested',
            mean: 'Mean Scale Score',
            pct: '% Level 3+4',
          },
        },
        c,
      );
      if (!t) return finish(c, files);

      const pctTally = new ColumnTally('% Level 3+4', book.file);
      let badYears = 0;
      for (const r of t.rows) {
        const dbn = cellText(r[t.col.dbn!]);
        if (!dbn) continue;
        const yearNum = Number(cellText(r[t.col.year!]));
        if (!Number.isInteger(yearNum) || yearNum < 2000) {
          badYears++;
          continue;
        }
        const tested = parseCell(r[t.col.tested!], SENTINELS).value;
        const mean = parseCell(r[t.col.mean!], SENTINELS).value;
        const pctParsed = parseCell(r[t.col.pct!], SENTINELS);
        pctTally.add(r[t.col.pct!], pctParsed);
        const pct = pctParsed.value == null ? null : npRound(pctParsed.value, 2);
        c.rows.push({
          DBN: dbn,
          school_year: schoolYearFromEndYear(yearNum),
          [`${p}_number_tested`]: numCell(tested),
          [`${p}_mean_scale_score`]: numCell(mean == null ? null : npRound(mean, 1)),
          [`${p}_pct_proficient`]: numCell(pct),
          [`${p}_pct_proficient_label`]:
            pct == null ? 'Data suppressed' : `${pyFixed(pct, 1)}% ${subject} proficiency (Levels 3+4)`,
        });
      }
      pctTally.check(c.rows.length, c.errors, c.warnings);
      if (badYears > 0) {
        c.warnings.push({
          code: 'unparsable_year',
          file: book.file,
          message: `${badYears} rows had a "Year" that isn't a 4-digit year and were skipped.`,
        });
      }
      return finish(c, files);
    },
  };
}

export const elaTransform = stateTestTransform('ela', 'ELA - All', 'ELA');
export const mathTransform = stateTestTransform('math', 'Math - All', 'Math');
