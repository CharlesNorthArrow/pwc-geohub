import { NextResponse, type NextRequest } from 'next/server';
import { parse } from 'csv-parse/sync';
import {
  guardAdmin,
  newUploadId,
  putUploadSession,
} from '../../../../../../src/server/adminRoutes';
import { classifyColumns } from '../../../../../../src/admin/columnReconciliation';
import { getIndicatorDataset } from '../../../../../../src/admin/indicatorDatasets';
import { synthesizeGraduationSchoolYear } from '../../../../../../src/admin/indicatorTransform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 10 MB ceiling — the largest hosted indicator CSV is well under 1 MB.
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Multipart upload: `file` (CSV), classified against the dataset's schema.
 * Graduation only: a `school_year` column is synthesized from `cohort_year`
 * BEFORE classification (the DOE download is cohort-grained), so the
 * missing-key hard block doesn't refuse the file; the synthesis counts ride
 * along in the session for the preview warnings.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dataset: string }> },
): Promise<NextResponse> {
  return guardAdmin(async () => {
    const { dataset } = await params;
    const cfg = getIndicatorDataset(dataset);
    if (!cfg) {
      return NextResponse.json({ error: 'unknown_dataset' }, { status: 404 });
    }

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

    let meta: { cohortDerivedCount?: number; cohortMismatchCount?: number } | undefined;
    if (cfg.yearMode === 'cohort_year') {
      const synth = synthesizeGraduationSchoolYear(headers, rawRows);
      headers = synth.headers;
      rawRows = synth.rawRows;
      meta = {
        cohortDerivedCount: synth.derivedCount,
        cohortMismatchCount: synth.mismatchCount,
      };
    }

    const classification = classifyColumns(headers, cfg.fields);
    const uploadId = newUploadId();
    putUploadSession({
      uploadId,
      filename: file.name,
      csvText,
      headers,
      rawRows,
      classification,
      createdAt: Date.now(),
      ...(meta ? { meta } : {}),
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
