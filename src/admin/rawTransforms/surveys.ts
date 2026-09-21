/**
 * NYC School Survey — family, teacher and student files.
 *
 * 2022+ files share the "<Who> Pos & Neg %" layout: a row of question texts,
 * a row of response labels, then one row per school (DBN in column A). A
 * question's positive-response value sits a fixed number of columns after
 * the cell holding its text. Question NUMBERS shift every year, so the
 * question is located by its text; its column in past files is kept as a
 * cross-check (a mismatch is a warning).
 *
 * 2021 files are flat CSVs with one column per question × response.
 */

import { finish, newCollector, openBooks, resolveFileYear } from './common';
import {
  cellText,
  ColumnTally,
  compact,
  findSheet,
  isValidDbn,
  numCell,
  parseCell,
  pyFixed,
  pyRound,
  type Book,
  type Cell,
} from './workbook';
import { schoolYearEnd } from '../../lib/schoolYear';
import type { Collector } from './common';
import type { CanonicalRow, RawTransform } from './types';

type Scale = 'proportion' | 'percent';

interface QuestionSpec {
  field: string;
  /** Human name for messages. */
  name: string;
  /** Case-insensitive fragment of the question text. */
  text: string;
  /** Positive-response column = question-text column + offset. */
  offset: number;
  /** End year → 0-based positive column in past files. */
  knownCols: Record<number, number>;
  /** 2021 CSV: pick the column whose header matches. null = not asked in 2021. */
  csv2021: ((header: string) => boolean) | null;
  label: string; // "{v}" placeholder
}

interface SurveySpec {
  datasetId: string;
  sheet: string;
  /** Scale of the most recent known file, plus older exceptions. */
  scale: Scale;
  scaleByYear?: Record<number, Scale>;
  /** 2021 CSV value format. */
  csv2021Format: 'pct_string' | 'decimal';
  /** 2021 CSV DBN column: a header name, or 'first' for column A. */
  csv2021Dbn: string | 'first';
  questions: QuestionSpec[];
}

const SENTINELS = ['s', 'r', 'n/a'];

/** Lower-case with every whitespace run → one space. DOE puts non-breaking
 *  spaces in question text (2022 student q15: "my<NBSP>mental-health"). */
const normText = (v: unknown): string => String(v ?? '').toLowerCase().replace(/\s+/g, ' ');
const NOT_AVAILABLE = 'Data not available';

function valueOf(raw: Cell | undefined, scale: Scale, tally: ColumnTally): number | null {
  const p = parseCell(raw, SENTINELS);
  tally.add(raw, p);
  if (p.value == null) return null;
  return scale === 'proportion' ? pyRound(p.value * 100, 2) : pyRound(p.value, 2);
}

function labelFor(q: QuestionSpec, v: number | null): string {
  return v == null ? NOT_AVAILABLE : q.label.replace('{v}', pyFixed(v, 1));
}

