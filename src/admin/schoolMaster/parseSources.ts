/**
 * Recognize an uploaded school-master source file and parse it into its
 * extract. Recognition is by CONTENT first (sheet / column signatures) and
 * filename second, so DOE's hash-suffixed download names are fine.
 *
 * Blocking errors = the file's structure drifted beyond what the build can
 * handle (missing sheet/column, no usable rows, no year in a directory
 * filename, a PDF without SED codes). Warnings = tolerated drift.
 */

import { extractText, getDocumentProxy } from 'unpdf';
import {
  cellText,
  ColumnTally,
  compact,
  extOf,
  findColumn,
  findRow,
  readBook,
  SCHOOL_YEAR_RE,
  type Book,
  type Cell,
} from '../rawTransforms/workbook';
import type { RawFile, TransformIssue } from '../rawTransforms/types';
import {
  directorySlot,
  LEVEL_LABEL,
  type DirectoryLevel,
  type ParsedFile,
  type SourceRecord,
  type SourceValue,
} from './types';

// --- shared helpers ----------------------------------------------------------

const BOROUGH_CODES = new Set(['M', 'X', 'K', 'Q', 'R']);

/** 6 chars with a real borough code in the 3rd position. */
export const isValidBoroughDbn = (dbn: string): boolean => dbn.length === 6 && BOROUGH_CODES.has(dbn[2]!);

/** Real schools have a numeric school code (01M015); pre-K centers don't (01MATK). */
export const isRealSchoolDbn = (dbn: string): boolean => isValidBoroughDbn(dbn) && /^\d{3}$/.test(dbn.slice(3));

const raw = (v: Cell | undefined): SourceValue =>
  v == null ? null : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'string' && v.trim() === '' ? null : v;

interface Ctx {
  file: string;
  errors: TransformIssue[];
  warnings: TransformIssue[];
}

const headerIndex = (headers: readonly Cell[], name: string): number =>
  headers.findIndex((h) => cellText(h).toLowerCase() === name.toLowerCase());

// --- Demographic Snapshot ----------------------------------------------------

/** Master column ← snapshot header. DBN / school_year first. */
const SNAPSHOT_COLUMNS: ReadonlyArray<[string, string]> = [
  ['DBN', 'DBN'],
  ['school_year', 'Year'],
  ['school_name', 'School Name'],
  ['total_enrollment', 'Total Enrollment'],
  ['n_students_with_disabilities', '# Students with Disabilities'],
  ['pct_students_with_disabilities', '% Students with Disabilities'],
  ['n_english_language_learners', '# English Language Learners'],
  ['pct_english_language_learners', '% English Language Learners'],
  ['n_poverty', '# Poverty'],
  ['pct_poverty', '% Poverty'],
  ['economic_need_index', 'Economic Need Index'],
  ['n_asian', '# Asian and Pacific Islander'],
  ['pct_asian', '% Asian and Pacific Islander'],
  ['n_black', '# Black'],
  ['pct_black', '% Black'],
  ['n_hispanic', '# Hispanic'],
  ['pct_hispanic', '% Hispanic'],
  ['n_white', '# White'],
  ['pct_white', '% White'],
  ['n_multi_racial', '# Multi-Racial'],
  ['pct_multi_racial', '% Multi-Racial'],
  ['n_female', '# Female'],
  ['pct_female', '% Female'],
  ['n_male', '# Male'],
  ['pct_male', '% Male'],
];

