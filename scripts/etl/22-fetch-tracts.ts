/**
 * ETL 22 — fetch NYC census-tract polygons (TIGER 2020) → Neon `geographies`
 * + Vercel Blob GeoJSON.
 *
 * Phase 0 backfill: community-indicator values are keyed to 11-digit tract
 * GEOIDs (loaded by 30-fetch-acs / 31-fetch-cdc-places) but the tract polygons
 * themselves were not cached in the original Phase 0 run. Phase 1 needs them
 * to render the community choropleth, so we add this one-shot step here
 * (spec §11.6 — "geographies as a cached tile/GeoJSON service").
 *
 * Source: TIGERweb Census 2020 Tracts MapServer. We try a small list of known
 * endpoints in order and use the first one that returns features. Filter to
 * NY state (STATE='36') + the 5 NYC county FIPS server-side.
 *
 * Result keys: `area_id = GEOID` (11 digits, e.g. '36005000100') — matches
 * the `community_indicator_values.area_id` produced by ETL 30/31.
 */

import { fetchAllFeatures, type ArcGisFeatureCollection } from '../lib/arcgis.js';
import { db } from '../lib/db.js';
import { putGeoJson } from '../lib/blob.js';
import { recordFinding } from '../lib/findings.js';
import { NY_STATE_FIPS, NYC_COUNTY_FIPS } from '../../src/registry/geographies.js';

const TRACT_LAYER_ID = 'tract' as const;

/**
 * Try-in-order list of TIGERweb tract endpoints. Census occasionally renumbers
 * layers between vintages; falling through to the next URL is cheaper than
 * arguing with a 404. All return identical fields (STATE, COUNTY, TRACT, GEOID,
 * BASENAME, NAME) for Census 2020 tracts.
 */
const TRACT_ENDPOINTS: readonly string[] = [
  // 2020-vintage generalized boundaries (smaller, designed for thematic maps).
  'https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2023/Tracts_Blocks/MapServer/0',
  'https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2022/Tracts_Blocks/MapServer/0',
  // Un-generalized TIGER 2020 tracts (~10MB at full detail across NYC).
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0',
];

const COUNTY_WHERE = `STATE='${NY_STATE_FIPS}' AND COUNTY IN (${Object.keys(NYC_COUNTY_FIPS)
  .map((c) => `'${c}'`)
  .join(',')})`;

async function fetchFromAnyEndpoint(): Promise<{
  fc: ArcGisFeatureCollection;
  endpoint: string;
}> {
  let lastErr: unknown;
  for (const url of TRACT_ENDPOINTS) {
    try {
      console.log(`[etl:tracts] trying ${url} where ${COUNTY_WHERE}`);
      const fc = await fetchAllFeatures(url, { where: COUNTY_WHERE });
      if (fc.features.length === 0) {
        console.warn(`[etl:tracts] ${url} returned 0 features; trying next endpoint`);
        continue;
      }
      return { fc, endpoint: url };
    } catch (err) {
      lastErr = err;
      console.warn(`[etl:tracts] ${url} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw lastErr ?? new Error('All TIGER tract endpoints failed');
}

function toMultiPolygonJson(geom: ArcGisFeatureCollection['features'][number]['geometry']): string | null {
  if (!geom) return null;
  if (geom.type === 'Polygon') {
    return JSON.stringify({ type: 'MultiPolygon', coordinates: [geom.coordinates] });
  }
  if (geom.type === 'MultiPolygon') return JSON.stringify(geom);
  return null;
}

async function persistToNeon(fc: ArcGisFeatureCollection): Promise<{ inserted: number; skipped: number }> {
  const sql = db();
  let inserted = 0;
  let skipped = 0;

  for (const f of fc.features) {
    const props = f.properties ?? {};
    const geoid = props['GEOID'];
    if (geoid == null || String(geoid).length !== 11) {
      skipped++;
      continue;
    }
    const mp = toMultiPolygonJson(f.geometry);
    if (!mp) {
      skipped++;
      continue;
    }
    const label = String(props['NAMELSAD'] ?? props['NAME'] ?? props['BASENAME'] ?? geoid);
    const attrs = {
      STATE: props['STATE'] ?? null,
      COUNTY: props['COUNTY'] ?? null,
      TRACT: props['TRACT'] ?? null,
      BASENAME: props['BASENAME'] ?? null,
      NAME: props['NAME'] ?? null,
    };

    await sql`
      INSERT INTO geographies (geo_layer, area_id, label, attributes, geom, fetched_at)
      VALUES (
        ${TRACT_LAYER_ID},
        ${String(geoid)},
        ${label},
        ${JSON.stringify(attrs)}::jsonb,
        ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${mp}), 4326)),
        now()
      )
      ON CONFLICT (geo_layer, area_id) DO UPDATE SET
        label = EXCLUDED.label,
        attributes = EXCLUDED.attributes,
        geom = EXCLUDED.geom,
        fetched_at = EXCLUDED.fetched_at
    `;
    inserted++;
  }
  return { inserted, skipped };
}

/**
 * Trim the GeoJSON we publish to Blob — the map only needs GEOID + geometry.
 * Drops the TIGER columns (GEOIDFQ, OBJECTID, INTPTLAT, AREALAND, …) that
 * blow up the file size for no UI benefit.
 */
function leanForBlob(fc: ArcGisFeatureCollection): ArcGisFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        GEOID: String((f.properties ?? {})['GEOID'] ?? ''),
      },
    })),
  };
}

async function main(): Promise<void> {
  const { fc, endpoint } = await fetchFromAnyEndpoint();
  console.log(`[etl:tracts] ${fc.features.length} features from ${endpoint}`);

  const { inserted, skipped } = await persistToNeon(fc);
  console.log(`[etl:tracts] Neon: ${inserted} inserted, ${skipped} skipped`);

  const lean = leanForBlob(fc);
  const blobPath = 'geographies/tract.geojson';
  let blobUrl: string | undefined;
  try {
    const result = await putGeoJson(blobPath, lean);
    blobUrl = result.url;
    console.log(`[etl:tracts] Blob: ${result.url}`);
  } catch (err) {
    console.warn(`[etl:tracts] Blob upload failed (non-fatal): ${err instanceof Error ? err.message : err}`);
  }

  await recordFinding('ingestion_summary', 'geography:tract', {
    features_fetched: fc.features.length,
    features_inserted: inserted,
    features_skipped: skipped,
    source_endpoint: endpoint,
    blob_url: blobUrl ?? null,
  });

  console.log('[etl:tracts] done.');
}

main().catch((err) => {
  console.error('[etl:tracts] failed:', err);
  process.exit(1);
});
