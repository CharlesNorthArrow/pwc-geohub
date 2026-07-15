/**
 * schools_master → live-table derivation, shared by the ETL loader
 * (scripts/etl/10-load-schools-master.ts) and the Admin Panel apply path
 * (src/server/schoolMasterAdminDb.ts). Pure functions — no DB access.
 *
 * Semantics locked to the original ETL:
 *  - One `schools` identity record per DBN, sourced from the LATEST year that
 *    has coordinates (fallback: latest year overall). `geom` as EWKT point.
 *  - One `schools_year` record per (DBN, school_year); count columns are
 *    rounded to integers (the live columns are INTEGER).
 */

import { schoolYearEnd } from '../lib/schoolYear';
import { normalizeDbn, wasDbnRemapped } from '../lib/dbn';
import { coerceRow, type NormalizedRow, type Payload, type PayloadValue } from './merge';
import { MASTER_FIELDS } from './schoolMasterSchema';

export interface MasterVersionRow {
  dbn: string;
  school_year: string;
  payload: Payload; // typed values, keys = MASTER_DATA_FIELDS
}

/**
 * Raw CSV rows (headers = MASTER_FIELDS ids) → typed version rows via the
 * shared schema coercion, with the DBN remap applied. Duplicate (DBN, year)
 * keys — including remap collisions — dedupe last-wins, matching mergeRows.
 * Used by the ETL loader and the version-1 seed; the upload routes reach the
 * same coercion through applyDecisions + mergeRows.
 */
export function masterCsvToVersionRows(rawRows: ReadonlyArray<Record<string, string>>): {
  rows: MasterVersionRow[];
  remapCount: number;
} {
  let remapCount = 0;
  const byKey = new Map<string, MasterVersionRow>();
  for (const raw of rawRows) {
    if (wasDbnRemapped(raw.DBN)) remapCount++;
    const normalized: NormalizedRow = {};
    for (const f of MASTER_FIELDS) {
      const v = raw[f.id];
      normalized[f.id] = v == null || v === '' ? null : v;
    }
    normalized.DBN = normalizeDbn(normalized.DBN);
    const coerced = coerceRow(normalized, MASTER_FIELDS);
    if (!coerced) continue;
    byKey.set(`${coerced.dbn}|${coerced.school_year}`, coerced);
  }
  return { rows: [...byKey.values()], remapCount };
}

export interface SchoolIdentityRecord {
  dbn: string;
  school_name: string | null;
  borough: string | null;
  address: string | null;
  managed_by: string | null;
  location_category: string | null;
  location_type: string | null;
  grades: string | null;
  administrative_district_name: string | null;
  beds_number: string | null;
  latitude: number | null;
  longitude: number | null;
  /** `SRID=4326;POINT(lon lat)` or null when unplottable. */
  geom_ewkt: string | null;
  identity_source_year: string | null;
}

/** Column order matches the `schools_year` INSERT in both write paths. */
export const SCHOOLS_YEAR_COLUMNS = [
  'total_enrollment',
  'n_students_with_disabilities', 'pct_students_with_disabilities',
  'n_english_language_learners', 'pct_english_language_learners',
  'n_poverty', 'pct_poverty', 'economic_need_index',
  'n_asian', 'pct_asian', 'n_black', 'pct_black',
  'n_hispanic', 'pct_hispanic', 'n_white', 'pct_white',
  'n_multi_racial', 'pct_multi_racial',
  'n_female', 'pct_female', 'n_male', 'pct_male',
] as const;

/** Live columns typed INTEGER — values are rounded on write (ETL parity). */
const INTEGER_COLUMNS = new Set<string>(
  SCHOOLS_YEAR_COLUMNS.filter((c) => c === 'total_enrollment' || c.startsWith('n_')),
);

export interface SchoolYearRecord {
  dbn: string;
  school_year: string;
  /** Values aligned with SCHOOLS_YEAR_COLUMNS. */
  values: Array<number | null>;
}

function asText(v: PayloadValue | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function asNumber(v: PayloadValue | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function groupByDbn(rows: readonly MasterVersionRow[]): Map<string, MasterVersionRow[]> {
  const perDbn = new Map<string, MasterVersionRow[]>();
  for (const r of rows) {
    if (!perDbn.has(r.dbn)) perDbn.set(r.dbn, []);
    perDbn.get(r.dbn)!.push(r);
  }
  return perDbn;
}

/** One identity record per DBN, from the latest year with coordinates. */
export function deriveSchoolIdentities(rows: readonly MasterVersionRow[]): SchoolIdentityRecord[] {
  const out: SchoolIdentityRecord[] = [];
  for (const [dbn, rs] of groupByDbn(rows)) {
    const sorted = [...rs].sort(
      (a, b) => (schoolYearEnd(b.school_year) ?? 0) - (schoolYearEnd(a.school_year) ?? 0),
    );
    const withCoords = sorted.find(
      (r) => asNumber(r.payload.latitude) != null && asNumber(r.payload.longitude) != null,
    );
    const identity = withCoords ?? sorted[0]!;
    const lat = asNumber(identity.payload.latitude);
    const lon = asNumber(identity.payload.longitude);
    out.push({
      dbn,
      school_name: asText(identity.payload.school_name),
      borough: asText(identity.payload.borough),
      address: asText(identity.payload.address),
      managed_by: asText(identity.payload.managed_by),
      location_category: asText(identity.payload.location_category),
      location_type: asText(identity.payload.location_type),
      grades: asText(identity.payload.grades),
      administrative_district_name: asText(identity.payload.administrative_district_name),
      beds_number: asText(identity.payload.beds_number),
      latitude: lat,
      longitude: lon,
      geom_ewkt: lat == null || lon == null ? null : `SRID=4326;POINT(${lon} ${lat})`,
      identity_source_year: identity.school_year || null,
    });
  }
  return out;
}

/** One schools_year record per (DBN, school_year), counts rounded. */
export function deriveSchoolYearRecords(rows: readonly MasterVersionRow[]): SchoolYearRecord[] {
  const out: SchoolYearRecord[] = [];
  for (const r of rows) {
    if (!r.school_year) continue;
    out.push({
      dbn: r.dbn,
      school_year: r.school_year,
      values: SCHOOLS_YEAR_COLUMNS.map((c) => {
        const n = asNumber(r.payload[c]);
        if (n == null) return null;
        return INTEGER_COLUMNS.has(c) ? Math.round(n) : n;
      }),
    });
  }
  return out;
}

/**
 * Rollback row set: every CURRENT row, with its payload replaced by the
 * target version's where the key exists there; target-only keys (shouldn't
 * occur — version keys only grow) are appended. Keeps the no-delete
 * invariant: a school added after the target version stays in the version
 * history AND consistent with the live upserted tables.
 */
export function applyRollbackOverlay(
  current: readonly MasterVersionRow[],
  target: readonly MasterVersionRow[],
): MasterVersionRow[] {
  const key = (r: MasterVersionRow): string => `${r.dbn}|${r.school_year}`;
  const targetByKey = new Map(target.map((r) => [key(r), r]));
  const seen = new Set<string>();
  const out: MasterVersionRow[] = [];
  for (const c of current) {
    const k = key(c);
    seen.add(k);
    const t = targetByKey.get(k);
    out.push(t ? { dbn: c.dbn, school_year: c.school_year, payload: t.payload } : c);
  }
  for (const t of target) {
    if (!seen.has(key(t))) out.push(t);
  }
  return out;
}
