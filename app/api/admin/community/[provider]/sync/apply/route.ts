import { NextResponse, type NextRequest } from 'next/server';
import { guardAdmin } from '../../../../../../../src/server/adminRoutes';
import { applyProvider } from '../../../../../../../src/server/communitySyncRoute';
import type { Provider } from '../../../../../../../src/admin/communitySync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // ACS fetch + diff + apply tx for a vintage

interface ApplyBody {
  notes?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  return guardAdmin(async () => {
    const { provider: raw } = await params;
    if (raw !== 'acs' && raw !== 'cdc_places') {
      return NextResponse.json({ error: 'unknown_provider' }, { status: 404 });
    }
    let body: ApplyBody = {};
    try { body = (await req.json()) as ApplyBody; } catch { /* allow empty body */ }
    try {
      const r = await applyProvider(raw as Provider, body.notes?.trim() || null);
      if (r.alreadyLatest) {
        return NextResponse.json({ alreadyLatest: true });
      }
      return NextResponse.json({ versionId: r.versionId, alreadyLatest: false });
    } catch (err) {
      return NextResponse.json({ error: 'apply_failed', message: (err as Error).message }, { status: 502 });
    }
  });
}
