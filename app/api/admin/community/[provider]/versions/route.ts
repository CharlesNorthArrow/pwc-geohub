import { NextResponse, type NextRequest } from 'next/server';
import { guardAdmin } from '../../../../../../src/server/adminRoutes';
import { listVersions } from '../../../../../../src/server/communityAdminDb';
import type { Provider } from '../../../../../../src/admin/communitySync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  return guardAdmin(async () => {
    const { provider: raw } = await params;
    if (raw !== 'acs' && raw !== 'cdc_places') {
      return NextResponse.json({ error: 'unknown_provider' }, { status: 404 });
    }
    const versions = await listVersions(raw as Provider);
    return NextResponse.json({ versions });
  });
}
