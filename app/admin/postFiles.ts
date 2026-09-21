import { upload } from '@vercel/blob/client';

/**
 * Vercel Functions reject request bodies over 4.5 MB, so large raw files go
 * browser → Vercel Blob first and the route receives their URLs (it reads
 * and deletes them). Small uploads keep the direct multipart post.
 */
const DIRECT_LIMIT = 4 * 1024 * 1024;

export async function postFiles(
  endpoint: string,
  files: readonly File[],
  fields: Record<string, string> = {},
): Promise<Response> {
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total < DIRECT_LIMIT) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const f of files) fd.append('file', f);
    return fetch(endpoint, { method: 'POST', body: fd });
  }
  const refs: Array<{ name: string; url: string }> = [];
  for (const f of files) {
    const blob = await upload(`admin-uploads/${f.name}`, f, {
      access: 'public',
      handleUploadUrl: '/api/admin/blob-upload',
      multipart: f.size > 8 * 1024 * 1024,
    });
    refs.push({ name: f.name, url: blob.url });
  }
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files: refs, fields }),
  });
}