function parseSnapshot(book: Book, sheet: string, c: Ctx): SourceRecord | null {
  if (sheet !== 'School') {
    c.warnings.push({
      code: 'sheet_name_changed',
      file: c.file,
      message: `School-level data found on sheet "${sheet}" instead of "School".`,
      expected: 'School',
      found: sheet,
    });
  }
  const grid = book.grid(sheet);
  const hdr = findRow(grid, (r) => r.some((v) => compact(v) === 'dbn'));
  if (hdr == null) {
    c.errors.push({ code: 'header_not_found', file: c.file, message: `No header row (a "DBN" column) in the "${sheet}" sheet.` });
    return null;
  }
  const headers = grid[hdr]!;
  const before = c.errors.length;
  const cols = SNAPSHOT_COLUMNS.map(([, h]) => findColumn(headers, h, c.file, c.errors, c.warnings, { noContains: true }));
  if (c.errors.length > before) return null;

  const rows: SourceValue[][] = [];
  const years = new Set<string>();
  let badYears = 0;
  const enrollment = new ColumnTally('Total Enrollment', c.file);
  for (const r of grid.slice(hdr + 1)) {
    const dbn = cellText(r[cols[0]!]!);
    if (!dbn) continue;
    const year = cellText(r[cols[1]!]!);
    if (!SCHOOL_YEAR_RE.test(year)) {
      badYears++;
      continue;
    }
    years.add(year);
    const v = r[cols[3]!]!;
    enrollment.add(v, typeof v === 'number' ? { value: v, kind: 'number' } : { value: null, kind: v == null ? 'blank' : 'junk' });
    rows.push(cols.map((ci, i) => (i === 0 ? dbn : i === 1 ? year : raw(r[ci!]))));
  }
  if (badYears > 0 && rows.length === 0) {
    c.errors.push({
      code: 'unparsable_year',
      file: c.file,
      message: 'No "Year" value is shaped like 2024-25.',
      found: cellText(grid[hdr + 1]?.[cols[1]!]) || '(blank)',
    });
    return null;
  }
  if (badYears > 0) {
    c.warnings.push({ code: 'unparsable_year', file: c.file, message: `${badYears} rows had a "Year" not shaped like 2024-25 and were skipped.` });
  }
  enrollment.check(rows.length, c.errors, c.warnings);
  if (rows.length === 0) {
    c.errors.push({ code: 'no_rows', file: c.file, message: 'No school rows in the "School" sheet.' });
    return null;
  }
  const sorted = [...years].sort();
  return {
    slot: 'snapshot',
    kind: 'snapshot',
    filename: c.file,
    rowCount: rows.length,
    summary: `${sorted[0]} → ${sorted[sorted.length - 1]} · ${rows.length.toLocaleString('en-US')} rows`,
    extract: { kind: 'snapshot', columns: SNAPSHOT_COLUMNS.map(([id]) => id), rows },
  };
}

// --- Directory data ----------------------------------------------------------

const levelFromFilename = (name: string): DirectoryLevel | null => {
  const n = name.toLowerCase();
  if (/(^|[^a-z])(hs|high)([^a-z]|$)/.test(n)) return 'hs';
  if (/(^|[^a-z])(ms|middle)([^a-z]|$)/.test(n)) return 'ms';
  if (/(^|[^a-z])(es|elementary)([^a-z]|$)/.test(n)) return 'es';
  return null;
};

/** Directory names sometimes end in " (DBN)" — strip it. */
export function cleanSchoolName(v: Cell | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s.endsWith(')') && s.includes('(')) {
    const head = s.slice(0, s.lastIndexOf('(')).trim();
    if (head) return head;
  }
  return s;
}

function findDirectorySheet(book: Book): { sheet: string; headers: Cell[] } | null {
  const ordered = [
    ...book.sheetNames.filter((s) => s === 'Data' || s === 'Sheet1'),
    ...book.sheetNames.filter((s) => s !== 'Data' && s !== 'Sheet1'),
  ];
  for (const sheet of ordered) {
    const headers = book.grid(sheet)[0] ?? [];
    if (headerIndex(headers, 'schooldbn') >= 0 || headerIndex(headers, 'dbn') >= 0) return { sheet, headers };
  }
  return null;
}

