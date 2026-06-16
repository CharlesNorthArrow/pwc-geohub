import { NextResponse } from 'next/server';
import { guardAdmin } from '../../../../../src/server/adminRoutes';
import { listVersions } from '../../../../../src/server/adminDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return guardAdmin(async () => {
    const versions = await listVersions();
    return NextResponse.json({ versions });
  });
}
