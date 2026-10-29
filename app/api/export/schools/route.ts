import { gzipSync } from 'node:zlib';
import { NextResponse, type NextRequest } from 'next/server';
import { getSchoolExport } from '../../../../src/server/schoolExport';
import { csvCell } from '../../../../src/admin/csvRender';
import type { AggregationArea } from '../../../../src/contract/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AGG: ReadonlySet<string> = new Set(['school_district', 'nta_2020']);
const DBN_RE = /^[0-9A-Z]{6}$/;
const MAX_SCHOOLS = 3000;

/**
 * POST { dbns, aggregationArea }
 * → CSV attachment, one row per school × school year
 * (src/server/schoolExport.ts). The client sends the dashboard's filtered
 * universe so the file matches what the map shows. A full-city export is
 * several MB of CSV, over the 4.5 MB function response limit, so the body
 * is gzipped here (CSV compresses ~10×); browsers decode it transparently.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { dbns?: unknown; aggregationArea?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const dbns = Array.isArray(body.dbns) ? body.dbns.filter((d): d is string => typeof d === 'string' && DBN_RE.test(d)) : [];
  const aggregationArea = String(body.aggregationArea ?? '');
  if (dbns.length === 0 || dbns.length > MAX_SCHOOLS) return NextResponse.json({ error: 'bad_dbns' }, { status: 400 });
  if (!AGG.has(aggregationArea)) return NextResponse.json({ error: 'bad_aggregation_area' }, { status: 400 });

  const { headers, rows } = await getSchoolExport({
    dbns,
    aggregationArea: aggregationArea as AggregationArea,
  });
  const csv = '﻿' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const date = new Date().toISOString().slice(0, 10);
  const responseHeaders: Record<string, string> = {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="pwc-geohub-schools-${date}.csv"`,
    'cache-control': 'no-store',
  };
  if (/\bgzip\b/.test(req.headers.get('accept-encoding') ?? '')) {
    return new NextResponse(gzipSync(csv), { headers: { ...responseHeaders, 'content-encoding': 'gzip', vary: 'accept-encoding' } });
  }
  return new NextResponse(csv, { headers: responseHeaders });
}
