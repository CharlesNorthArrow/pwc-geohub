import { NextResponse, type NextRequest } from 'next/server';
import { getSchoolArtsEd } from '../../../../src/server/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/schools/arts-ed?dbn= → latest-year arts_ed disciplines for one
 * school. Slider-independent — used by the Detail Panel's Arts Education
 * block (between School Profile and PWC Programs).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const dbn = req.nextUrl.searchParams.get('dbn');
  if (!dbn) {
    return NextResponse.json({ error: 'dbn is required' }, { status: 400 });
  }
  const payload = await getSchoolArtsEd(dbn);
  return NextResponse.json(payload);
}
