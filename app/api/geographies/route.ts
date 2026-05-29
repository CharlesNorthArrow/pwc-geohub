import { NextResponse } from 'next/server';
import { getGeographies } from '../../../src/server/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/geographies → option lists for the §6.1 Geo filter popup.
 * One round-trip returns all 6 layers (~360 areas total) — small enough that
 * splitting per-layer would just add latency. Cached at the CDN edge.
 */
export async function GET(): Promise<NextResponse> {
  const payload = await getGeographies();
  return NextResponse.json(payload);
}
