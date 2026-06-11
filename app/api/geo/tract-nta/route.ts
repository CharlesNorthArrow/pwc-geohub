import { NextResponse } from 'next/server';
import { getTractNtaCrosswalk } from '../../../../src/server/contract';

export const runtime = 'nodejs';
// One-shot reference data; safe to cache for the lifetime of a deployment.
// Re-runs of ETL 22 (tracts) or 20 (NTAs) invalidate naturally on redeploy.
export const dynamic = 'force-static';
export const revalidate = 3600;

/**
 * Returns `{ tracts: { [tract_geoid]: { nta_id, nta_name } } }`.
 *
 * Consumed by the community-polygon hover tooltip in `<MapView/>` — see
 * `getTractNtaCrosswalk` for the centroid-within join rationale. Empty `tracts`
 * is a valid response when the geographies table has no tract or NTA layers
 * loaded yet (caller surfaces no tooltip name in that case).
 */
export async function GET(): Promise<NextResponse> {
  const tracts = await getTractNtaCrosswalk();
  return NextResponse.json({ tracts });
}
