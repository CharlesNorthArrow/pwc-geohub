/**
 * Vercel Blob helpers — store cached GeoJSON off the function path (§11.9).
 */

import { put, list, del, type PutBlobResult } from '@vercel/blob';

function requireToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      'BLOB_READ_WRITE_TOKEN is not set. Provision a Vercel Blob store and run ' +
        '`vercel env pull .env.local`.',
    );
  }
  return token;
}

/**
 * Put a JSON object at a deterministic path. The v0.27 SDK has no
 * `allowOverwrite`, so we delete any existing blobs at this exact path first.
 */
export async function putGeoJson(
  path: string,
  geojson: unknown,
): Promise<PutBlobResult> {
  const token = requireToken();
  await deleteExact(path, token);
  return put(path, JSON.stringify(geojson), {
    access: 'public',
    contentType: 'application/geo+json',
    addRandomSuffix: false,
    token,
  });
}

async function deleteExact(path: string, token: string): Promise<void> {
  // The Blob list API is prefix-based; we match the exact pathname.
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: path, cursor, token });
    const exact = page.blobs.filter((b) => b.pathname === path);
    if (exact.length > 0) {
      await del(
        exact.map((b) => b.url),
        { token },
      );
    }
    cursor = page.cursor;
  } while (cursor);
}

export async function deleteByPrefix(prefix: string): Promise<number> {
  const token = requireToken();
  let total = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, token });
    if (page.blobs.length === 0) break;
    await del(
      page.blobs.map((b) => b.url),
      { token },
    );
    total += page.blobs.length;
    cursor = page.cursor;
  } while (cursor);
  return total;
}
