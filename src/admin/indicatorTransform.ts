/**
 * School-indicator dataset → live-table derivation, shared by the ETL loader
 * (scripts/etl/11-load-school-indicators.ts) and the Admin Panel apply path
 * (src/server/indicatorAdminDb.ts). Pure functions — no DB access.
 *
 * Semantics locked to the original ETL:
 *  - DBN remap (08X208 → 84X208) + BOM/trim normalization.
 *  - Graduation: cohort_year → school_year via cohortYearToSchoolYear; the raw
 *    cohort is preserved in `source_year`. All other datasets: source_year =
 *    school_year.
 *  - Numeric sentinel strings ("R", "Above 95%", "Data suppressed", …) → null
 *    (via the shared coerceValue → toNullableNumber path).
 *  - Labels & categorical text: "Data not available"/"Data suppressed" → null
 *    at derive time (toNullableText) — version payloads keep the raw text so
 *    CSV downloads round-trip.
 */

import { normalizeDbn, wasDbnRemapped } from '../lib/dbn';
import { isSentinelNull, toNullableText } from '../lib/normalize';
import { cohortYearToSchoolYear } from '../lib/schoolYear';
import { coerceRow, type NormalizedRow, type Payload, type PayloadValue } from './merge';
import { hostedSourceOf, type IndicatorDatasetConfig } from './indicatorDatasets';

export interface IndicatorVersionRow {
  dbn: string;
  school_year: string;
  payload: Payload; // typed values, keys = the config's data fields
}

const normalizeHeaderName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Graduation only — ensure a `school_year` column exists BEFORE column
 * classification, otherwise the missing-key hard block refuses cohort-keyed
 * files (the DOE download is cohort-grained). When school_year is absent but
 * a cohort_year-like header is present, a derived school_year column is
 * appended (cohort Y → "(Y+3)-(Y+4)"). When both are present the provided
 * school_year wins, but disagreements with the cohort mapping are counted.
 */
export function synthesizeGraduationSchoolYear(
  headers: string[],
  rawRows: ReadonlyArray<Record<string, string>>,
): {
  headers: string[];
  rawRows: Array<Record<string, string>>;
  derivedCount: number;
  mismatchCount: number;
} {
  const cohortHeader = headers.find((h) => normalizeHeaderName(h) === 'cohortyear');
  const schoolYearHeader = headers.find((h) => normalizeHeaderName(h) === 'schoolyear');

  if (schoolYearHeader || !cohortHeader) {
    let mismatchCount = 0;
    if (schoolYearHeader && cohortHeader) {
      for (const r of rawRows) {
        const provided = (r[schoolYearHeader] ?? '').trim();
        const derived = cohortYearToSchoolYear(r[cohortHeader]);
        if (provided && derived && provided !== derived) mismatchCount++;
      }
    }
    return { headers, rawRows: [...rawRows], derivedCount: 0, mismatchCount };
  }

  let derivedCount = 0;
  const out = rawRows.map((r) => {
    const derived = cohortYearToSchoolYear(r[cohortHeader]);
    if (derived) derivedCount++;
    return { ...r, school_year: derived ?? '' };
  });
  return { headers: [...headers, 'school_year'], rawRows: out, derivedCount, mismatchCount: 0 };
}

/**
 * Raw CSV rows (headers = cfg.fields ids) → typed version rows via the shared
 * schema coercion, with the DBN remap applied. Duplicate (DBN, school_year)
 * keys — including remap collisions — dedupe last-wins, matching mergeRows.
 * Used by the ETL loader and the version-1 seed; the upload routes reach the
 * same coercion through applyDecisions + mergeRows.
 */
export function indicatorCsvToVersionRows(
  rawRows: ReadonlyArray<Record<string, string>>,
  cfg: IndicatorDatasetConfig,
): { rows: IndicatorVersionRow[]; remapCount: number } {
  let remapCount = 0;
  const byKey = new Map<string, IndicatorVersionRow>();
  const source =
    cfg.yearMode === 'cohort_year'
      ? synthesizeGraduationSchoolYear(
          rawRows.length > 0 ? Object.keys(rawRows[0]!) : [],
          rawRows,
        ).rawRows
      : rawRows;
  for (const raw of source) {
    if (wasDbnRemapped(raw.DBN)) remapCount++;
    const normalized: NormalizedRow = {};
    for (const f of cfg.fields) {
      const v = raw[f.id];
      normalized[f.id] = v == null || v === '' ? null : v;
    }
    normalized.DBN = normalizeDbn(normalized.DBN);
    const coerced = coerceRow(normalized, cfg.fields);
    if (!coerced) continue;
    byKey.set(`${coerced.dbn}|${coerced.school_year}`, coerced);
  }
  return { rows: [...byKey.values()], remapCount };
}

export interface DerivedIndicatorValue {
  dbn: string;
  school_year: string;
  indicator_id: string;
  value_num: number | null;
  value_text: string | null;
  label: string | null;
  source_year: string | null;
}

const asNumber = (v: PayloadValue | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const asText = (v: PayloadValue | undefined): string | null =>
  v == null ? null : toNullableText(String(v));

/**
 * Version rows → long-format `school_indicator_values` candidates for EVERY
 * indicator the dataset powers. FK filtering (unknown DBNs) happens at the
 * write site, not here.
 */
export function deriveIndicatorValues(
  rows: readonly IndicatorVersionRow[],
  cfg: IndicatorDatasetConfig,
): DerivedIndicatorValue[] {
  const out: DerivedIndicatorValue[] = [];
  for (const indicatorId of cfg.indicatorIds) {
    const source = hostedSourceOf(indicatorId);
    for (const r of rows) {
      if (!r.school_year) continue;
      const sourceYear =
        cfg.yearMode === 'cohort_year'
          ? r.payload.cohort_year == null
            ? null
            : String(r.payload.cohort_year)
          : r.school_year;
      out.push({
        dbn: r.dbn,
        school_year: r.school_year,
        indicator_id: indicatorId,
        value_num: asNumber(r.payload[source.value_field]),
        value_text: source.categorical_field ? asText(r.payload[source.categorical_field]) : null,
        label: asText(r.payload[source.label_field]),
        source_year: sourceYear,
      });
    }
  }
  return out;
}

/**
 * Count cells in the dataset's indicator VALUE columns that hold a redaction
 * sentinel ("R", "Above 95%", "Data suppressed", …). Must run on the raw
 * (pre-coercion) strings — after coercion the sentinel is indistinguishable
 * from a genuinely blank cell.
 */
export function countSentinelNulls(
  normalizedRows: ReadonlyArray<NormalizedRow>,
  cfg: IndicatorDatasetConfig,
): number {
  const valueFields = cfg.indicatorIds.map((id) => hostedSourceOf(id).value_field);
  let count = 0;
  for (const row of normalizedRows) {
    for (const f of valueFields) {
      const raw = row[f];
      if (raw != null && raw !== '' && isSentinelNull(raw)) count++;
    }
  }
  return count;
}
