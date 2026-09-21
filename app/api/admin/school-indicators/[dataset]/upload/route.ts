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
import { readUploadedFiles } from '../../../../../../src/server/uploadedFiles';
import { csvCell } from '../../../../../../src/admin/csvRender';
import { getEnrollmentByDbnYear } from '../../../../../../src/server/indicatorAdminDb';
import { MAX_UPLOAD_BYTES as MAX_BYTES } from '../../../../../../src/admin/uploadLimits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Upload of one or more files plus an optional `schoolYear` (confirmed by the
 * admin for datasets whose year isn't inside the file). Files arrive as
 * multipart parts (small uploads) or as Vercel Blob URLs (large ones — see
 * src/server/uploadedFiles.ts).
 *
 * Two paths:
 *  - Raw DOE file(s), the normal case: the dataset's raw-file transform
 *    (src/admin/rawTransforms) turns them into
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

    const uploaded = await readUploadedFiles(req);
    if ('error' in uploaded) {
      return NextResponse.json({ error: uploaded.error }, { status: 400 });
    }
    try {
      if (uploaded.totalBytes > MAX_BYTES) {
        return NextResponse.json({ error: 'file_too_large', max_bytes: MAX_BYTES }, { status: 413 });
      }
      return await processUpload(cfg, uploaded.files, uploaded.fields.schoolYear || undefined);
    } finally {
      await uploaded.cleanup();
    }
  });
}

async function processUpload(
  cfg: IndicatorDatasetConfig,
  files: RawFile[],
  schoolYear: string | undefined,
): Promise<NextResponse> {
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
