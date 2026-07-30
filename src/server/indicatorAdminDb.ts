/**
 * SQL queries used by the "School indicators" admin API routes.
 *
 * Mirrors src/server/adminDb.ts (the pwc_schools flow) but dataset-scoped:
 * one version stream per hosted dataset, discriminated by the `dataset`
 * column (see the school_indicator_dataset_* trio in schema.sql).
 *
 * `applyIndicatorVersion()` delete-and-replaces the dataset's indicator_id
 * slice of `school_indicator_values` — safe because nothing references that
 * table. Rows whose DBN isn't in `schools` stay in the version snapshot but
 * are skipped in the live table (pwc semantics): they go live automatically
 * on the next apply after a master refresh introduces the DBN.
 */

import { pool } from './db';
import type { VersionRow, VersionPayloadRow } from './adminDb';
import type { Payload } from '../admin/merge';
import { getIndicatorDataset } from '../admin/indicatorDatasets';
import { deriveIndicatorValues, type IndicatorVersionRow } from '../admin/indicatorTransform';
import { latestSchoolYear } from '../lib/schoolYear';

export async function getCurrentIndicatorVersionId(datasetId: string): Promise<number | null> {
  const r = await pool().query(
    `SELECT version_id FROM school_indicator_dataset_current WHERE dataset = $1`,
    [datasetId],
  );
  if (r.rows.length === 0) return null;
  return (r.rows[0] as { version_id: number }).version_id;
}

export async function listIndicatorVersions(datasetId: string): Promise<VersionRow[]> {
  const currentId = await getCurrentIndicatorVersionId(datasetId);
  const r = await pool().query(
    `SELECT version_id, created_at, created_by, source, notes, row_count, csv_url
       FROM school_indicator_dataset_versions
      WHERE dataset = $1
   ORDER BY version_id DESC`,
    [datasetId],
  );
  return r.rows.map((row) => ({
    version_id: row.version_id,
    created_at: row.created_at,
    created_by: row.created_by,
    source: row.source,
    notes: row.notes,
    row_count: row.row_count,
    csv_url: row.csv_url,
    is_current: row.version_id === currentId,
  }));
}

export async function getIndicatorVersionRows(versionId: number): Promise<VersionPayloadRow[]> {
  const r = await pool().query(
    `SELECT dbn, school_year, payload
       FROM school_indicator_dataset_version_rows
      WHERE version_id = $1
   ORDER BY dbn, school_year`,
    [versionId],
  );
  return r.rows.map((row) => ({
    dbn: row.dbn,
    school_year: row.school_year,
    payload: row.payload as Payload,
  }));
}

export async function updateIndicatorCsvUrl(versionId: number, csvUrl: string): Promise<void> {
  await pool().query(
    `UPDATE school_indicator_dataset_versions SET csv_url = $1 WHERE version_id = $2`,
    [csvUrl, versionId],
  );
}

export interface IndicatorDatasetStatus {
  datasetId: string;
  versionId: number | null;
  rowCount: number;
  updatedAt: string | null;
  /** Latest school_year present in the LIVE table for the dataset's indicators. */
  latestYearLoaded: string | null;
}

const emptyStatus = (datasetId: string): IndicatorDatasetStatus => ({
  datasetId,
  versionId: null,
  rowCount: 0,
  updatedAt: null,
  latestYearLoaded: null,
});

/**
 * One call for the whole admin page (and the per-dataset schema route).
 * Tolerates the versioning tables not existing yet (fresh deploy before
 * `etl:indicator-init` ran) so /admin keeps rendering — cards then show
 * "No data yet".
 */
export async function getIndicatorDatasetStatuses(
  datasetIds: readonly string[],
): Promise<Record<string, IndicatorDatasetStatus>> {
  const out: Record<string, IndicatorDatasetStatus> = {};
  for (const id of datasetIds) out[id] = emptyStatus(id);

  try {
    const versions = await pool().query(
      `SELECT c.dataset, c.version_id, c.updated_at, v.row_count
         FROM school_indicator_dataset_current c
         JOIN school_indicator_dataset_versions v ON v.version_id = c.version_id`,
    );
    for (const row of versions.rows) {
      const s = out[row.dataset];
      if (!s) continue;
      s.versionId = row.version_id;
      s.rowCount = row.row_count;
      s.updatedAt = row.updated_at;
    }
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') return out;
    throw err;
  }

  // Live-table year coverage → latest year per dataset. Sorted in JS via
  // latestSchoolYear so lexicographic year strings can't bite us.
  const years = await pool().query(
    `SELECT indicator_id, school_year
       FROM school_indicator_values
      WHERE value_num IS NOT NULL OR value_text IS NOT NULL
      GROUP BY indicator_id, school_year`,
  );
  const yearsByIndicator = new Map<string, string[]>();
  for (const row of years.rows) {
    const list = yearsByIndicator.get(row.indicator_id) ?? [];
    list.push(row.school_year);
    yearsByIndicator.set(row.indicator_id, list);
  }
  for (const id of datasetIds) {
    const cfg = getIndicatorDataset(id);
    if (!cfg) continue;
    const all = cfg.indicatorIds.flatMap((ind) => yearsByIndicator.get(ind) ?? []);
    out[id]!.latestYearLoaded = latestSchoolYear(all);
  }
  return out;
}

