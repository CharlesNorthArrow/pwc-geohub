/**
 * School Quality Reports. One upload = the School Quality
 * Report files for one or more years, one file per school type
 * (`YYYYYY-{ems,hs,hst,d75,ec}-sqr-results.xlsx`). Year and type come from
 * the DOE filename; values from the "Summary" sheet.
 *
 * Both safety fields only exist from 2023-24 on: "Safety - School Percent
 * Positive" (the map value) for every school type, the categorical "Safety
 * and School Climate - Rating" for EMS/HS/HST only. Older files load with
 * blank safety values.
 */

import { finish, newCollector, openBooks } from './common';
import { cellText, compact, findRow, findSheet, isValidDbn, numCell, parseCell, pyFixed, pyRound, type Cell } from './workbook';
import type { RawTransform } from './types';

const FILENAME_RE = /(\d{6})-([a-z0-9]+)-sqr-results/;
const KNOWN_TYPES = ['EMS', 'HS', 'HST', 'D75', 'EC'];
const RATED_TYPES = ['EMS', 'HS', 'HST'];
const FIRST_SAFETY_YEAR_END = 2024; // 2023-24
const RATINGS = new Set(['Excellent', 'Good', 'Fair', 'Needs Improvement']);
const RATING_COL = 'Safety and School Climate - Rating';
const SAFETY_COL = 'Safety - School Percent Positive';

/** parse_decimal: ≤1 → ×100, else already percent; 1 decimal. */
function parseSafety(v: Cell | undefined): number | null {
  const p = parseCell(v, ['s', 'r', 'n/a']);
  if (p.value == null) return null;
  return p.value <= 1 ? pyRound(p.value * 100, 1) : pyRound(p.value, 1);
}

const findHeader = (headers: readonly Cell[], text: string): number | null => {
  const i = headers.findIndex((h) => h != null && String(h).toLowerCase().includes(text.toLowerCase()));
  return i >= 0 ? i : null;
};

export const schoolQualityTransform: RawTransform = {
  datasetId: 'school_quality',
  multiFile: true,
  yearSource: 'filename_code',
  accepts: ['.xlsx', '.xls'],
  run(files) {
    const c = newCollector();
    const typesByYear = new Map<string, Set<string>>();
    for (const book of openBooks(files, c)) {
      const m = FILENAME_RE.exec(book.file.toLowerCase());
      if (!m) {
        c.errors.push({
          code: 'filename_not_recognized',
          file: book.file,
          message: "School year and school type are read from DOE's filename. Keep the original name.",
          expected: 'e.g. 202425-ems-sqr-results.xlsx',
          found: book.file,
        });
        continue;
      }
      const code = m[1]!;
      const start = Number(code.slice(0, 4));
      const endTwo = code.slice(4);
      if (String((start + 1) % 100).padStart(2, '0') !== endTwo) {
        c.errors.push({ code: 'filename_not_recognized', file: book.file, message: `"${code}" is not a school-year code like 202425.` });
        continue;
      }
      const schoolYear = `${start}-${endTwo}`;
      const schoolType = m[2]!.toUpperCase();
      if (!KNOWN_TYPES.includes(schoolType)) {
        c.warnings.push({
          code: 'unknown_school_type',
          file: book.file,
          message: `School type "${schoolType}" is new; its rows are loaded with that type.`,
          expected: KNOWN_TYPES.join(', '),
          found: schoolType,
        });
      }
      if (!typesByYear.has(schoolYear)) typesByYear.set(schoolYear, new Set());
      typesByYear.get(schoolYear)!.add(schoolType);

      const sheet = findSheet(book, { name: 'Summary' }, c.errors, c.warnings);
      if (sheet == null) continue;
      const grid = book.grid(sheet);
      const hdr = findRow(grid, (r) => r.some((v) => compact(v) === 'dbn'));
      if (hdr == null) {
        c.errors.push({ code: 'header_not_found', file: book.file, message: 'Could not find the header row (a "DBN" column) in "Summary".' });
        continue;
      }
      const headers = grid[hdr]!;
      const dbnCol = headers.findIndex((v) => compact(v) === 'dbn');
      if (dbnCol !== 3) {
        c.warnings.push({
          code: 'column_moved',
          file: book.file,
          message: `DBN is in column ${dbnCol + 1} instead of column 4 as in past files; used the new position.`,
        });
      }
      const ratingCol = findHeader(headers, RATING_COL);
      const safetyCol = findHeader(headers, SAFETY_COL);
      const expectsSafety = start + 1 >= FIRST_SAFETY_YEAR_END;
      const expectsRating = expectsSafety && RATED_TYPES.includes(schoolType);
      if (safetyCol == null && expectsSafety) {
        c.errors.push({
          code: 'column_not_found',
          file: book.file,
          message: `Required column "${SAFETY_COL}" is missing from "Summary" (it exists from 2023-24 on).`,
          expected: SAFETY_COL,
        });
      }
      if (ratingCol == null && expectsRating) {
        c.errors.push({
          code: 'column_not_found',
          file: book.file,
          message: `"${RATING_COL}" is missing — it exists for ${RATED_TYPES.join('/')} reports from 2023-24 on.`,
          expected: RATING_COL,
        });
      }
      if ((safetyCol == null && expectsSafety) || (ratingCol == null && expectsRating)) continue;

      let unknownRatings = 0;
      const unknownSamples = new Set<string>();
      let safetyNumbers = 0;
      let rows = 0;
      for (const r of grid.slice(hdr + 1)) {
        const dbn = cellText(r[dbnCol]);
        if (!isValidDbn(dbn)) continue;
        rows++;
        const ratingText = ratingCol == null ? '' : cellText(r[ratingCol]);
        const rating = RATINGS.has(ratingText) ? ratingText : null;
        if (ratingText && !rating) {
          unknownRatings++;
          if (unknownSamples.size < 5) unknownSamples.add(ratingText);
        }
        const safety = safetyCol == null ? null : parseSafety(r[safetyCol]);
        if (safety != null) safetyNumbers++;
        c.rows.push({
          DBN: dbn,
          school_year: schoolYear,
          school_type: schoolType,
          safety_climate_rating: rating ?? '',
          safety_climate_rating_label: rating ? `Safety & School Climate: ${rating}` : 'Rating not available',
          safety_pct_positive: numCell(safety),
          safety_pct_positive_label:
            safety == null ? 'Data not available' : `${pyFixed(safety, 1)}% responded positively to safety questions`,
        });
      }
      if (unknownRatings > 0) {
        c.warnings.push({
          code: 'unexpected_values',
          file: book.file,
          message: `${unknownRatings} ratings aren't one of ${[...RATINGS].join(' / ')} and were stored blank.`,
          found: [...unknownSamples].join(' · '),
        });
      }
      if (rows > 0 && safetyNumbers === 0 && safetyCol != null) {
        c.errors.push({
          code: 'no_numeric_values',
          file: book.file,
          message: `"${SAFETY_COL}" has no numeric values — the column may have changed meaning.`,
        });
      }
    }
    for (const [year, types] of typesByYear) {
      const missing = KNOWN_TYPES.filter((t) => !types.has(t));
      if (missing.length > 0) {
        c.warnings.push({
          code: 'school_types_missing',
          message: `${year}: no file for ${missing.join(', ')}. Those schools keep their current values.`,
        });
      }
    }
    return finish(c, files, ['school_year', 'school_type', 'DBN']);
  },
};
