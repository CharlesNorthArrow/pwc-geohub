import { NextResponse } from 'next/server';
import { endAdminSession } from '../../../../src/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  await endAdminSession();
  return new NextResponse(null, { status: 204 });
}
