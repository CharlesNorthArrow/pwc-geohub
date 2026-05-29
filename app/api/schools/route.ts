import { NextResponse, type NextRequest } from 'next/server';
import { getSchoolFeatures, latestYear, indicatorOrThrow } from '../../../src/server/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const year = req.nextUrl.searchParams.get('year') ?? latestYear(indicatorId);
  if (!year) {
    return NextResponse.json({ error: 'indicator has no year coverage' }, { status: 404 });
  }
  const fc = await getSchoolFeatures(indicatorId, year);
  return NextResponse.json(fc);
}
