/**
 * Helper for recording data-quality findings during ETL.
 * Writes upsert-style into `data_quality_findings` keyed by (run, category, subject).
 */

import { db, runId } from './db.js';

export type FindingCategory =
  | 'unmatched_dbn'
  | 'null_coords'
  | 'year_coverage'
  | 'remap_applied'
  | 'sentinel_nulled'
  | 'anchor_healing_overlap'
  | 'crosswalk_unmatched'
  | 'indicator_loaded'
  | 'registry_only_add'
  | 'ingestion_summary';

export async function recordFinding(
  category: FindingCategory,
  subject: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO data_quality_findings (run_id, category, subject, details)
    VALUES (${runId()}, ${category}, ${subject}, ${JSON.stringify(details)}::jsonb)
    ON CONFLICT (run_id, category, subject) DO UPDATE
      SET details = EXCLUDED.details
  `;
}

export async function clearFindingsForRun(): Promise<void> {
  const sql = db();
  await sql`DELETE FROM data_quality_findings WHERE run_id = ${runId()}`;
}
