import { NextResponse, type NextRequest } from 'next/server';
import { guardAdmin } from '../../../../../../src/server/adminRoutes';
import { MAX_UPLOAD_BYTES } from '../../../../../../src/admin/uploadLimits';
import { CARD_KINDS, storeSourceFiles } from '../../../../../../src/server/schoolMasterRebuild';
import { readUploadedFiles } from '../../../../../../src/server/uploadedFiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Upload of the file(s) for ONE school-master source card (`card` =
 * snapshot | directory | lcgms | community_schools) — multipart for small
 * uploads, Vercel Blob URLs for large ones (src/server/uploadedFiles.ts). Each file is
 * recognized, checked to be that source, parsed and stored. Any blocking
 * issue (unrecognized / drifted / wrong-card / duplicate file) → 422
 * `schema_changed` and nothing is stored. The live master is untouched —
 * "Rebuild master" (sources/rebuild) applies stored sources.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return guardAdmin(async () => {
    const uploaded = await readUploadedFiles(req);
    if ('error' in uploaded) return NextResponse.json({ error: uploaded.error }, { status: 400 });
    try {
      const card = uploaded.fields.card ?? '';
      if (!CARD_KINDS[card]) return NextResponse.json({ error: 'unknown_source' }, { status: 400 });
      if (uploaded.totalBytes > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: 'file_too_large', max_bytes: MAX_UPLOAD_BYTES }, { status: 413 });
      }
      const r = await storeSourceFiles(uploaded.files, card, 'admin');
      if (!r.ok) {
        return NextResponse.json({ error: 'schema_changed', issues: r.issues, warnings: r.warnings, files: r.files }, { status: 422 });
      }
      return NextResponse.json({ files: r.files, warnings: r.warnings });
    } finally {
      await uploaded.cleanup();
    }
  });
}
