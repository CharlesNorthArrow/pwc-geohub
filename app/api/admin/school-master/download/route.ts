import { NextResponse } from 'next/server';
import { guardAdmin } from '../../../../../src/server/adminRoutes';
import { getCurrentMasterVersionId, getMasterVersionRows } from '../../../../../src/server/schoolMasterAdminDb';
import { MASTER_FIELDS } from '../../../../../src/admin/schoolMasterSchema';
import { renderCsv } from '../../../../../src/admin/csvRender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Materialize the current version's row set as CSV. Always rebuilt from the
 * version_rows table (not the Blob snapshot) so the download is always
 * self-consistent with the live read view.
 */
export async function GET(): Promise<NextResponse> {
  return guardAdmin(async () => {
    const vid = await getCurrentMasterVersionId();
    if (vid == null) {
      return NextResponse.json({ error: 'no_current_version' }, { status: 404 });
    }
    const rows = await getMasterVersionRows(vid);
    const body = renderCsv(MASTER_FIELDS, rows);
    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="schools_master_v${vid}.csv"`,
        'cache-control': 'no-store',
      },
    });
  });
}
