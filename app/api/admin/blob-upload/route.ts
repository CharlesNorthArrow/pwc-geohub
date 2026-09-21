import { NextResponse, type NextRequest } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { requireRole } from '../../../../src/server/auth';
import { MAX_UPLOAD_BYTES } from '../../../../src/admin/uploadLimits';
import { UPLOAD_PREFIX } from '../../../../src/server/uploadedFiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Issues Vercel Blob client-upload tokens for admin raw-file uploads.
 * Vercel Functions accept at most 4.5 MB of request body, so large DOE files
 * go browser → Blob directly; the processing route then reads them from Blob
 * and deletes them. Only signed-in admins get a token, only for the
 * `admin-uploads/` prefix.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        await requireRole('admin');
        if (!pathname.startsWith(`${UPLOAD_PREFIX}/`)) throw new Error('invalid upload path');
        return { maximumSizeInBytes: MAX_UPLOAD_BYTES, addRandomSuffix: true };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