function parseDirectory(book: Book, c: Ctx): SourceRecord | null {
  const yearMatch = /fall[-_ ]?(\d{4})/i.exec(c.file);
  if (!yearMatch) {
    c.errors.push({
      code: 'year_not_in_filename',
      file: c.file,
      message: "The fall year is read from DOE's filename. Keep the original name.",
      expected: 'e.g. fall-2025---hs-directory-data….xlsx',
      found: c.file,
    });
    return null;
  }
  const fallYear = Number(yearMatch[1]);
  const found = findDirectorySheet(book);
  if (!found) {
    c.errors.push({ code: 'column_not_found', file: c.file, message: 'No sheet with a "schooldbn" or "dbn" column.' });
    return null;
  }
  const { sheet, headers } = found;
  const shapeLevel: DirectoryLevel =
    headerIndex(headers, 'dbn') >= 0 && headerIndex(headers, 'school_name') >= 0 ? 'hs' : sheet === 'Sheet1' ? 'es' : 'ms';
  const nameLevel = levelFromFilename(c.file);
  const level = nameLevel ?? shapeLevel;
  if (!nameLevel) {
    c.warnings.push({
      code: 'level_inferred',
      file: c.file,
      message: `The filename doesn't say ES / MS / HS; treated as ${LEVEL_LABEL[level]} from the file's layout.`,
    });
  } else if (nameLevel !== shapeLevel) {
    c.warnings.push({
      code: 'level_mismatch',
      file: c.file,
      message: `The filename says ${LEVEL_LABEL[nameLevel]} but the layout looks like ${LEVEL_LABEL[shapeLevel]}; used the filename.`,
    });
  }

  const pick = (preferred: string, other: string): number => {
    const i = headerIndex(headers, preferred);
    return i >= 0 ? i : headerIndex(headers, other);
  };
  const dbnCol = level === 'hs' ? pick('dbn', 'schooldbn') : pick('schooldbn', 'dbn');
  const nameCol = level === 'hs' ? pick('school_name', 'name') : pick('name', 'school_name');
  const gradeCol = headerIndex(headers, 'gradespan');
  if (nameCol < 0) {
    c.warnings.push({ code: 'column_not_found', file: c.file, message: 'No school name column ("name" / "school_name"); names come from other sources.' });
  }

  const seen = new Set<string>();
  const schools: Array<[string, string | null, string | null]> = [];
  for (const r of book.grid(sheet).slice(1)) {
    const dbn = cellText(r[dbnCol]);
    if (!isValidBoroughDbn(dbn) || seen.has(dbn)) continue;
    seen.add(dbn);
    const grade = gradeCol >= 0 ? r[gradeCol] : null;
    schools.push([dbn, nameCol >= 0 ? cleanSchoolName(r[nameCol]) : null, grade == null ? null : String(grade)]);
  }
  if (schools.length === 0) {
    c.errors.push({ code: 'no_rows', file: c.file, message: 'No school DBNs found in the directory file.' });
    return null;
  }
  return {
    slot: directorySlot(fallYear, level),
    kind: 'directory',
    filename: c.file,
    rowCount: schools.length,
    summary: `Fall ${fallYear} · ${LEVEL_LABEL[level]} · ${schools.length.toLocaleString('en-US')} schools`,
    extract: { kind: 'directory', fallYear, level, schools },
  };
}

// --- LCGMS geocoded CSV ------------------------------------------------------

const GEO_COLUMNS: ReadonlyArray<[string, string]> = [
  ['address', 'Primary Address'],
  ['location_category', 'Location Category Description'],
  ['managed_by', 'Managed By Name'],
  ['location_type', 'Location Type Description'],
  ['grades', 'Grades Final'],
  ['latitude', 'Latitude'],
  ['longitude', 'Longitude'],
];

/** Title-case like the historical build ("STATEN IS" → "Staten Island"). */
export const titleBorough = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/(^|[^a-z])([a-z])/g, (_, p: string, ch: string) => p + ch.toUpperCase())
    .replace(/Staten Is$/, 'Staten Island');

