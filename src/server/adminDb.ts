/**
 * SQL queries used by the admin API routes.
 *
 * All writes go through `applyMergedVersion()` — one transaction, one
 * boundary. There's no "partial apply" path: success means version inserted,
 * rows inserted, csv_url written, pwc_school_program swapped, current
 * pointer moved. Failure means none of that. Postgres MVCC keeps readers
 * coherent.
 */

import { pool } from './db';
import { PWC_DATA_FIELDS } from '../admin/pwcSchema';
import type { Payload } from '../admin/merge';

export interface VersionRow {
  version_id: number;
  created_at: string;
  created_by: string;
  source: string;
  notes: string | null;
  row_count: number;
  csv_url: string | null;
  is_current: boolean;
}

export interface VersionPayloadRow {
  dbn: string;
  school_year: string;
  payload: Payload;
}

export async function getCurrentVersionId(): Promise<number | null> {
  const r = await pool().query(`SELECT version_id FROM pwc_program_current WHERE pin = 1`);
  if (r.rows.length === 0) return null;
  return (r.rows[0] as { version_id: number }).version_id;
}

export async function listVersions(): Promise<VersionRow[]> {
  const currentId = await getCurrentVersionId();
  const r = await pool().query(
    `SELECT version_id, created_at, created_by, source, notes, row_count, csv_url
       FROM pwc_program_versions
   ORDER BY version_id DESC`,
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

export async function getVersionRows(versionId: number): Promise<VersionPayloadRow[]> {
  const r = await pool().query(
    `SELECT dbn, school_year, payload
       FROM pwc_program_version_rows
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

export async function getActiveSchema(): Promise<{
  versionId: number | null;
  rowCount: number;
  updatedAt: string | null;
}> {
  const currentId = await getCurrentVersionId();
  if (currentId == null) return { versionId: null, rowCount: 0, updatedAt: null };
  const r = await pool().query(
    `SELECT v.row_count, c.updated_at
       FROM pwc_program_current c
       JOIN pwc_program_versions v ON v.version_id = c.version_id
      WHERE c.pin = 1`,
  );
  if (r.rows.length === 0) return { versionId: currentId, rowCount: 0, updatedAt: null };
  return {
    versionId: currentId,
    rowCount: r.rows[0].row_count,
    updatedAt: r.rows[0].updated_at,
  };
}

/**
 * Atomic apply. Creates a new version, inserts its rows, replaces the live
 * read view, and moves the current pointer — all in one transaction. Either
 * the whole thing lands or none of it does.
 *
 * `csvUrl` is set later (after the tx) by the upload-blob path; we pass null
 * here and `updateCsvUrl()` patches it after the Blob PUT succeeds.
 */
export async function applyMergedVersion(args: {
  createdBy: string;
  source: string;
  notes: string | null;
  rows: VersionPayloadRow[];
}): Promise<{ versionId: number }> {
  const p = pool();
  await p.query('BEGIN');
  try {
    const verRes = await p.query(
      `INSERT INTO pwc_program_versions (created_by, source, notes, row_count, csv_url)
       VALUES ($1, $2, $3, $4, NULL)
       RETURNING version_id`,
      [args.createdBy, args.source, args.notes, args.rows.length],
    );
    const versionId = (verRes.rows[0] as { version_id: number }).version_id;

    // pwc_program_version_rows — chunked insert.
    const CHUNK = 200;
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
        `INSERT INTO pwc_program_version_rows (version_id, dbn, school_year, payload)
         VALUES ${tuples.join(', ')}`,
        params,
      );
    }

    // pwc_school_program — full replace from the new version's rows. Read-
    // side queries (PWC layer, analytics) see the old set until COMMIT.
    await p.query(`DELETE FROM pwc_school_program`);

    // Per-column INSERT from JSON payload. PWC_DATA_FIELDS is the canonical
    // ordering; if you change schema.sql, change pwcSchema.ts to match.
    for (let i = 0; i < args.rows.length; i += CHUNK) {
      const chunk = args.rows.slice(i, i + CHUNK);
      const tuples: string[] = [];
      const params: unknown[] = [];
      let n = 1;
      for (const r of chunk) {
        const placeholders: string[] = [`$${n++}`, `$${n++}`];
        params.push(r.dbn, r.school_year);
        for (const col of PWC_DATA_FIELDS) {
          placeholders.push(`$${n++}`);
          params.push(r.payload[col] ?? null);
        }
        tuples.push(`(${placeholders.join(', ')})`);
      }
      await p.query(
        `INSERT INTO pwc_school_program (dbn, school_year, ${PWC_DATA_FIELDS.join(', ')})
         VALUES ${tuples.join(', ')}`,
        params,
      );
    }

    await p.query(
      `INSERT INTO pwc_program_current (pin, version_id, updated_at)
       VALUES (1, $1, now())
       ON CONFLICT (pin) DO UPDATE SET version_id = EXCLUDED.version_id, updated_at = EXCLUDED.updated_at`,
      [versionId],
    );
    await p.query('COMMIT');
    return { versionId };
  } catch (err) {
    await p.query('ROLLBACK');
    throw err;
  }
}

export async function updateCsvUrl(versionId: number, csvUrl: string): Promise<void> {
  await pool().query(
    `UPDATE pwc_program_versions SET csv_url = $1 WHERE version_id = $2`,
    [csvUrl, versionId],
  );
}

/**
 * Validate that every DBN in the candidate row set exists in `schools`. The
 * FK on pwc_school_program would reject the apply with an opaque error;
 * doing this check at preview time means the admin sees the offending DBNs
 * before they hit Apply.
 */
export async function findUnknownDbns(dbns: string[]): Promise<string[]> {
  if (dbns.length === 0) return [];
  const unique = Array.from(new Set(dbns));
  const r = await pool().query(
    `SELECT dbn FROM schools WHERE dbn = ANY($1::text[])`,
    [unique],
  );
  const known = new Set(r.rows.map((row) => row.dbn));
  return unique.filter((d) => !known.has(d));
}
