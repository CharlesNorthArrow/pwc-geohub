/**
 * ETL 20 — fetch 8 ArcGIS boundary layers → Neon `geographies` + Blob GeoJSON.
 *
 * Each layer is fetched once, projected to EPSG:4326 (we already request it
 * that way), normalized to a MultiPolygon, written to:
 *   - Postgres for spatial joins (school↔polygon crosswalks, future filters).
 *   - Vercel Blob as GeoJSON so the future map UI loads from CDN, not functions.
 *
 * Filtering rules:
 *   - Senate + Congressional are national layers → we filter to NY (STATEFP=36).
 *   - All NYC-only layers come pre-filtered to NYC by their source service.
 *   - The `county` layer is built from Census TIGERweb (5 NYC county FIPS).
 */

import { db } from '../lib/db.js';
import {
  fetchAllFeatures,
  type ArcGisFeatureCollection,
  type ArcGisFeature,
  type AnyGeometry,
  type GeoJsonMultiPolygon,
} from '../lib/arcgis.js';
import { putGeoJson } from '../lib/blob.js';
import { recordFinding } from '../lib/findings.js';
import {
  GEO_LAYERS,
  type GeoLayerConfig,
  NY_STATE_FIPS,
  NYC_COUNTY_FIPS,
  TIGER_COUNTIES_URL,
} from '../../src/registry/geographies.js';

function toMultiPolygonWkt(geom: AnyGeometry | null): string | null {
  if (!geom) return null;
  // PostGIS reads GeoJSON directly via ST_GeomFromGeoJSON; we just ensure
  // MultiPolygon by promoting Polygon if needed.
  if (geom.type === 'Polygon') {
    const mp: GeoJsonMultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [geom.coordinates as number[][][]],
    };
    return JSON.stringify(mp);
  }
  if (geom.type === 'MultiPolygon') return JSON.stringify(geom);
  return null; // skip non-polygon geometries
}

function filterByLayer(layer: GeoLayerConfig, features: ArcGisFeature[]): ArcGisFeature[] {
  if (layer.id === 'senate') {
    return features.filter((f) => {
      const p = f.properties;
      const stateFp = String(p['STATEFP'] ?? p['STATE_FIPS'] ?? '');
      return stateFp === NY_STATE_FIPS;
    });
  }
  if (layer.id === 'congressional') {
    return features.filter((f) => {
      const p = f.properties;
      const stateFp = String(p['STATEFP'] ?? p['STATE_FIPS'] ?? '');
      return stateFp === NY_STATE_FIPS;
    });
  }
  return features;
}

async function fetchCounties(): Promise<ArcGisFeatureCollection> {
  // TIGERweb counties: filter to NY state + NYC counties.
  const where = `STATE='${NY_STATE_FIPS}' AND COUNTY IN (${Object.keys(NYC_COUNTY_FIPS)
    .map((c) => `'${c}'`)
    .join(',')})`;
  return fetchAllFeatures(TIGER_COUNTIES_URL, { where });
}

async function persistLayer(
  layer: GeoLayerConfig,
  fc: ArcGisFeatureCollection,
): Promise<{ inserted: number; skipped: number }> {
  const sql = db();
  let inserted = 0;
  let skipped = 0;

  for (const f of fc.features) {
    const props = f.properties ?? {};
    const id = props[layer.id_field];
    const label = props[layer.label_field];
    if (id == null) {
      skipped++;
      continue;
    }
    const mpJson = toMultiPolygonWkt(f.geometry);
    if (!mpJson) {
      skipped++;
      continue;
    }
    const attributes: Record<string, unknown> = {};
    if (layer.passthrough_fields) {
      for (const k of layer.passthrough_fields) attributes[k] = props[k] ?? null;
    }

    await sql`
      INSERT INTO geographies (geo_layer, area_id, label, attributes, geom, fetched_at)
      VALUES (
        ${layer.id},
        ${String(id)},
        ${label != null ? String(label) : null},
        ${JSON.stringify(attributes)}::jsonb,
        ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${mpJson}), 4326)),
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

async function processLayer(layer: GeoLayerConfig): Promise<void> {
  console.log(`[etl:geos] ${layer.id} ←`, layer.feature_service_url ?? 'TIGERweb counties');
  let fc: ArcGisFeatureCollection;
  if (layer.id === 'county') {
    fc = await fetchCounties();
  } else if (layer.feature_service_url) {
    fc = await fetchAllFeatures(layer.feature_service_url);
    fc.features = filterByLayer(layer, fc.features);
  } else {
    throw new Error(`No source URL for layer ${layer.id}`);
  }

  const { inserted, skipped } = await persistLayer(layer, fc);

  // Mirror to Blob as GeoJSON (the map UI reads this in later phases).
  const blobPath = `geographies/${layer.id}.geojson`;
  try {
    const result = await putGeoJson(blobPath, fc);
    await recordFinding('ingestion_summary', `geography:${layer.id}`, {
      features_fetched: fc.features.length,
      features_inserted: inserted,
      features_skipped: skipped,
      blob_url: result.url,
    });
    console.log(
      `[etl:geos] ${layer.id}: ${inserted} inserted, ${skipped} skipped, blob ${result.url}`,
    );
  } catch (err) {
    // Blob is non-fatal at this stage; record so the DQ report flags it.
    await recordFinding('ingestion_summary', `geography:${layer.id}`, {
      features_fetched: fc.features.length,
      features_inserted: inserted,
      features_skipped: skipped,
      blob_error: String(err),
    });
    console.warn(`[etl:geos] ${layer.id}: blob upload failed:`, err);
  }
}

async function main(): Promise<void> {
  for (const layer of GEO_LAYERS) {
    await processLayer(layer);
  }
  console.log('[etl:geos] done.');
}

main().catch((err) => {
  console.error('[etl:geos] failed:', err);
  process.exit(1);
});
