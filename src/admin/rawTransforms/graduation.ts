/** Port of scripts/scripts/graduation.py. */

import { cohortYearToSchoolYear } from '../../lib/schoolYear';
import { finish, newCollector, openBooks } from './common';
import { readLongTable } from './longTable';
import { cellText, ColumnTally, npRound, numCell, parseCell, pyFixed } from './workbook';
import type { RawTransform } from './types';

const SENTINELS = ['s', 'r'];

export const graduationTransform: RawTransform = {
  datasetId: 'graduation',
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
        sheet: { name: 'All' },
        filters: { Cohort: '4 year August', Category: 'All Students' },
        columns: {
          dbn: 'DBN',
          cohortYear: 'Cohort Year',
          size: '# Total Cohort',
          pct: '% Grads',
        },
      },
      c,
    );
    if (!t) return finish(c, files);

    const tally = new ColumnTally('% Grads', book.file);
    let badYears = 0;
    for (const r of t.rows) {
      const dbn = cellText(r[t.col.dbn!]);
      if (!dbn) continue;
      const cohort = Number(cellText(r[t.col.cohortYear!]));
      const schoolYear = Number.isInteger(cohort) ? cohortYearToSchoolYear(cohort) : null;
      if (!schoolYear) {
        badYears++;
        continue;
      }
      const parsed = parseCell(r[t.col.pct!], SENTINELS);
      tally.add(r[t.col.pct!], parsed);
      const rate = parsed.value == null ? null : npRound(parsed.value, 2);
      c.rows.push({
        DBN: dbn,
        cohort_year: String(cohort),
        school_year: schoolYear,
        cohort_size: numCell(parseCell(r[t.col.size!], SENTINELS).value),
        graduation_rate: numCell(rate),
        graduation_rate_label: rate == null ? 'Data suppressed' : `${pyFixed(rate, 1)}% 4-year graduation rate`,
      });
    }
    tally.check(c.rows.length, c.errors, c.warnings);
    if (badYears > 0) {
      c.warnings.push({
        code: 'unparsable_year',
        file: book.file,
        message: `${badYears} rows had a "Cohort Year" that isn't a 4-digit year and were skipped.`,
      });
    }
    return finish(c, files);
  },
};
