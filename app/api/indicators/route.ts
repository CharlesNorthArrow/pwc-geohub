import { NextResponse } from 'next/server';
import { getActiveIndicatorsWithYears } from '../../../src/server/contract';
import type { IndicatorsResponse } from '../../../src/contract/types';

export const runtime = 'nodejs';
// Dynamic (was force-static): school-indicator `years` are overlaid with the
// actual DB coverage so an admin upload of a new year is visible on the next
// page load — no code edit, no redeploy.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse<IndicatorsResponse>> {
  const indicators = await getActiveIndicatorsWithYears();
  return NextResponse.json(
    { indicators },
    { headers: { 'cache-control': 'no-store' } },
  );
}
