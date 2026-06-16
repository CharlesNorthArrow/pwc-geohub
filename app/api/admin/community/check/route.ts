import { NextResponse } from 'next/server';
import { guardAdmin } from '../../../../../src/server/adminRoutes';
import { runChecks } from '../../../../../src/server/communityCheck';
import { getAllStatus } from '../../../../../src/server/communityAdminDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Probes call out to Census + CDC; keep the cap generous but bounded.
export const maxDuration = 60;

export async function POST(): Promise<NextResponse> {
  return guardAdmin(async () => {
    const outcomes = await runChecks();
    const status = await getAllStatus();
    return NextResponse.json({ outcomes, status });
  });
}
