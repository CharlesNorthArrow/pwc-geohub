import { NextResponse } from 'next/server';
import { guardAdmin } from '../../../../../src/server/adminRoutes';
import { getAllStatus } from '../../../../../src/server/communityAdminDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return guardAdmin(async () => {
    const status = await getAllStatus();
    return NextResponse.json({ status });
  });
}
