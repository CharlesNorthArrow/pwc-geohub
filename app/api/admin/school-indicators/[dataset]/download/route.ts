import { NextResponse, type NextRequest } from 'next/server';
import { guardAdmin } from '../../../../../../src/server/adminRoutes';
import { getIndicatorDataset } from '../../../../../../src/admin/indicatorDatasets';
import {
  getCurrentIndicatorVersionId,
  getIndicatorVersionRows,
} from '../../../../../../src/server/indicatorAdminDb';
import { renderCsv } from '../../../../../../src/admin/csvRender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Materialize the dataset's current longitudinal row set as CSV. Always
 * rebuilt from the version_rows table (not the Blob snapshot) so the download
 * is always self-consistent with the live read view.
 */
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
    const vid = await getCurrentIndicatorVersionId(cfg.id);
    if (vid == null) {
      return NextResponse.json({ error: 'no_current_version' }, { status: 404 });
    }
    const rows = await getIndicatorVersionRows(vid);
    const body = renderCsv(cfg.fields, rows);
    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${cfg.id}_v${vid}.csv"`,
        'cache-control': 'no-store',
      },
    });
  });
}