function runPosNeg(book: Book, spec: SurveySpec, schoolYear: string, c: Collector): void {
  const sheet = findSheet(book, { name: spec.sheet, contains: 'pos&neg' }, c.errors, c.warnings);
  if (sheet == null) return;
  const grid = book.grid(sheet);
  const endYear = schoolYearEnd(schoolYear) ?? 0;

  // Locate every question by text in the first few rows.
  const cols: number[] = [];
  let questionRow = -1;
  for (const q of spec.questions) {
    let found: number | null = null;
    for (let r = 0; r < Math.min(6, grid.length) && found == null; r++) {
      const i = (grid[r] ?? []).findIndex((v) => v != null && normText(v).includes(normText(q.text)));
      if (i >= 0) {
        found = i + q.offset;
        questionRow = Math.max(questionRow, r);
      }
    }
    const known = q.knownCols[endYear];
    if (found == null) {
      c.errors.push({
        code: 'question_not_found',
        file: book.file,
        message: `Could not find the ${q.name} question in sheet "${sheet}". The survey wording may have changed.`,
        expected: `question text containing "${q.text}"`,
        found: 'no matching question',
      });
      continue;
    }
    if (known != null && known !== found) {
      c.warnings.push({
        code: 'question_moved',
        file: book.file,
        message: `${q.name}: found at column ${found + 1}, previously column ${known + 1}. Used the text match.`,
      });
    }
    cols.push(found);
  }
  if (cols.length < spec.questions.length) return;

  const body = grid.slice(questionRow + 1).filter((r) => isValidDbn(cellText(r[0])));
  if (body.length === 0) return;

  // Proportion vs percent: decide from the data, warn if it differs from
  // what past files looked like.
  const expected = spec.scaleByYear?.[endYear] ?? spec.scale;
  const scales = cols.map((ci) => {
    const max = Math.max(...body.map((r) => parseCell(r[ci], SENTINELS).value ?? -Infinity));
    return max > 1 ? 'percent' : ('proportion' as Scale);
  });
  scales.forEach((s, i) => {
    if (s !== expected) {
      c.warnings.push({
        code: 'scale_changed',
        file: book.file,
        message: `${spec.questions[i]!.name}: values are ${s === 'percent' ? 'percentages (0–100)' : 'proportions (0–1)'}, unlike past files; converted accordingly.`,
      });
    }
  });

  const tallies = spec.questions.map((q) => new ColumnTally(q.name, book.file));
  for (const r of body) {
    const row: CanonicalRow = { DBN: cellText(r[0]), school_year: schoolYear };
    spec.questions.forEach((q, i) => {
      const v = valueOf(r[cols[i]!], scales[i]!, tallies[i]!);
      row[q.field] = numCell(v);
      row[`${q.field}_label`] = labelFor(q, v);
    });
    c.rows.push(row);
  }
  tallies.forEach((t) => t.check(body.length, c.errors, c.warnings));
}

function runCsv2021(book: Book, spec: SurveySpec, schoolYear: string, c: Collector): void {
  const grid = book.grid(book.sheetNames[0]!);
  const headers = (grid[0] ?? []).map((h) => cellText(h));
  const dbnCol = spec.csv2021Dbn === 'first' ? 0 : headers.findIndex((h) => compact(h) === compact(spec.csv2021Dbn));
  if (dbnCol < 0) {
    c.errors.push({ code: 'column_not_found', file: book.file, message: `Required column "${spec.csv2021Dbn}" is missing.` });
    return;
  }
  const qCols = spec.questions.map((q) => {
    if (!q.csv2021) return null;
    const i = headers.findIndex((h) => q.csv2021!(normText(h)));
    if (i < 0) {
      c.errors.push({
        code: 'question_not_found',
        file: book.file,
        message: `Could not find the ${q.name} column in this CSV.`,
        expected: `a header containing "${q.text}"`,
      });
    }
    return i;
  });
  if (qCols.some((i) => i != null && i < 0)) return;

  const tallies = spec.questions.map((q) => new ColumnTally(q.name, book.file));
  const body = grid.slice(1).filter((r) => isValidDbn(cellText(r[dbnCol])));
  for (const r of body) {
    const row: CanonicalRow = { DBN: cellText(r[dbnCol]), school_year: schoolYear };
    spec.questions.forEach((q, i) => {
      const ci = qCols[i];
      let v: number | null = null;
      if (ci != null) {
        const p = parseCell(r[ci], SENTINELS, { stripPercent: spec.csv2021Format === 'pct_string' });
        tallies[i]!.add(r[ci], p);
        if (p.value != null) v = pyRound(spec.csv2021Format === 'decimal' ? p.value * 100 : p.value, 2);
      }
      row[q.field] = numCell(v);
      row[`${q.field}_label`] = labelFor(q, v);
    });
    c.rows.push(row);
  }
  spec.questions.forEach((q, i) => {
    if (qCols[i] != null) tallies[i]!.check(body.length, c.errors, c.warnings);
  });
}

