import { NextResponse, type NextRequest } from 'next/server';
import { getSchoolExport } from '../../../../src/server/schoolExport';
import { csvCell } from '../../../../src/admin/csvRender';
import type { AggregationArea } from '../../../../src/contract/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AGG: ReadonlySet<string> = new Set(['school_district', 'nta_2020']);
const DBN_RE = /^[0-9A-Z]{6}$/;
const YEAR_RE = /^\d{4}-\d{2}$/;
const MAX_SCHOOLS = 3000;

/**
 * POST { dbns, aggregationArea, year (null = latest per indicator), pwcYear }
 * → CSV attachment, one row per school (src/server/schoolExport.ts). The
 * client sends the dashboard's filtered universe so the file matches what
 * the map shows. ~1,900 schools × ~60 columns ≈ 1 MB — under the 4.5 MB
 * function response limit.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { dbns?: unknown; aggregationArea?: unknown; year?: unknown; pwcYear?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const dbns = Array.isArray(body.dbns) ? body.dbns.filter((d): d is string => typeof d === 'string' && DBN_RE.test(d)) : [];
  const aggregationArea = String(body.aggregationArea ?? '');
  const year = body.year == null ? null : String(body.year);
  const pwcYear = String(body.pwcYear ?? '');
  if (dbns.length === 0 || dbns.length > MAX_SCHOOLS) return NextResponse.json({ error: 'bad_dbns' }, { status: 400 });
  if (!AGG.has(aggregationArea)) return NextResponse.json({ error: 'bad_aggregation_area' }, { status: 400 });
  if ((year != null && !YEAR_RE.test(year)) || !YEAR_RE.test(pwcYear)) {
    return NextResponse.json({ error: 'bad_year' }, { status: 400 });
  }

  const { headers, rows } = await getSchoolExport({
    dbns,
    aggregationArea: aggregationArea as AggregationArea,
    year,
    pwcYear,
  });
  const csv = '﻿' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="pwc-geohub-schools-${date}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
