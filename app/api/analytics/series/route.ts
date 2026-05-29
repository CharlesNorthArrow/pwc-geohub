import { NextResponse, type NextRequest } from 'next/server';
import { getAnalyticsSeries, indicatorOrThrow } from '../../../../src/server/contract';
import type { AggregationArea } from '../../../../src/contract/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_AGG = new Set<AggregationArea>(['school_district', 'nta_2020']);

/**
 * GET /api/analytics/series?indicator=X[&aggArea=school_district|nta_2020]
 *
 * Required for community indicators: `aggArea` chooses which polygon defines
 * each school's "surrounding area" for the §5.4 aggregation.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const indicatorId = req.nextUrl.searchParams.get('indicator');
  if (!indicatorId) {
    return NextResponse.json({ error: 'missing ?indicator=' }, { status: 400 });
  }
  try {
    indicatorOrThrow(indicatorId);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
  const raw = req.nextUrl.searchParams.get('aggArea');
  const aggArea: AggregationArea | null =
    raw && VALID_AGG.has(raw as AggregationArea) ? (raw as AggregationArea) : null;
  const payload = await getAnalyticsSeries(indicatorId, aggArea);
  return NextResponse.json(payload);
}
