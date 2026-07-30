/**
 * Shared preview/apply pipeline for the "School indicators" upload routes:
 * re-validate decisions → normalize → DBN remap → merge → data-quality
 * warnings. Both routes run this end-to-end (preview is never a trusted
 * gate), mirroring the school-master pattern with indicator-specific checks:
 *
 *  - Unknown DBNs never block: they stay in the version snapshot and are
 *    skipped in the live table at apply (pwc semantics).
 *  - 08X208→84X208 remap applied on upload (ETL parity).
 *  - Sentinel-nulled count: redacted values ("R", "Above 95%", …) in the
 *    indicators' value columns become NULL — surfaced so the admin isn't
 *    surprised by blank map points.
 *  - New-years detection: school_years present in the upload but absent from
 *    the current version — these appear on the dashboard after apply.
 *  - Graduation: rows may arrive keyed by cohort_year only; a school_year
 *    column was synthesized at upload time (session.meta carries the counts).
 */

import {
  applyDecisions,
  validateDecisions,
  type ReconciliationDecisions,
} from '../admin/columnReconciliation';
import { mergeRows, type MergeResult, type NormalizedRow } from '../admin/merge';
import { countSentinelNulls } from '../admin/indicatorTransform';
import type { IndicatorDatasetConfig } from '../admin/indicatorDatasets';
import { normalizeDbn, wasDbnRemapped } from '../lib/dbn';
import { cohortYearToSchoolYear, sortSchoolYears } from '../lib/schoolYear';
import { findUnknownDbns } from './adminDb';
import { getCurrentIndicatorVersionId, getIndicatorVersionRows } from './indicatorAdminDb';
import type { UploadSession } from './adminRoutes';

export interface IndicatorWarnings {
  unknownDbns: string[];
  unknownDbnCount: number;
  retainedFromCurrent: number;
  remappedDbnCount: number;
  duplicateRowCount: number;
  sentinelNulledCount: number;
  /** School years in the upload that the current version doesn't have. */
  newYears: string[];
  cohortDerivedCount?: number;
  cohortMismatchCount?: number;
}

export interface IndicatorMergeOutcome {
  merge: MergeResult;
  warnings: IndicatorWarnings;
  currentVersionId: number | null;
}

export type IndicatorMergeResult =
  | { ok: true; outcome: IndicatorMergeOutcome }
  | { ok: false; status: number; body: Record<string, unknown> };

export async function buildIndicatorMerge(
  session: UploadSession,
  decisions: ReconciliationDecisions,
  cfg: IndicatorDatasetConfig,
): Promise<IndicatorMergeResult> {
  const v = validateDecisions(session.classification, decisions, cfg.fields);
  if (!v.ok) {
    return { ok: false, status: 422, body: { error: 'invalid_decisions', errors: v.errors } };
  }

  const normalized = applyDecisions(session.rawRows, session.classification, decisions, cfg.fields);

  // DBN remap (ETL parity) — before merge so version rows key on the
  // canonical DBN.
  let remappedDbnCount = 0;
  for (const row of normalized) {
    if (wasDbnRemapped(row.DBN)) remappedDbnCount++;
    row.DBN = normalizeDbn(row.DBN);
  }

  // Graduation safety net: the upload route synthesizes school_year from
  // cohort_year at parse time, but a mapping decision could still leave the
  // key blank (e.g. cohort column arrived under an unmatched header and was
  // mapped in reconciliation). Backfill from the mapped cohort_year.
  if (cfg.yearMode === 'cohort_year') {
    for (const row of normalized) {
      if (!row.school_year && row.cohort_year) {
        row.school_year = cohortYearToSchoolYear(row.cohort_year);
      }
    }
  }

  const sentinelNulledCount = countSentinelNulls(normalized, cfg);
  const duplicateRowCount = countDuplicateKeys(normalized);

  const currentVersionId = await getCurrentIndicatorVersionId(cfg.id);
  const currentRows = currentVersionId == null ? [] : await getIndicatorVersionRows(currentVersionId);
  const merge = mergeRows(currentRows, normalized, cfg.fields);

  const unknownDbns = await findUnknownDbns(
    [...new Set(merge.newVersionRows.map((r) => r.dbn))],
  );

  const currentYears = new Set(currentRows.map((r) => r.school_year));
  const newYears = sortSchoolYears([
    ...new Set(
      normalized
        .map((r) => r.school_year)
        .filter((y): y is string => Boolean(y) && !currentYears.has(y as string)),
    ),
  ]);

  return {
    ok: true,
    outcome: {
      merge,
      currentVersionId,
      warnings: {
        unknownDbns,
        unknownDbnCount: unknownDbns.length,
        retainedFromCurrent: merge.retained.length,
        remappedDbnCount,
        duplicateRowCount,
        sentinelNulledCount,
        newYears,
        ...(cfg.yearMode === 'cohort_year'
          ? {
              cohortDerivedCount: session.meta?.cohortDerivedCount ?? 0,
              cohortMismatchCount: session.meta?.cohortMismatchCount ?? 0,
            }
          : {}),
      },
    },
  };
}

function countDuplicateKeys(rows: ReadonlyArray<NormalizedRow>): number {
  const seen = new Set<string>();
  let dupes = 0;
  for (const r of rows) {
    if (!r.DBN || !r.school_year) continue;
    const k = `${r.DBN}|${r.school_year}`;
    if (seen.has(k)) dupes++;
    else seen.add(k);
  }
  return dupes;
}
