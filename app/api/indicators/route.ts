import { NextResponse } from 'next/server';
import { getActiveIndicators } from '../../../src/server/contract';
import type { IndicatorsResponse } from '../../../src/contract/types';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

export function GET(): NextResponse<IndicatorsResponse> {
  return NextResponse.json({ indicators: getActiveIndicators() });
}