function surveyTransform(spec: SurveySpec): RawTransform {
  return {
    datasetId: spec.datasetId,
    multiFile: true,
    yearSource: 'filename_or_pick',
    accepts: ['.xlsx', '.xlsb', '.xls', '.csv'],
    run(files, ctx) {
      const c = newCollector();
      for (const book of openBooks(files, c)) {
        const schoolYear = resolveFileYear(book.file, files.length, ctx, c);
        if (!schoolYear) continue;
        const before = c.rows.length;
        if (book.kind === 'csv') runCsv2021(book, spec, schoolYear, c);
        else runPosNeg(book, spec, schoolYear, c);
        if (c.rows.length === before && !c.errors.some((e) => e.file === book.file)) {
          c.errors.push({ code: 'no_rows', file: book.file, message: 'No school rows (valid DBNs in column A) were found.' });
        }
      }
      return finish(c, files);
    },
  };
}

export const familySurveyTransform = surveyTransform({
  datasetId: 'family_survey',
  sheet: 'Family Pos & Neg %',
  scale: 'proportion',
  csv2021Format: 'pct_string',
  csv2021Dbn: 'DBN',
  questions: [
    {
      field: 'family_q36_pct_satisfied',
      name: 'Family q36 (satisfied with education)',
      text: 'education my child has received this year',
      offset: 1,
      knownCols: {},
      // 2021 CSV labels are swapped: the "Dissatisfied/Very dissatisfied"
      // column holds the satisfied share.
      csv2021: (h) => h.includes('education my child has received this year') && h.includes('dissatisfied/very dissatisfied'),
      label: "{v}% of families satisfied with their child's education",
    },
  ],
});

export const teacherSurveyTransform = surveyTransform({
  datasetId: 'teacher_survey',
  sheet: 'Teacher Pos & Neg %',
  scale: 'proportion',
  csv2021Format: 'decimal',
  csv2021Dbn: 'DBN',
  questions: [
    {
      field: 'teacher_q119_disruptive_sel',
      name: 'Teacher q119 (disruptive behavior as SEL opportunity)',
      text: 'recognize disruptive behavior as social-emotional',
      offset: 1,
      knownCols: { 2022: 324, 2023: 244, 2024: 238, 2025: 239 },
      csv2021: (h) => h.includes('recognize disruptive behavior as social-emotional') && h.includes('a lot/all'),
      label: '{v}% of adults recognize disruptive behavior as SEL opportunity',
    },
    {
      field: 'teacher_q120_access_supports',
      name: 'Teacher q120 (access to behavioral/emotional supports)',
      text: 'access to school-based supports to assist in behavioral',
      offset: 1,
      knownCols: { 2022: 328, 2023: 248, 2024: 240, 2025: 241 },
      csv2021: (h) => h.includes('access to school-based supports to assist in behavioral') && h.includes('a lot/all'),
      label: '{v}% of adults have access to behavioral/emotional supports',
    },
  ],
});

export const studentSurveyTransform = surveyTransform({
  datasetId: 'student_survey',
  sheet: 'Student Pos & Neg %',
  scale: 'percent',
  scaleByYear: { 2022: 'proportion', 2023: 'proportion', 2024: 'proportion' },
  csv2021Format: 'pct_string',
  csv2021Dbn: 'first',
  questions: [
    {
      field: 'student_q20_mental_health',
      name: 'Student q20 (knows where to get mental-health support)',
      text: 'additional support with my mental-health',
      offset: 1,
      knownCols: { 2022: 32, 2023: 38, 2024: 42, 2025: 43 },
      csv2021: null,
      label: '{v}% of students know where to get mental health support',
    },
    {
      field: 'student_q22_felt_happy',
      name: 'Student q22 (felt happy at school)',
      text: 'felt happy',
      offset: 1,
      knownCols: { 2022: 36, 2023: 42, 2024: 46, 2025: 47 },
      csv2021: (h) => h.includes('felt happy') && h.includes('agree') && !h.includes('disagree'),
      label: '{v}% of students felt happy at school',
    },
  ],
});
