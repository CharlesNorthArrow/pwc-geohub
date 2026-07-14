import { NextResponse } from 'next/server';
import { guardAdmin } from '../../../../../src/server/adminRoutes';
import { listMasterVersions } from '../../../../../src/server/schoolMasterAdminDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return guardAdmin(async () => {
    const versions = await listMasterVersions();
    return NextResponse.json({ versions });
  });
}
