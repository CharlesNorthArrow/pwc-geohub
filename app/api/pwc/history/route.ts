import { NextResponse } from 'next/server';
import { getPwcHistory } from '../../../../src/server/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/pwc/history → per-year PWC membership for the Phase 5 timeline. */
export async function GET(): Promise<NextResponse> {
  const payload = await getPwcHistory();
  return NextResponse.json(payload);
}
