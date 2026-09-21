/** Port of scripts/scripts/chronic_absenteeism.py. */

import { finish, newCollector, openBooks } from './common';
import { readLongTable } from './longTable';
import { cellText, ColumnTally, npRound, numCell, parseCell, pyFixed, SCHOOL_YEAR_RE } from './workbook';
import type { RawTransform } from './types';

const SENTINELS = ['s'];

export const chronicAbsenteeismTransform: RawTransform = {
  datasetId: 'chronic_absenteeism',
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
        sheet: { name: 'All Students' },
        filters: { Grade: 'All Grades', Category: 'All Students' },
        columns: {
          dbn: 'DBN',
          year: 'Year',
          count: '# Chronically Absent',
          pct: '% Chronically Absent',
        },
      },
      c,
    );
    if (!t) return finish(c, files);

    const tally = new ColumnTally('% Chronically Absent', book.file);
    let badYears = 0;
    for (const r of t.rows) {
      const dbn = cellText(r[t.col.dbn!]);
      if (!dbn) continue;
      const year = cellText(r[t.col.year!]);
      if (!SCHOOL_YEAR_RE.test(year)) {
        badYears++;
        continue;
      }
      const parsed = parseCell(r[t.col.pct!], SENTINELS);
      tally.add(r[t.col.pct!], parsed);
      const rate = parsed.value == null ? null : npRound(parsed.value, 2);
      c.rows.push({
        DBN: dbn,
        school_year: year,
        chronic_absent_count: numCell(parseCell(r[t.col.count!], SENTINELS).value),
        chronic_absent_rate: numCell(rate),
        chronic_absent_rate_label: rate == null ? 'Data suppressed' : `${pyFixed(rate, 1)}% of students chronically absent`,
      });
    }
    tally.check(c.rows.length, c.errors, c.warnings);
    if (badYears > 0) {
      c.warnings.push({
        code: 'unparsable_year',
        file: book.file,
        message: `${badYears} rows had a "Year" not shaped like 2024-25 and were skipped.`,
      });
    }
    return finish(c, files);
  },
};
