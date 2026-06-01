import { NextResponse, type NextRequest } from 'next/server';
import { getPwcProgram } from '../../../../src/server/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/pwc/program?dbn=&year=
 *
 * One pwc_school_program row for the School Detail Panel's §1.c. The route
 * returns `{program: null}` when the school isn't a PWC school in any year
 * (so the panel hides §1.c entirely) and an `active=false` stub when the
 * school exists in pwc_school_program but has no active programs for the
 * requested year.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const dbn = req.nextUrl.searchParams.get('dbn');
  const year = req.nextUrl.searchParams.get('year');
  if (!dbn || !year) {
    return NextResponse.json({ error: 'missing ?dbn= or ?year=' }, { status: 400 });
  }
  const payload = await getPwcProgram(dbn, year);
  return NextResponse.json(payload);
}
