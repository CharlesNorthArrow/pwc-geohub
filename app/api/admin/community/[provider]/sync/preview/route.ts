import { NextResponse, type NextRequest } from 'next/server';
import { guardAdmin } from '../../../../../../../src/server/adminRoutes';
import { computePreview } from '../../../../../../../src/server/communitySyncRoute';
import type { Provider } from '../../../../../../../src/admin/communitySync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  return guardAdmin(async () => {
    const { provider: raw } = await params;
    if (raw !== 'acs' && raw !== 'cdc_places') {
      return NextResponse.json({ error: 'unknown_provider' }, { status: 404 });
    }
    try {
      const preview = await computePreview(raw as Provider);
      return NextResponse.json({ preview });
    } catch (err) {
      return NextResponse.json({ error: 'probe_or_fetch_failed', message: (err as Error).message }, { status: 502 });
    }
  });
}
