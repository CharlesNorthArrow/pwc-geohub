import { NextResponse, type NextRequest } from 'next/server';
import { guardAdmin, newUploadId, putUploadSession } from '../../../../../../src/server/adminRoutes';
import { classifyColumns } from '../../../../../../src/admin/columnReconciliation';
import { MASTER_FIELDS } from '../../../../../../src/admin/schoolMasterSchema';
import { csvCell } from '../../../../../../src/admin/csvRender';
import { MAX_UPLOAD_BYTES } from '../../../../../../src/admin/uploadLimits';
import { stageMasterRebuild } from '../../../../../../src/server/schoolMasterRebuild';
import type { RawFile } from '../../../../../../src/admin/rawTransforms/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Multipart upload of one or more raw school-master source files. Each file
 * is recognized and parsed; the master is rebuilt from the stored sources
 * with these replacing their slots. Any blocking issue → 422
 * `schema_changed` (nothing stored). Otherwise the rebuilt rows become an
 * upload session for the regular school-master preview / apply routes,
 * carrying the staged extracts (saved on apply) and the coverage notes.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return guardAdmin(async () => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: 'bad_multipart' }, { status: 400 });
    }
    const uploads = form.getAll('file').filter((f): f is File => f instanceof File);
    if (uploads.length === 0) return NextResponse.json({ error: 'missing_file' }, { status: 400 });
    if (uploads.reduce((s, f) => s + f.size, 0) > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'file_too_large', max_bytes: MAX_UPLOAD_BYTES }, { status: 413 });
    }
    const files: RawFile[] = await Promise.all(
      uploads.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })),
    );

    const staged = await stageMasterRebuild(files);
    if (!staged.ok) {
      return NextResponse.json(
        { error: 'schema_changed', issues: staged.issues, warnings: staged.warnings, files: staged.files },
        { status: 422 },
      );
    }

    const headers = MASTER_FIELDS.map((f) => f.id);
    const rawRows = staged.build.rows;
    const csvText =
      [headers.join(','), ...rawRows.map((r) => headers.map((h) => csvCell(r[h] || null)).join(','))].join('\n') + '\n';
    const filename = files.map((f) => f.name).join(', ');
    const classification = classifyColumns(headers, MASTER_FIELDS);
    const uploadId = newUploadId();
    putUploadSession({
      uploadId,
      filename,
      csvText,
      headers,
      rawRows,
      classification,
      createdAt: Date.now(),
      meta: {
        transform: { sourceFiles: files.map((f) => f.name), warnings: staged.warnings },
        stagedSources: staged.staged,
        coverageNotes: staged.notes,
      },
    });
    return NextResponse.json({
      uploadId,
      filename,
      rowCount: rawRows.length,
      headers,
      classification,
      transformed: true,
      files: staged.files,
    });
  });
}
