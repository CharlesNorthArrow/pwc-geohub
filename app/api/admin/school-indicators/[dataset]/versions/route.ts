import { NextResponse, type NextRequest } from 'next/server';
import { guardAdmin } from '../../../../../../src/server/adminRoutes';
import { getIndicatorDataset } from '../../../../../../src/admin/indicatorDatasets';
import { listIndicatorVersions } from '../../../../../../src/server/indicatorAdminDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dataset: string }> },
): Promise<NextResponse> {
  return guardAdmin(async () => {
    const { dataset } = await params;
    const cfg = getIndicatorDataset(dataset);
    if (!cfg) {
      return NextResponse.json({ error: 'unknown_dataset' }, { status: 404 });
    }
    const versions = await listIndicatorVersions(cfg.id);
    return NextResponse.json({ versions });
  });
}
