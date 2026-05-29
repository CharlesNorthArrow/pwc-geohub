/**
 * ArcGIS Feature Service helper.
 *
 * Pulls every feature from a layer 0 endpoint as GeoJSON. Pages through using
 * resultOffset/resultRecordCount because most public services cap at 1000–2000
 * features per request.
 */

/* Minimal GeoJSON shapes we need (avoids the @types/geojson dependency). */
export type Position = number[];
export type PolygonCoords = Position[][];
export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: PolygonCoords;
}
export interface GeoJsonMultiPolygon {
  type: 'MultiPolygon';
  coordinates: PolygonCoords[];
}
export type AnyGeometry =
  | GeoJsonPolygon
  | GeoJsonMultiPolygon
  | { type: string; coordinates: unknown };

export interface ArcGisFeatureCollection {
  type: 'FeatureCollection';
  features: ArcGisFeature[];
}

export interface ArcGisFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: AnyGeometry | null;
}

interface FetchAllOptions {
  where?: string;
  outFields?: string;
  pageSize?: number;
  maxPages?: number;
}

export async function fetchAllFeatures(
  layerUrl: string,
  opts: FetchAllOptions = {},
): Promise<ArcGisFeatureCollection> {
  const where = opts.where ?? '1=1';
  const outFields = opts.outFields ?? '*';
  const pageSize = opts.pageSize ?? 1000;
  const maxPages = opts.maxPages ?? 200;

  const features: ArcGisFeature[] = [];
  let offset = 0;
  let page = 0;
  let exceededTransferLimit = true;

  while (exceededTransferLimit && page < maxPages) {
    const url = new URL(`${layerUrl}/query`);
    url.searchParams.set('where', where);
    url.searchParams.set('outFields', outFields);
    url.searchParams.set('outSR', '4326');
    url.searchParams.set('f', 'geojson');
    url.searchParams.set('returnGeometry', 'true');
    url.searchParams.set('resultRecordCount', String(pageSize));
    url.searchParams.set('resultOffset', String(offset));

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`ArcGIS fetch failed (${res.status}) for ${url.toString()}`);
    }
    const body = (await res.json()) as ArcGisFeatureCollection & {
      exceededTransferLimit?: boolean;
      properties?: { exceededTransferLimit?: boolean };
    };
    if (!body.features) {
      throw new Error(`ArcGIS response missing features for ${url.toString()}`);
    }
    features.push(...body.features);

    exceededTransferLimit =
      body.exceededTransferLimit === true ||
      body.properties?.exceededTransferLimit === true ||
      body.features.length === pageSize;

    offset += body.features.length;
    page += 1;
    if (body.features.length === 0) break;
  }

  return { type: 'FeatureCollection', features };
}