const CHUNK = 200;

/**
 * Atomic apply. Creates a new version, inserts its rows, swaps the dataset's
 * indicator slice of `school_indicator_values` from the shared derivation,
 * and moves the dataset's current pointer — all in one transaction.
 */
export async function applyIndicatorVersion(args: {
  datasetId: string;
  createdBy: string;
  source: string;
  notes: string | null;
  rows: IndicatorVersionRow[];
}): Promise<{ versionId: number; skippedDbns: string[] }> {
  const cfg = getIndicatorDataset(args.datasetId);
  if (!cfg) throw new Error(`applyIndicatorVersion: unknown dataset ${args.datasetId}`);

  const p = pool();
  await p.query('BEGIN');
  try {
    const verRes = await p.query(
      `INSERT INTO school_indicator_dataset_versions (dataset, created_by, source, notes, row_count, csv_url)
       VALUES ($1, $2, $3, $4, $5, NULL)
       RETURNING version_id`,
      [args.datasetId, args.createdBy, args.source, args.notes, args.rows.length],
    );
    const versionId = (verRes.rows[0] as { version_id: number }).version_id;

    for (let i = 0; i < args.rows.length; i += CHUNK) {
      const chunk = args.rows.slice(i, i + CHUNK);
      const tuples: string[] = [];
      const params: unknown[] = [];
      let n = 1;
      for (const r of chunk) {
        tuples.push(`($${n++}, $${n++}, $${n++}, $${n++}::jsonb)`);
        params.push(versionId, r.dbn, r.school_year, JSON.stringify(r.payload));
      }
      await p.query(
        `INSERT INTO school_indicator_dataset_version_rows (version_id, dbn, school_year, payload)
         VALUES ${tuples.join(', ')}`,
        params,
      );
    }

    // Live slice swap — derive rows for every indicator this dataset powers,
    // keep only DBNs the FK parent knows about.
    const derived = deriveIndicatorValues(args.rows, cfg);
    const uploadDbns = [...new Set(args.rows.map((r) => r.dbn))];
    const knownRes = await p.query(`SELECT dbn FROM schools WHERE dbn = ANY($1::text[])`, [uploadDbns]);
    const known = new Set<string>((knownRes.rows as Array<{ dbn: string }>).map((r) => r.dbn));
    const skippedDbns = uploadDbns.filter((d) => !known.has(d)).sort();
    const live = derived.filter((d) => known.has(d.dbn));

    await p.query(`DELETE FROM school_indicator_values WHERE indicator_id = ANY($1::text[])`, [
      [...cfg.indicatorIds],
    ]);

    // 7 params/row → 200-row chunks stay far under Postgres limits.
    for (let i = 0; i < live.length; i += CHUNK) {
      const chunk = live.slice(i, i + CHUNK);
      const tuples: string[] = [];
      const params: unknown[] = [];
      let n = 1;
      for (const d of chunk) {
        tuples.push(`($${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++})`);
        params.push(d.dbn, d.school_year, d.indicator_id, d.value_num, d.value_text, d.label, d.source_year);
      }
      await p.query(
        `INSERT INTO school_indicator_values (dbn, school_year, indicator_id, value_num, value_text, label, source_year)
         VALUES ${tuples.join(', ')}`,
        params,
      );
    }

    await p.query(
      `INSERT INTO school_indicator_dataset_current (dataset, version_id, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (dataset) DO UPDATE SET version_id = EXCLUDED.version_id, updated_at = EXCLUDED.updated_at`,
      [args.datasetId, versionId],
    );
    await p.query('COMMIT');
    return { versionId, skippedDbns };
  } catch (err) {
    await p.query('ROLLBACK');
    throw err;
  }
}
