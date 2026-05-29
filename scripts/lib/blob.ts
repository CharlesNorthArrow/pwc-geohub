/**
 * Vercel Blob helpers — store cached GeoJSON off the function path (§11.9).
 *
 * @vercel/blob v2.x auto-resolves auth in this order:
 *   1. explicit `token` option
 *   2. process.env.BLOB_READ_WRITE_TOKEN
 *   3. OIDC: process.env.VERCEL_OIDC_TOKEN + process.env.BLOB_STORE_ID
 *
 * The Marketplace Blob integration provides (3) — no manual token required.
 */

import { put, list, del, type PutBlobResult } from '@vercel/blob';

function ensureAuthEnv(): void {
  if (
    !process.env.BLOB_READ_WRITE_TOKEN &&
    !(process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID)
  ) {
    throw new Error(
      'No Vercel Blob credentials in env. Either BLOB_READ_WRITE_TOKEN or ' +
        '(VERCEL_OIDC_TOKEN + BLOB_STORE_ID) must be set. Run `vercel env pull .env.local`.',
    );
  }
}

export async function putGeoJson(
  path: string,
  geojson: unknown,
): Promise<PutBlobResult> {
  ensureAuthEnv();
  return put(path, JSON.stringify(geojson), {
    access: 'public',
    contentType: 'application/geo+json',
    allowOverwrite: true,
  });
}

export async function deleteByPrefix(prefix: string): Promise<number> {
  ensureAuthEnv();
  let total = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor });
    if (page.blobs.length === 0) break;
    await del(page.blobs.map((b) => b.url));
    total += page.blobs.length;
    cursor = page.cursor;
  } while (cursor);
  return total;
}
