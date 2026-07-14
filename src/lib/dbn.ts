/**
 * DBN handling — spec §3.6.
 *
 * - DBN is a string with leading zeros that MUST be preserved.
 * - `08X208` (PWC list) → remap to `84X208` in the master ("84" is the charter
 *   district code used by DOE for the same school).
 * - `03M299` (Maxine Greene HS) is a known unmatched closed school — surfaced
 *   in the data-quality report, not remapped.
 *
 * Canonical home is src/lib so both the ETL scripts and the Next.js admin
 * routes share one implementation.
 */

/** Charter-district remap. Add new pairs here if more surface in the future. */
const DBN_REMAP: ReadonlyMap<string, string> = new Map([
  ['08X208', '84X208'],
]);

/** Apply the canonical DBN normalization. Returns the resulting DBN. */
export function normalizeDbn(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  // Trim + strip a BOM that csv-parse might have left on the first cell.
  const trimmed = raw.replace(/^﻿/, '').trim();
  if (!trimmed) return null;
  // DBN strings can look like '08X208'; csv-parse with cast:false keeps them
  // as strings, so leading zeros are already preserved. No padding needed.
  const remapped = DBN_REMAP.get(trimmed);
  return remapped ?? trimmed;
}

/** Did a normalize step actually rewrite the DBN? Used for findings. */
export function wasDbnRemapped(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  return DBN_REMAP.has(raw.replace(/^﻿/, '').trim());
}

/** Closed-school + other known unmatched DBNs flagged for the DQ report. */
export const KNOWN_UNMATCHED_DBNS = new Set<string>(['03M299']);
