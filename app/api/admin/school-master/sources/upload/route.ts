import { NextResponse, type NextRequest } from 'next/server';
import { guardAdmin } from '../../../../../../src/server/adminRoutes';
import { MAX_UPLOAD_BYTES } from '../../../../../../src/admin/uploadLimits';
import { CARD_KINDS, storeSourceFiles } from '../../../../../../src/server/schoolMasterRebuild';
import type { RawFile } from '../../../../../../src/admin/rawTransforms/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Multipart upload of the file(s) for ONE school-master source card
 * (`card` = snapshot | directory | lcgms | community_schools). Each file is
 * recognized, checked to be that source, parsed and stored. Any blocking
 * issue (unrecognized / drifted / wrong-card / duplicate file) → 422
 * `schema_changed` and nothing is stored. The live master is untouched —
 * "Rebuild master" (sources/rebuild) applies stored sources.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return guardAdmin(async () => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: 'bad_multipart' }, { status: 400 });
    }
    const card = String(form.get('card') ?? '');
    if (!CARD_KINDS[card]) return NextResponse.json({ error: 'unknown_source' }, { status: 400 });
    const uploads = form.getAll('file').filter((f): f is File => f instanceof File);
    if (uploads.length === 0) return NextResponse.json({ error: 'missing_file' }, { status: 400 });
    if (uploads.reduce((s, f) => s + f.size, 0) > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'file_too_large', max_bytes: MAX_UPLOAD_BYTES }, { status: 413 });
    }
    const files: RawFile[] = await Promise.all(
      uploads.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })),
    );

    const r = await storeSourceFiles(files, card, 'admin');
    if (!r.ok) {
      return NextResponse.json({ error: 'schema_changed', issues: r.issues, warnings: r.warnings, files: r.files }, { status: 422 });
    }
    return NextResponse.json({ files: r.files, warnings: r.warnings });
  });
}
