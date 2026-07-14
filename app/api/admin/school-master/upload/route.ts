import { NextResponse, type NextRequest } from 'next/server';
import { parse } from 'csv-parse/sync';
import {
  guardAdmin,
  newUploadId,
  putUploadSession,
} from '../../../../../src/server/adminRoutes';
import { classifyColumns } from '../../../../../src/admin/columnReconciliation';
import { MASTER_FIELDS } from '../../../../../src/admin/schoolMasterSchema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 10 MB upload ceiling — schools_master.csv is ~2 MB today, headroom for growth.
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Multipart upload: `file` (CSV). Same contract as the pwc upload route, but
 * classified against the schools_master schema.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return guardAdmin(async () => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: 'bad_multipart' }, { status: 400 });
    }
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'missing_file' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'file_too_large', max_bytes: MAX_BYTES }, { status: 413 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const csvText = buf.toString('utf8');

    let rawRows: Array<Record<string, string>>;
    let headers: string[];
    try {
      rawRows = parse(csvText, {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        cast: false,
      }) as Array<Record<string, string>>;
      headers = rawRows.length > 0 ? Object.keys(rawRows[0]!) : extractHeadersFromCsv(csvText);
    } catch (err) {
      return NextResponse.json({ error: 'parse_failed', detail: (err as Error).message }, { status: 400 });
    }

    if (headers.length === 0) {
      return NextResponse.json({ error: 'empty_csv' }, { status: 400 });
    }

    const classification = classifyColumns(headers, MASTER_FIELDS);
    const uploadId = newUploadId();
    putUploadSession({
      uploadId,
      filename: file.name,
      csvText,
      headers,
      rawRows,
      classification,
      createdAt: Date.now(),
    });

    return NextResponse.json({
      uploadId,
      filename: file.name,
      rowCount: rawRows.length,
      headers,
      classification,
    });
  });
}

/** Fallback when csv-parse gives us zero rows — peek at the first line so the
 *  admin sees the headers in a "empty body" diagnostic. */
function extractHeadersFromCsv(csv: string): string[] {
  const firstLine = csv.split(/\r?\n/, 1)[0] ?? '';
  return firstLine.split(',').map((s) => s.trim());
}
