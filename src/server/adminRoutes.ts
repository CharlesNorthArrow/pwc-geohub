/**
 * Server-side helpers shared by the admin API routes.
 *
 * - guardAdmin(): wraps a handler in requireRole + uniform 401 response.
 * - sessionStore: an in-memory bag for ephemeral "this upload's classification"
 *   so the preview/apply endpoints don't have to receive the whole CSV again.
 *   Keyed by an opaque upload_id; entries expire after 30 minutes. Fine for
 *   the once-a-year usage profile and survives Fluid Compute instance reuse;
 *   does NOT survive a cold start, in which case the admin re-uploads.
 */

import { NextResponse } from 'next/server';
import { requireRole, UnauthorizedError } from './auth';
import type { Classification } from '../admin/columnReconciliation';

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
}

const SESSIONS = new Map<string, UploadSession>();
const TTL_MS = 30 * 60 * 1000;

export function putUploadSession(s: UploadSession): void {
  // Sweep expired entries on every put — bounded growth, no background timer.
  const now = Date.now();
  for (const [k, v] of SESSIONS) {
    if (now - v.createdAt > TTL_MS) SESSIONS.delete(k);
  }
  SESSIONS.set(s.uploadId, s);
}

export function getUploadSession(uploadId: string): UploadSession | undefined {
  const s = SESSIONS.get(uploadId);
  if (!s) return undefined;
  if (Date.now() - s.createdAt > TTL_MS) {
    SESSIONS.delete(uploadId);
    return undefined;
  }
  return s;
}

export function deleteUploadSession(uploadId: string): void {
  SESSIONS.delete(uploadId);
}

export function newUploadId(): string {
  return `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
