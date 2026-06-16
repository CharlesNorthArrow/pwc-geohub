import { NextResponse, type NextRequest } from 'next/server';
import { runChecks } from '../../../../src/server/communityCheck';
import { hasValidAdminSession } from '../../../../src/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Vercel Cron entry-point. Auth: requires either:
 *  - `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends this automatically
 *    when CRON_SECRET is set in env), OR
 *  - a valid admin session (so an admin can curl this manually as a fallback).
 *
 * Without CRON_SECRET set, the bearer path fails closed — never the cron's
 * job to provision the secret. The admin-session path keeps working.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  const bearerOk = !!secret && auth === `Bearer ${secret}`;
  const sessionOk = bearerOk ? false : await hasValidAdminSession();
  if (!bearerOk && !sessionOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const outcomes = await runChecks();
  return NextResponse.json({ ran_at: new Date().toISOString(), outcomes });
}
