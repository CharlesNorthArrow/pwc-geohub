/**
 * Read the files of an admin raw-file upload, whichever way they arrived:
 *  - multipart/form-data (`file` parts + text fields) — small uploads;
 *  - JSON `{ files: [{ name, url }], fields }` — files the browser uploaded
 *    to Vercel Blob first, because Vercel Functions accept at most 4.5 MB of
 *    request body. Only URLs under our `admin-uploads/` prefix on the
 *    project's Blob store are fetched; `cleanup()` deletes them afterwards.
 */

import { del } from '@vercel/blob';
import type { RawFile } from '../admin/rawTransforms/types';

export const UPLOAD_PREFIX = 'admin-uploads';

export interface UploadedFiles {
  files: RawFile[];
  fields: Record<string, string>;
  totalBytes: number;
  cleanup: () => Promise<void>;
}

const isOurBlob = (u: URL): boolean =>
  u.protocol === 'https:' &&
  u.hostname.endsWith('.blob.vercel-storage.com') &&
  u.pathname.startsWith(`/${UPLOAD_PREFIX}/`);

export async function readUploadedFiles(req: Request): Promise<UploadedFiles | { error: string }> {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    let body: { files?: Array<{ name?: string; url?: string }>; fields?: Record<string, unknown> };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return { error: 'bad_json' };
    }
    const refs = (body.files ?? []).filter((f): f is { name: string; url: string } => !!f.name && !!f.url);
    const urls = refs.map((f) => new URL(f.url));
    const cleanup = async (): Promise<void> => {
      if (urls.length > 0) await del(urls.map((u) => u.toString())).catch(() => undefined);
    };
    if (refs.length === 0) return { error: 'missing_file' };
    if (!urls.every(isOurBlob)) {
      return { error: 'bad_file_url' };
    }
    const files: RawFile[] = [];
    for (const [i, f] of refs.entries()) {
      const r = await fetch(urls[i]!, { cache: 'no-store' });
      if (!r.ok) {
        await cleanup();
        return { error: `blob_fetch_failed:${r.status}` };
      }
      files.push({ name: f.name, data: new Uint8Array(await r.arrayBuffer()) });
    }
    const fields = Object.fromEntries(Object.entries(body.fields ?? {}).map(([k, v]) => [k, String(v ?? '')]));
    return { files, fields, totalBytes: files.reduce((s, f) => s + f.data.byteLength, 0), cleanup };
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { error: 'bad_multipart' };
  }
  const uploads = form.getAll('file').filter((f): f is File => f instanceof File);
  if (uploads.length === 0) return { error: 'missing_file' };
  const files = await Promise.all(uploads.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') fields[k] = v;
  return { files, fields, totalBytes: files.reduce((s, f) => s + f.data.byteLength, 0), cleanup: async () => undefined };
}
