import { NextResponse, type NextRequest } from 'next/server';
import { getSchoolProfile } from '../../../../src/server/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/schools/profile?dbn=YYYY
 *
 * Identity + latest-year demographics for the School Detail Panel's §1.b.
 * Pinned to the most recent non-null `schools_year` row for that school, so
 * the slider doesn't change what the user sees here.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const dbn = req.nextUrl.searchParams.get('dbn');
  if (!dbn) {
    return NextResponse.json({ error: 'missing ?dbn=' }, { status: 400 });
  }
  const payload = await getSchoolProfile(dbn);
  return NextResponse.json(payload);
}
