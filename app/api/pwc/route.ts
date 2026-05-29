import { NextResponse, type NextRequest } from 'next/server';
import { getPwcMembership } from '../../../src/server/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/pwc?year=YYYY-YY → spec §3.5 PWC programmatic snapshot.
 *
 * The "active year" is whatever the active school indicator is displaying
 * (Phase 1 default = the indicator's own latest year). The route stays thin —
 * all of the category logic lives in `getPwcMembership`.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const year = req.nextUrl.searchParams.get('year');
  if (!year) {
    return NextResponse.json({ error: 'missing ?year=' }, { status: 400 });
  }
  const payload = await getPwcMembership(year);
  return NextResponse.json(payload);
}
