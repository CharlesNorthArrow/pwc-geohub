/**
 * Server-side helpers shared by the admin API routes.
 *
 * - guardAdmin(): wraps a handler in requireRole + uniform 401 response.
 * - upload sessions: "this upload's parsed rows + classification", so the
 *   preview/apply endpoints don't have to receive the whole file again.
 *   Stored in Postgres (`admin_upload_sessions`), keyed by an opaque
 *   upload_id, expiring after 30 minutes. NOT in process memory: on Vercel
 *   consecutive requests can land on different function instances, and an
 *   in-memory session then reads as "upload expired".
 */

import { NextResponse } from 'next/server';
import { requireRole, UnauthorizedError } from './auth';
import type { Classification } from '../admin/columnReconciliation';
import type { TransformIssue } from '../admin/rawTransforms/types';
import type { SourceRecord } from '../admin/schoolMaster/types';
import { pool } from './db';

export type AdminHandler = () => Promise<NextResponse>;

export async function guardAdmin(handler: AdminHandler): Promise<NextResponse> {
  try {
    await requireRole('admin');
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }
  return handler();
}

export interface UploadSession {
  uploadId: string;
  filename: string;
  csvText: string;
  headers: string[];
  rawRows: Array<Record<string, string>>;
  classification: Classification;
  createdAt: number;
  /** Optional per-flow stats stamped at upload time: the graduation
   *  cohort_year → school_year synthesis counts, and the raw-file transform's
   *  tolerated-drift warnings (school indicators). */
  meta?: {
    cohortDerivedCount?: number;
    cohortMismatchCount?: number;
    transform?: {
      sourceFiles: string[];
      warnings: TransformIssue[];
    };
    /** School master rebuild from stored sources: source extracts to save
     *  on apply (empty — already stored) and coverage lines for the preview. */
    stagedSources?: SourceRecord[];
    coverageNotes?: string[];
  };
}

const TTL = '30 minutes';

/** Same DDL as src/db/schema.sql — created on first use so no ETL step is needed. */
async function ensureSessionTable(): Promise<void> {
  await pool().query(
    `CREATE TABLE IF NOT EXISTS admin_upload_sessions (
       upload_id  TEXT PRIMARY KEY,
       created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
       session    JSONB NOT NULL
     )`,
  );
}

export async function putUploadSession(s: UploadSession): Promise<void> {
  await ensureSessionTable();
  // Sweep expired entries on every put — bounded growth, no background job.
  await pool().query(`DELETE FROM admin_upload_sessions WHERE created_at < now() - interval '${TTL}'`);
  // csvText is never read back after upload — keep the stored row lean.
  const { csvText: _unused, ...rest } = s;
  await pool().query(
    `INSERT INTO admin_upload_sessions (upload_id, session) VALUES ($1, $2::jsonb)
     ON CONFLICT (upload_id) DO UPDATE SET session = EXCLUDED.session, created_at = now()`,
    [s.uploadId, JSON.stringify(rest)],
  );
}

export async function getUploadSession(uploadId: string): Promise<UploadSession | undefined> {
  try {
    const r = await pool().query(
      `SELECT session FROM admin_upload_sessions
        WHERE upload_id = $1 AND created_at >= now() - interval '${TTL}'`,
      [uploadId],
    );
    if (r.rows.length === 0) return undefined;
    return { csvText: '', ...(r.rows[0] as { session: Omit<UploadSession, 'csvText'> }).session };
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') return undefined; // table not created yet
    throw err;
  }
}

export async function deleteUploadSession(uploadId: string): Promise<void> {
  await pool().query(`DELETE FROM admin_upload_sessions WHERE upload_id = $1`, [uploadId]).catch(() => undefined);
}

export function newUploadId(): string {
  return `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
