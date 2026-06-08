/**
 * Grade-level normalization — spec §6 (filter cascade extension).
 *
 * Two sources resolve to the same canonical token set:
 *   - `schools.grades` (master, every NYC school): comma-separated explicit
 *     grades, e.g. "PK,0K,01,02,03,04,05".
 *   - `pwc_school_program.grade_served` (PWC-only): band labels like "K-5",
 *     "PreK-5", "6-8", "9-12". Some rows arrive Excel-mangled into ISO dates
 *     because Excel autocoerces "9-12" → "2025-09-12 00:00:00".
 *
 * Canonical tokens follow NYC DOE convention: PK + K + 1..12. "0K"/"PreK"/
 * "3K"/"Prek" normalize away at the data layer so components never see the
 * raw forms.
 */
export type CanonicalGrade =
  | 'PK' | 'K'
  | '1' | '2' | '3' | '4' | '5' | '6'
  | '7' | '8' | '9' | '10' | '11' | '12';

export const CANONICAL_GRADES: readonly CanonicalGrade[] = [
  'PK', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
] as const;

const ORDINAL = new Map<CanonicalGrade, number>(
  CANONICAL_GRADES.map((g, i) => [g, i]),
);

/** Single-token rewriter. Returns null when the token is a known non-grade
 *  (SE / ungraded / unspecified) or anything we can't confidently map.
 *  Callers dedupe + sort. */
function rewriteToken(raw: string): CanonicalGrade | null {
  const t = raw.trim().toUpperCase();
  if (t.length === 0) return null;
  if (t === 'PK' || t === 'PRE-K' || t === 'PREK' || t === '3K') return 'PK';
  if (t === 'K' || t === '0K' || t === 'KG') return 'K';
  // "01".."12" → "1".."12"
  const n = Number.parseInt(t, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 12 && /^0*\d{1,2}$/.test(t)) {
    return String(n) as CanonicalGrade;
  }
  return null;
}

function sortByOrdinal(set: Set<CanonicalGrade>): CanonicalGrade[] {
  return [...set].sort((a, b) => (ORDINAL.get(a) ?? 0) - (ORDINAL.get(b) ?? 0));
}

/** `schools.grades` → canonical tokens. */
export function normalizeMasterGrades(csv: string | null): CanonicalGrade[] {
  if (!csv) return [];
  const out = new Set<CanonicalGrade>();
  for (const piece of csv.split(',')) {
    const g = rewriteToken(piece);
    if (g) out.add(g);
  }
  return sortByOrdinal(out);
}

/** Excel-mangled date sentinel — `"2025-09-12 0:00:00"` meant `"9-12"`. */
const EXCEL_DATE_RE = /^\d{4}-(\d{2})-(\d{2})(?:[ T]\d{1,2}:\d{2}(?::\d{1,2})?)?$/;

interface BandEndpoints {
  lo: CanonicalGrade;
  hi: CanonicalGrade;
}

function parseBand(raw: string): BandEndpoints | null {
  const s = raw.trim();
  if (s.length === 0) return null;

  // Excel autocoerced "M-D" into an ISO date. Read month-as-lo + day-as-hi.
  // This is unambiguous because real grade bands always have lo ≤ hi and both
  // fall inside 1..12.
  const m = EXCEL_DATE_RE.exec(s);
  if (m) {
    const monStr = m[1]!;
    const dayStr = m[2]!;
    const lo = rewriteToken(monStr);
    const hi = rewriteToken(dayStr);
    if (lo && hi) return { lo, hi };
  }

  // Plain band: "<lo>-<hi>" or "<lo> - <hi>".
  const dash = s.indexOf('-');
  if (dash <= 0) return null;
  const loRaw = s.slice(0, dash);
  const hiRaw = s.slice(dash + 1);
  const lo = rewriteToken(loRaw);
  const hi = rewriteToken(hiRaw);
  if (!lo || !hi) return null;
  return { lo, hi };
}

/** `pwc_school_program.grade_served` → canonical tokens. */
export function normalizeGradeServed(band: string | null): CanonicalGrade[] {
  if (!band) return [];
  const ends = parseBand(band);
  if (!ends) return [];
  const loIdx = ORDINAL.get(ends.lo);
  const hiIdx = ORDINAL.get(ends.hi);
  if (loIdx == null || hiIdx == null) return [];
  const a = Math.min(loIdx, hiIdx);
  const b = Math.max(loIdx, hiIdx);
  const out: CanonicalGrade[] = [];
  for (let i = a; i <= b; i++) {
    const g = CANONICAL_GRADES[i];
    if (g) out.push(g);
  }
  return out;
}

/** Returns `true` when a string looks like the Excel-mangled date form — used
 *  by the ETL data-quality report so the gotcha is visible. */
export function looksLikeExcelMangledBand(raw: string | null): boolean {
  if (!raw) return false;
  return EXCEL_DATE_RE.test(raw.trim());
}
