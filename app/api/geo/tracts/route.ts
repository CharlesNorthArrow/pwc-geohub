import { NextResponse } from 'next/server';
import { getTractBlobUrl } from '../../../../src/server/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Returns `{ url }` pointing at the cached tract GeoJSON in Vercel Blob.
 * The browser fetches the large polygon payload directly from Blob (CDN),
 * keeping it off the serverless function path — spec §11.9 serverless-fit rules.
 */
export async function GET(): Promise<NextResponse> {
  const url = await getTractBlobUrl();
  if (!url) {
    return NextResponse.json(
      { error: 'tract polygons not loaded; run `npm run etl:tracts`' },
      { status: 503 },
    );
  }
  return NextResponse.json({ url });
}
