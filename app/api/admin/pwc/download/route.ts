import { NextResponse } from 'next/server';
import { guardAdmin } from '../../../../../src/server/adminRoutes';
import { getCurrentVersionId, getVersionRows } from '../../../../../src/server/adminDb';
import { PWC_FIELDS } from '../../../../../src/admin/pwcSchema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Materialize the current version's row set as CSV. We always rebuild from
 * the version_rows table rather than redirecting to csv_url so the download
 * is always self-consistent with the live read view, even if a Blob PUT
 * went sideways for some prior version.
 */
export async function GET(): Promise<NextResponse> {
  return guardAdmin(async () => {
    const vid = await getCurrentVersionId();
    if (vid == null) {
      return NextResponse.json({ error: 'no_current_version' }, { status: 404 });
    }
    const rows = await getVersionRows(vid);
    const headers = PWC_FIELDS.map((f) => f.id);
    const lines: string[] = [headers.join(',')];
    for (const r of rows) {
      const cells: string[] = [];
      for (const f of PWC_FIELDS) {
        const v = f.isKey
          ? (f.id === 'DBN' ? r.dbn : r.school_year)
          : (r.payload[f.id] ?? null);
        cells.push(csvCell(v));
      }
      lines.push(cells.join(','));
    }
    const body = lines.join('\n') + '\n';
    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="pwc_schools_v${vid}.csv"`,
        'cache-control': 'no-store',
      },
    });
  });
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  let s: string;
  if (typeof v === 'boolean') s = v ? '1' : '0';
  else s = String(v);
  if (/[",\n\r]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
