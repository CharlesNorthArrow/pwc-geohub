import { NextResponse, type NextRequest } from 'next/server';
import { getSelectedGeometries } from '../../../../src/server/contract';
import { GEO_FILTER_LAYERS, type GeoFilterLayerId } from '../../../../src/contract/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_LAYERS = new Set<string>(GEO_FILTER_LAYERS.map((l) => l.id));

/**
 * GET /api/geo/selection?picks=<json> → polygons for the selected (layer,
 * area_id) pairs, ready to overlay on the map. `picks` is a JSON-encoded
 * `Partial<Record<GeoFilterLayerId, string[]>>` (e.g.
 *   `{"council":["1","13"],"assembly":["79"]}`).
 *
 * GET (with URL-encoded JSON) keeps the route cache-friendly. The endpoint
 * is small enough that a `picks` string of any realistic length fits.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const raw = req.nextUrl.searchParams.get('picks');
  if (!raw) {
    return NextResponse.json({ type: 'FeatureCollection', features: [], intersectingTractGeoids: [] });
  }
  let parsed: Partial<Record<GeoFilterLayerId, string[]>>;
  try {
    parsed = JSON.parse(raw) as Partial<Record<GeoFilterLayerId, string[]>>;
  } catch {
    return NextResponse.json({ error: 'bad ?picks= json' }, { status: 400 });
  }
  // Defensive: drop keys that aren't real layer ids.
  const safe: Partial<Record<GeoFilterLayerId, string[]>> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!VALID_LAYERS.has(k) || !Array.isArray(v)) continue;
    safe[k as GeoFilterLayerId] = v.map(String);
  }
  const fc = await getSelectedGeometries(safe);
  return NextResponse.json(fc);
}