function parseLcgmsGeo(book: Book, c: Ctx): SourceRecord | null {
  const grid = book.grid(book.sheetNames[0]!);
  const headers = grid[0] ?? [];
  const before = c.errors.length;
  const atsCol = findColumn(headers, 'ATS System Code', c.file, c.errors, c.warnings, { noContains: true });
  const boroCol = findColumn(headers, 'Borough', c.file, c.errors, c.warnings, { noContains: true });
  const cols = GEO_COLUMNS.map(([, h]) => findColumn(headers, h, c.file, c.errors, c.warnings, { noContains: true }));
  if (c.errors.length > before) return null;

  const lat = new ColumnTally('Latitude', c.file);
  const seen = new Set<string>();
  const schools: SourceValue[][] = [];
  for (const r of grid.slice(1)) {
    const ats = r[atsCol!];
    const boro = r[boroCol!];
    if (ats == null || boro == null) continue;
    const dbn = String(ats).trim();
    if (seen.has(dbn)) continue;
    seen.add(dbn);
    const latRaw = r[cols[5]!];
    lat.add(latRaw, latRaw == null ? { value: null, kind: 'blank' } : Number.isFinite(Number(latRaw)) ? { value: Number(latRaw), kind: 'number' } : { value: null, kind: 'junk' });
    schools.push([dbn, titleBorough(String(boro)), ...cols.map((ci) => raw(r[ci!]))]);
  }
  lat.check(schools.length, c.errors, c.warnings);
  if (schools.length === 0) {
    c.errors.push({ code: 'no_rows', file: c.file, message: 'No schools with an ATS System Code and Borough.' });
    return null;
  }
  const withCoords = schools.filter((s) => s[7] != null && s[8] != null).length;
  return {
    slot: 'lcgms_geo',
    kind: 'lcgms_geo',
    filename: c.file,
    rowCount: schools.length,
    summary: `${schools.length.toLocaleString('en-US')} schools · ${withCoords.toLocaleString('en-US')} with coordinates`,
    extract: { kind: 'lcgms_geo', schools },
  };
}

// --- LCGMS School Data export (BEDS) ------------------------------------------

/** A BEDS/SED code as a 12-digit zero-padded string, or null. */
export function fmtBeds(v: Cell | undefined): string | null {
  if (v == null) return null;
  let code: string;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    code = BigInt(Math.trunc(v)).toString();
  } else {
    const n = Number(String(v).trim());
    code = Number.isFinite(n) && String(v).trim() !== '' ? BigInt(Math.trunc(n)).toString() : String(v).trim();
  }
  code = code.replace(/\D/g, '');
  return code ? code.padStart(12, '0') : null;
}

function parseLcgmsBeds(book: Book, c: Ctx): SourceRecord | null {
  const grid = book.grid(book.sheetNames[0]!);
  const hdr = findRow(grid, (r) => r.some((v) => compact(v) === compact('BEDS Number')));
  if (hdr == null) {
    c.errors.push({ code: 'column_not_found', file: c.file, message: 'Required column "BEDS Number" is missing.' });
    return null;
  }
  const headers = grid[hdr]!;
  const before = c.errors.length;
  const atsCol = findColumn(headers, 'ATS System Code', c.file, c.errors, c.warnings, { noContains: true });
  const bedsCol = findColumn(headers, 'BEDS Number', c.file, c.errors, c.warnings, { noContains: true });
  if (c.errors.length > before) return null;

  const seen = new Set<string>();
  const beds: Array<[string, string | null]> = [];
  let withBeds = 0;
  for (const r of grid.slice(hdr + 1)) {
    const ats = r[atsCol!];
    if (ats == null || cellText(ats) === '') continue;
    const dbn = String(ats).trim();
    if (seen.has(dbn)) continue;
    seen.add(dbn);
    const b = fmtBeds(r[bedsCol!]);
    if (b) withBeds++;
    beds.push([dbn, b]);
  }
  if (withBeds === 0) {
    c.errors.push({ code: 'no_numeric_values', file: c.file, message: '"BEDS Number" has no usable values.' });
    return null;
  }
  const d = /(\d{4})(\d{2})(\d{2})/.exec(c.file);
  const exportDate = d ? `${d[1]}-${d[2]}-${d[3]}` : null;
  return {
    slot: 'lcgms_beds',
    kind: 'lcgms_beds',
    filename: c.file,
    rowCount: beds.length,
    summary: `${beds.length.toLocaleString('en-US')} schools · ${withBeds.toLocaleString('en-US')} BEDS numbers${exportDate ? ` · exported ${exportDate}` : ''}`,
    extract: { kind: 'lcgms_beds', exportDate, beds },
  };
}

// --- NYSED Community Schools list (PDF) --------------------------------------

const MIN_SED_CODES = 50;

