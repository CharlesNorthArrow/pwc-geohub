import { NextResponse, type NextRequest } from 'next/server';
import { parse } from 'csv-parse/sync';
import {
  guardAdmin,
  newUploadId,
  putUploadSession,
  type UploadSession,
} from '../../../../../../src/server/adminRoutes';
import { classifyColumns } from '../../../../../../src/admin/columnReconciliation';
import { getIndicatorDataset, type IndicatorDatasetConfig } from '../../../../../../src/admin/indicatorDatasets';
import { synthesizeGraduationSchoolYear } from '../../../../../../src/admin/indicatorTransform';
import { getRawTransform, type RawFile } from '../../../../../../src/admin/rawTransforms';
import { csvCell } from '../../../../../../src/admin/csvRender';
import { getEnrollmentByDbnYear } from '../../../../../../src/server/indicatorAdminDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
// Raw DOE workbooks reach ~88 MB (chronic absenteeism); Vercel caps
// request bodies at 100 MB.
const MAX_BYTES = 95 * 1024 * 1024;

/**
 * Multipart upload: one or more `file` parts, plus an optional `schoolYear`
 * (confirmed by the admin for datasets whose year isn't inside the file).
 *
 * Two paths:
 *  - Raw DOE file(s), the normal case: the dataset's raw-file transform
 *    (src/admin/rawTransforms — ports of scripts/scripts/*.py) turns them into
 *    canonical rows. If the file structure drifted beyond what the transform
 *    handles, respond 422 `schema_changed` with every issue and store
 *    nothing. Tolerated drift rides along in the session as warnings.
 *  - A single CSV already shaped like the template (has a `school_year` /
 *    `cohort_year` column): the pre-existing reconcile path, kept for manual
 *    corrections. Graduation synthesizes school_year from cohort_year first.
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
    const uploads = form.getAll('file').filter((f): f is File => f instanceof File);
    if (uploads.length === 0) {
      return NextResponse.json({ error: 'missing_file' }, { status: 400 });
    }
    const totalBytes = uploads.reduce((s, f) => s + f.size, 0);
    if (totalBytes > MAX_BYTES) {
      return NextResponse.json({ error: 'file_too_large', max_bytes: MAX_BYTES }, { status: 413 });
    }
    const files: RawFile[] = await Promise.all(
      uploads.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })),
    );
    const schoolYearField = form.get('schoolYear');
    const schoolYear = typeof schoolYearField === 'string' && schoolYearField ? schoolYearField : undefined;

    if (files.length === 1 && files[0]!.name.toLowerCase().endsWith('.csv')) {
      const processed = tryProcessedCsv(files[0]!, cfg);
      if (processed) return processed;
    }

    const transform = getRawTransform(cfg.id);
    if (!transform) {
      return NextResponse.json({ error: 'no_transform' }, { status: 400 });
    }
    const enrollment = transform.needsEnrollment ? await getEnrollmentByDbnYear() : undefined;
    const result = transform.run(files, { schoolYear, enrollment });
    if (result.errors.length > 0) {
      return NextResponse.json(
        { error: 'schema_changed', issues: result.errors, warnings: result.warnings },
        { status: 422 },
      );
    }

    const headers = cfg.fields.map((f) => f.id);
    const rawRows = result.rows.map((r) => Object.fromEntries(headers.map((h) => [h, r[h] ?? ''])));
    const csvText =
      [headers.join(','), ...rawRows.map((r) => headers.map((h) => csvCell(r[h] || null)).join(','))].join('\n') + '\n';
    const filename = files.length === 1 ? files[0]!.name : `${files.length} files (${files.map((f) => f.name).join(', ')})`;

    return store({
      filename,
      csvText,
      headers,
      rawRows,
      cfg,
      meta: { transform: { sourceFiles: result.stats.files, warnings: result.warnings } },
    });
  });
}

/** The pre-existing path for a CSV already shaped like the template. */
function tryProcessedCsv(file: RawFile, cfg: IndicatorDatasetConfig): NextResponse | null {
  const csvText = Buffer.from(file.data).toString('utf8');
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
  } catch {
    // Not a clean CSV — let the raw transform report on it.
    return null;
  }
  if (!headers.some((h) => h === 'school_year' || h === 'cohort_year')) return null;

  let meta: UploadSession['meta'];
  if (cfg.yearMode === 'cohort_year') {
    const synth = synthesizeGraduationSchoolYear(headers, rawRows);
    headers = synth.headers;
    rawRows = synth.rawRows;
    meta = { cohortDerivedCount: synth.derivedCount, cohortMismatchCount: synth.mismatchCount };
  }
  return store({ filename: file.name, csvText, headers, rawRows, cfg, meta });
}

function store(args: {
  filename: string;
  csvText: string;
  headers: string[];
  rawRows: Array<Record<string, string>>;
  cfg: IndicatorDatasetConfig;
  meta?: UploadSession['meta'];
}): NextResponse {
  const classification = classifyColumns(args.headers, args.cfg.fields);
  const uploadId = newUploadId();
  putUploadSession({
    uploadId,
    filename: args.filename,
    csvText: args.csvText,
    headers: args.headers,
    rawRows: args.rawRows,
    classification,
    createdAt: Date.now(),
    ...(args.meta ? { meta: args.meta } : {}),
  });
  return NextResponse.json({
    uploadId,
    filename: args.filename,
    rowCount: args.rawRows.length,
    headers: args.headers,
    classification,
    transformed: Boolean(args.meta?.transform),
  });
}

/** Fallback when csv-parse gives us zero rows — peek at the first line so the
 *  admin sees the headers in a "empty body" diagnostic. */
function extractHeadersFromCsv(csv: string): string[] {
  const firstLine = csv.split(/\r?\n/, 1)[0] ?? '';
  return firstLine.split(',').map((s) => s.trim());
}
