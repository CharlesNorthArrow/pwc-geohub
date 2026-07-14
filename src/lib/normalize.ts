/**
 * Centralized value normalization — spec §3.6 + §11.1.
 *
 * Every redaction sentinel and quirky string lives here so components never
 * need to know about them.
 *
 * Canonical home is src/lib so both the ETL scripts and the Next.js admin
 * routes share one implementation.
 */

/** String values that should be coerced to NULL in numeric columns. */
const NUMERIC_NULL_SENTINELS = new Set<string>([
  '',
  'R',         // suspensions: redaction for small cells
  'r',
  's',         // alt redaction sentinel sometimes seen
  'S',
  'N/A',
  'n/a',
  'NA',
  'na',
  'null',
  'NULL',
  'Above 95%', // pct_poverty, economic_need_index
  'above 95%',
  'Data not available',
  'Data suppressed',
]);

/** Coerce a CSV cell to a number or null, applying sentinel rules. */
export function toNullableNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (NUMERIC_NULL_SENTINELS.has(s)) return null;
  // Allow values like "58.21", "67.0", "1,234" — strip thousands sep.
  const cleaned = s.replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Coerce to integer (round on parse); null for sentinels. */
export function toNullableInt(raw: unknown): number | null {
  const n = toNullableNumber(raw);
  if (n == null) return null;
  return Math.round(n);
}

/** Strict 0/1/true/false → boolean; everything else → null. */
export function toNullableBool(raw: unknown): boolean | null {
  if (raw == null) return null;
  if (typeof raw === 'boolean') return raw;
  const s = String(raw).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 't' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'f' || s === 'no') return false;
  if (s === '' || NUMERIC_NULL_SENTINELS.has(String(raw).trim())) return null;
  return null;
}

/** Pass-through for label text, but normalize blanks + sentinels to null. */
export function toNullableText(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (s === 'Data not available' || s === 'Data suppressed') return null;
  return s;
}

/** Detect whether a value would have been nulled by sentinel rules. */
export function isSentinelNull(raw: unknown): boolean {
  if (raw == null) return false;
  const s = String(raw).trim();
  return NUMERIC_NULL_SENTINELS.has(s);
}