async function parseCommunitySchools(file: RawFile, c: Ctx): Promise<SourceRecord | null> {
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(file.data.slice(), { verbosity: 0 });
    pages = (await extractText(pdf, { mergePages: false })).text as string[];
  } catch (err) {
    c.errors.push({ code: 'unreadable_file', file: c.file, message: `Could not read this PDF: ${(err as Error).message}` });
    return null;
  }
  const codes = new Set<string>();
  for (const page of pages) for (const m of page.matchAll(/(?<!\d)(\d{12})(?!\d)/g)) codes.add(m[1]!);
  if (codes.size < MIN_SED_CODES) {
    c.errors.push({
      code: 'no_sed_codes',
      file: c.file,
      message: `Found ${codes.size} SED codes — expected hundreds. Is this the "Self-reported Community Schools" list (and not a scanned image)?`,
    });
    return null;
  }
  const head = (pages[0] ?? '').slice(0, 400);
  const t = /(20\d{2})\s*[-–]\s*(20\d{2})/.exec(head);
  const f = /(\d{2,4})[-_](\d{2,4})\.pdf$/i.exec(c.file);
  const listYear = t ? `${t[1]}-${t[2]!.slice(2)}` : f ? `20${f[1]!.slice(-2)}-${f[2]!.slice(-2)}` : null;
  if (!/community\s+schools/i.test(head)) {
    c.warnings.push({ code: 'title_not_found', file: c.file, message: 'The PDF\'s first page doesn\'t mention "Community Schools" — double-check it is the NYSED list.' });
  }
  return {
    slot: 'community_schools',
    kind: 'community_schools',
    filename: c.file,
    rowCount: codes.size,
    summary: `${listYear ?? 'Unknown year'} list · ${codes.size.toLocaleString('en-US')} schools statewide`,
    extract: { kind: 'community_schools', listYear, codes: [...codes].sort() },
  };
}

// --- recognition -------------------------------------------------------------

const EXPECTED_KINDS =
  'Demographic Snapshot (.xlsx), Directory data (fall-YYYY … .xlsx), LCGMS geocoded CSV, LCGMS School Data export (.xls), or the NYSED Community Schools list (.pdf)';

export async function parseMasterSourceFile(file: RawFile): Promise<ParsedFile> {
  const c: Ctx = { file: file.name, errors: [], warnings: [] };
  const done = (record: SourceRecord | null): ParsedFile => ({
    file: file.name,
    record: c.errors.length > 0 ? null : record,
    errors: c.errors,
    warnings: c.warnings,
  });
  const ext = extOf(file.name);

  if (ext === '.pdf') return done(await parseCommunitySchools(file, c));

  const book = readBook(file, { csvEncoding: 'latin1' });
  if ('code' in book) {
    c.errors.push(book);
    return done(null);
  }

  const first = book.grid(book.sheetNames[0]!);
  const top = first.slice(0, 5).flat().map((v) => compact(v));
  if (top.includes(compact('ATS System Code'))) {
    // The geocoded file is the CSV; the School Data export is an .xls.
    if (book.kind === 'csv' || top.includes('latitude')) return done(parseLcgmsGeo(book, c));
    return done(parseLcgmsBeds(book, c));
  }
  // Directory data: DOE names every file fall-YYYY-….
  if (/fall[-_ ]?\d{4}/i.test(file.name) && findDirectorySheet(book)) return done(parseDirectory(book, c));

  // Snapshot: a school-level sheet (normally "School") with DBN, Total
  // Enrollment and Economic Need Index columns.
  const snapshotSheet = ['School', ...book.sheetNames.filter((s) => s !== 'School')].find((sheet) => {
    if (!book.sheetNames.includes(sheet)) return false;
    const grid = book.grid(sheet);
    const h = findRow(grid, (r) => r.some((v) => compact(v) === compact('Economic Need Index')));
    if (h == null) return false;
    const hdr = grid[h]!.map((v) => compact(v));
    return hdr.includes('dbn') && hdr.includes(compact('Total Enrollment'));
  });
  if (snapshotSheet) return done(parseSnapshot(book, snapshotSheet, c));

  // A directory file that lost its fall-YYYY name → parseDirectory explains.
  if (findDirectorySheet(book) && book.sheetNames.some((s) => s === 'Data' || s === 'Sheet1')) {
    return done(parseDirectory(book, c));
  }
  c.errors.push({
    code: 'not_recognized',
    file: file.name,
    message: 'This file is not one of the school master sources.',
    expected: EXPECTED_KINDS,
    found: book.kind === 'csv' ? 'a CSV without "ATS System Code" / "Latitude"' : `sheets: ${book.sheetNames.join(' · ')}`,
  });
  return done(null);
}
