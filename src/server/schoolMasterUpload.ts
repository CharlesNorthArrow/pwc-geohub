/**
 * Shared preview/apply pipeline for the "School data master" upload routes:
 * re-validate decisions → normalize → DBN remap → merge → data-quality
 * warnings. Both routes run this end-to-end (preview is never a trusted
 * gate), mirroring the pwc pattern but with master-specific checks:
 *
 *  - No unknown-DBN block: `schools` IS the parent table, new DBNs are the
 *    point of an annual refresh.
 *  - 08X208→84X208 remap applied on upload (ETL parity — see MASTER_FIELDS
 *    DBN description).
 *  - Warnings (all non-blocking): duplicate (DBN, year) rows in the upload
 *    (last wins), schools left without coordinates (unplottable), fraction
 *    columns carrying 0–100-looking values (expected 0–1).
 */

import {
  applyDecisions,
  validateDecisions,
  type ReconciliationDecisions,
} from '../admin/columnReconciliation';
import { mergeRows, type MergeResult, type NormalizedRow } from '../admin/merge';
import { MASTER_FIELDS, MASTER_FRACTION_FIELDS } from '../admin/schoolMasterSchema';
import { deriveSchoolIdentities } from '../admin/schoolMasterTransform';
import { normalizeDbn, wasDbnRemapped } from '../lib/dbn';
import { getCurrentMasterVersionId, getMasterVersionRows } from './schoolMasterAdminDb';
import type { UploadSession } from './adminRoutes';

export interface MasterWarnings {
  /** Kept for PreviewResponse shape-compat with the pwc flow (always empty). */
  unknownDbns: string[];
  unknownDbnCount: number;
  retainedFromCurrent: number;
  remappedDbnCount: number;
  duplicateRowCount: number;
  unplottableCount: number;
  unplottableSample: string[];
  fractionSuspectCount: number;
  fractionSuspectSample: string[];
}

export interface MasterMergeOutcome {
  merge: MergeResult;
  warnings: MasterWarnings;
  currentVersionId: number | null;
}

export type MasterMergeResult =
  | { ok: true; outcome: MasterMergeOutcome }
  | { ok: false; status: number; body: Record<string, unknown> };

export async function buildMasterMerge(
  session: UploadSession,
  decisions: ReconciliationDecisions,
): Promise<MasterMergeResult> {
  const v = validateDecisions(session.classification, decisions, MASTER_FIELDS);
  if (!v.ok) {
    return { ok: false, status: 422, body: { error: 'invalid_decisions', errors: v.errors } };
  }

  const normalized = applyDecisions(session.rawRows, session.classification, decisions, MASTER_FIELDS);

  // DBN remap (ETL parity) — before merge so version rows key on the
  // canonical DBN.
  let remappedDbnCount = 0;
  for (const row of normalized) {
    if (wasDbnRemapped(row.DBN)) remappedDbnCount++;
    row.DBN = normalizeDbn(row.DBN);
  }

  const duplicateRowCount = countDuplicateKeys(normalized);

  const currentVersionId = await getCurrentMasterVersionId();
  const currentRows = currentVersionId == null ? [] : await getMasterVersionRows(currentVersionId);
  const merge = mergeRows(currentRows, normalized, MASTER_FIELDS);

  // Unplottable = identity derivation of the WHOLE new version yields no
  // coords for that DBN (includes pre-existing coordinate gaps, ~5% of the
  // master historically — informational, not a regression signal by itself).
  const unplottable = deriveSchoolIdentities(merge.newVersionRows)
    .filter((s) => s.geom_ewkt == null)
    .map((s) => s.dbn);

  // Fraction sanity — only rows the upload actually changes/adds.
  const fractionSuspect: string[] = [];
  for (const r of [...merge.added, ...merge.updated.map((u) => ({ dbn: u.dbn, school_year: u.school_year, payload: u.after }))]) {
    const bad = MASTER_FRACTION_FIELDS.some((f) => {
      const val = r.payload[f];
      return typeof val === 'number' && val > 1.5;
    });
    if (bad) fractionSuspect.push(`${r.dbn}/${r.school_year}`);
  }

  return {
    ok: true,
    outcome: {
      merge,
      currentVersionId,
      warnings: {
        unknownDbns: [],
        unknownDbnCount: 0,
        retainedFromCurrent: merge.retained.length,
        remappedDbnCount,
        duplicateRowCount,
        unplottableCount: unplottable.length,
        unplottableSample: unplottable.slice(0, 25),
        fractionSuspectCount: fractionSuspect.length,
        fractionSuspectSample: fractionSuspect.slice(0, 25),
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
