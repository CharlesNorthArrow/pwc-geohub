import { NextResponse } from 'next/server';
import { getSchoolsMaster } from '../../../src/server/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/schools-master → the schools universe for Phase 3's cascade.
 * One row per plottable school with its 6 §6.1 crosswalk memberships baked in.
 * Cached at the CDN edge; the underlying data only changes when ETL reruns.
 */
export async function GET(): Promise<NextResponse> {
  const payload = await getSchoolsMaster();
  return NextResponse.json(payload);
}
