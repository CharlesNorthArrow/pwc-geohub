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
 * Schema template: the canonical header row plus up to 3 real example rows
 * (so types and formats are self-evident). Headers-only when the dataset has
 * no version yet.
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
    const rows = vid == null ? [] : (await getIndicatorVersionRows(vid)).slice(0, 3);
    const body = renderCsv(cfg.fields, rows);
    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${cfg.id}_template.csv"`,
        'cache-control': 'no-store',
      },
    });
  });
}
