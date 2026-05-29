/**
 * Server-side data contract — spec §11.1.
 *
 * Every component reads through here; no component (and no API route)
 * goes around it to read a CSV or hit a federal API. All Phase 0 ETL
 * normalization (redaction sentinels, cohort→school_year mapping,
 * DBN remap) is already applied upstream.
 *
 * "Latest year per indicator" is read from the registry, not derived
 * from a query — the registry IS the source of truth for year coverage.
 */

import { sql } from './db';
import { INDICATORS, indicatorsById } from '../registry/indicators';
import type { IndicatorRegistryEntry } from '../registry/types';
import type {
  CommunityResponse,
  GeoArea,
  GeoFilterLayerId,
  GeoSelectionFeature,
  GeoSelectionResponse,
  GeographiesResponse,
  IndicatorPublic,
  PwcCategory,
  PwcMember,
  PwcResponse,
  SchoolFeature,
  SchoolMaster,
  SchoolsMasterResponse,
  SchoolsResponse,
} from '../contract/types';
import { GEO_FILTER_LAYERS } from '../contract/types';

/* -------------------------------------------------------------------------- */
/* Indicators                                                                 */
/* -------------------------------------------------------------------------- */

function toPublic(i: IndicatorRegistryEntry): IndicatorPublic {
  return {
    id: i.id,
    family: i.family,
    theme: i.theme,
    label: i.label,
    description: i.description,
    format: i.format,
    scale: {
      type: i.scale.type,
      good_direction: i.scale.good_direction,
      categories: i.scale.categories,
    },
    // Phase 1 only renders point + polygon families. Site (deferred crime) is filtered out.
    geometry: i.geometry === 'point' ? 'point' : 'polygon',
    years: [...i.years],
  };
}

/** All `active` indicators with a renderable geometry, sorted school-then-community. */
export function getActiveIndicators(): IndicatorPublic[] {
  return INDICATORS.filter(
    (i) => i.status === 'active' && (i.geometry === 'point' || i.geometry === 'polygon'),
  ).map(toPublic);
}

export function latestYear(id: string): string | null {
  const i = indicatorsById.get(id);
  if (!i || i.years.length === 0) return null;
  return i.years[i.years.length - 1] ?? null;
}

export function indicatorOrThrow(id: string): IndicatorRegistryEntry {
  const i = indicatorsById.get(id);
  if (!i) throw new Error(`Unknown indicator: ${id}`);
  return i;
}

/* -------------------------------------------------------------------------- */
/* School points                                                              */
/* -------------------------------------------------------------------------- */

interface SchoolRow {
  dbn: string;
  school_name: string | null;
  longitude: number | null;
  latitude: number | null;
  total_enrollment: number | null;
  value_num: number | null;
  value_text: string | null;
  label: string | null;
}

export async function getSchoolFeatures(
  indicatorId: string,
  year: string,
): Promise<SchoolsResponse> {
  const indicator = indicatorOrThrow(indicatorId);
  if (indicator.family !== 'school') {
    throw new Error(`Indicator ${indicatorId} is not a school indicator`);
  }

  const rows = await sql<SchoolRow>`
    SELECT
      s.dbn,
      s.school_name,
      s.longitude,
      s.latitude,
      sy.total_enrollment,
      siv.value_num,
      siv.value_text,
      siv.label
    FROM school_indicator_values siv
    JOIN schools s ON s.dbn = siv.dbn
    LEFT JOIN schools_year sy
      ON sy.dbn = siv.dbn AND sy.school_year = siv.school_year
    WHERE siv.indicator_id = ${indicatorId}
      AND siv.school_year = ${year}
      AND s.is_unplottable = false
  `;

  const features: SchoolFeature[] = [];
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    if (r.longitude == null || r.latitude == null) continue;
    if (r.value_num != null) {
      if (r.value_num < min) min = r.value_num;
      if (r.value_num > max) max = r.value_num;
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(r.longitude), Number(r.latitude)] },
      properties: {
        dbn: r.dbn,
        school_name: r.school_name,
        total_enrollment: r.total_enrollment,
        value_num: r.value_num,
        value_text: r.value_text,
        label: r.label,
      },
    });
  }

  return {
    type: 'FeatureCollection',
    indicator_id: indicatorId,
    year,
    domain: Number.isFinite(min) ? { min, max } : null,
    features,
  };
}

/* -------------------------------------------------------------------------- */
/* Community values (tract → value map)                                       */
/* -------------------------------------------------------------------------- */

interface CommunityRow {
  area_id: string;
  value_num: number | null;
  value_text: string | null;
}

export async function getCommunityValues(
  indicatorId: string,
  year: string,
): Promise<CommunityResponse> {
  const indicator = indicatorOrThrow(indicatorId);
  if (indicator.family !== 'community') {
    throw new Error(`Indicator ${indicatorId} is not a community indicator`);
  }

  const rows = await sql<CommunityRow>`
    SELECT area_id, value_num, value_text
    FROM community_indicator_values
    WHERE indicator_id = ${indicatorId}
      AND year = ${year}
      AND geo_layer = 'tract'
  `;

  // Categorical indicators (e.g. racial_predominance) populate BOTH columns at
  // ETL time — value_num holds the argmax count, value_text holds the category
  // label. The legend/painting needs the label, so we prefer it for
  // categorical scales and fall back to the numeric column otherwise.
  const isCategorical = indicator.scale.type === 'categorical';
  const values: Record<string, number | string | null> = {};
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    if (isCategorical) {
      values[r.area_id] = r.value_text ?? null;
      continue;
    }
    if (r.value_num != null) {
      values[r.area_id] = r.value_num;
      if (r.value_num < min) min = r.value_num;
      if (r.value_num > max) max = r.value_num;
    } else if (r.value_text != null) {
      values[r.area_id] = r.value_text;
    } else {
      values[r.area_id] = null;
    }
  }

  return {
    indicator_id: indicatorId,
    year,
    values,
    domain: isCategorical || !Number.isFinite(min) ? null : { min, max },
    categories: indicator.scale.categories,
  };
}

/* -------------------------------------------------------------------------- */
/* PWC membership (Phase 2)                                                   */
/* -------------------------------------------------------------------------- */

interface PwcRow {
  dbn: string;
  core_school: boolean | null;
  arts_program: boolean | null;
  cohort: string | null;
}

/**
 * One snapshot of PWC programmatic categorization at `year`.
 *
 * - "active" = at least one program field is non-null (so the all-null
 *   placeholder rows from 2020-21 / 2021-22 are excluded; spec §3.5).
 * - Q1 default applied: Anchor = core_school=true; Healing Arts = arts_program=true.
 * - Both-category schools (core_school=true AND arts_program=true) get
 *   category='both' — they render with dual halos and appear in BOTH the
 *   Anchor and Healing Arts group filters (confirmed in goal).
 * - "pwc_other" = active but neither Anchor nor Healing Arts (rare — community
 *   school / food pantry / etc.). Appears under "Only PWC" but not under the
 *   two specific buckets.
 *
 * 03M299 (Maxine Greene, closed ~2023) is excluded from this layer by virtue
 * of the schools FK on `pwc_school_program`; the data-quality report carries
 * the trail (spec §12 Q2 default).
 */
export async function getPwcMembership(year: string): Promise<PwcResponse> {
  const rows = await sql<PwcRow>`
    SELECT dbn, core_school, arts_program, cohort
    FROM pwc_school_program
    WHERE school_year = ${year}
      AND (
        core_school IS NOT NULL
        OR arts_program IS NOT NULL
        OR social_work_program IS NOT NULL
        OR community_school_program IS NOT NULL
        OR ost_program IS NOT NULL
        OR food_pantry IS NOT NULL
        OR laundry IS NOT NULL
      )
  `;
  const members: PwcMember[] = rows.map((r) => {
    const isAnchor = r.core_school === true;
    const isArts = r.arts_program === true;
    let category: PwcCategory;
    if (isAnchor && isArts) category = 'both';
    else if (isAnchor) category = 'anchor';
    else if (isArts) category = 'healing_arts';
    else category = 'pwc_other';
    return { dbn: r.dbn, category, cohort: r.cohort };
  });
  return { year, members };
}

/* -------------------------------------------------------------------------- */
/* Schools master + geographies (Phase 3 filter universe)                     */
/* -------------------------------------------------------------------------- */

interface SchoolMasterRow {
  dbn: string;
  school_name: string | null;
  borough: string | null;
  /** PostGIS array_agg of `geo_layer:area_id` pairs, one per crosswalk hit. */
  geo_pairs: string[] | null;
}

/**
 * The schools universe used by the Phase 3 cascade. Excludes unplottable
 * (no lat/lng) schools by definition; includes their crosswalk memberships
 * for the 6 §6.1 Geo filter layers in a single round-trip. ~1,779 rows.
 *
 * Selected schools without a crosswalk for a given layer (e.g. ~85 Bronx
 * charter/D75 schools that fall outside the 32 school-district polygons)
 * simply have that layer missing from `geos`. Components decide whether to
 * treat that as "not in any selected district" (current) or to soft-include.
 */
export async function getSchoolsMaster(): Promise<SchoolsMasterResponse> {
  const layerIds = GEO_FILTER_LAYERS.map((l) => l.id);
  const rows = await sql<SchoolMasterRow>`
    SELECT s.dbn, s.school_name, s.borough,
      ARRAY(
        SELECT c.geo_layer || ':' || c.area_id
        FROM school_geo_crosswalk c
        WHERE c.dbn = s.dbn
          AND c.geo_layer = ANY(${layerIds}::text[])
      ) AS geo_pairs
    FROM schools s
    WHERE s.is_unplottable = false
    ORDER BY s.school_name NULLS LAST, s.dbn
  `;
  const schools: SchoolMaster[] = rows.map((r) => {
    const geos: Partial<Record<GeoFilterLayerId, string>> = {};
    for (const pair of r.geo_pairs ?? []) {
      const idx = pair.indexOf(':');
      if (idx < 0) continue;
      const layer = pair.slice(0, idx) as GeoFilterLayerId;
      const area = pair.slice(idx + 1);
      geos[layer] = area;
    }
    return { dbn: r.dbn, school_name: r.school_name, borough: r.borough, geos };
  });
  return { schools };
}

interface GeoAreaRow {
  geo_layer: GeoFilterLayerId;
  area_id: string;
  label: string | null;
  attributes: Record<string, string | null> | null;
}

/** All §6.1 layers + their area options for the Geo popup. Attributes carry
 *  per-layer extras (e.g. Assembly Name + Party) when the upstream
 *  ArcGIS feature exposes them — see `passthrough_fields` in the geo registry. */
export async function getGeographies(): Promise<GeographiesResponse> {
  const layerIds = GEO_FILTER_LAYERS.map((l) => l.id);
  const rows = await sql<GeoAreaRow>`
    SELECT geo_layer, area_id, label, attributes
    FROM geographies
    WHERE geo_layer = ANY(${layerIds}::text[])
    ORDER BY geo_layer, label NULLS LAST, area_id
  `;
  const layers: Record<GeoFilterLayerId, GeoArea[]> = {
    county: [],
    senate: [],
    assembly: [],
    congressional: [],
    council: [],
    school_district: [],
    community_district: [],
  };
  for (const r of rows) {
    layers[r.geo_layer]?.push({
      area_id: r.area_id,
      label: r.label ?? r.area_id,
      attributes: r.attributes ?? {},
    });
  }
  return { layers };
}

/* -------------------------------------------------------------------------- */
/* Selected-geographies overlay                                               */
/* -------------------------------------------------------------------------- */

interface SelectionRow {
  geo_layer: GeoFilterLayerId;
  area_id: string;
  label: string | null;
  /** ST_AsGeoJSON output — a GeoJSON geometry string. */
  geom: string;
}

/**
 * Returns the polygons for a user's current Geo-filter selections so the
 * map can outline what's in scope. Two parallel arrays (layers / areas)
 * encode the (layer, area_id) pairs; we unnest them in SQL and join against
 * `geographies` for the exact matches — no over-fetching.
 */
export async function getSelectedGeometries(
  picks: Partial<Record<GeoFilterLayerId, string[]>>,
): Promise<GeoSelectionResponse> {
  const layers: GeoFilterLayerId[] = [];
  const areaIds: string[] = [];
  for (const layer of GEO_FILTER_LAYERS) {
    const ids = picks[layer.id];
    if (!ids || ids.length === 0) continue;
    for (const id of ids) {
      layers.push(layer.id);
      areaIds.push(id);
    }
  }
  if (layers.length === 0) {
    return { type: 'FeatureCollection', features: [], intersectingTractGeoids: [] };
  }
  // 1. Pull each selected polygon as GeoJSON for the outline overlay.
  const rows = await sql<SelectionRow>`
    SELECT g.geo_layer, g.area_id, g.label, ST_AsGeoJSON(g.geom) AS geom
    FROM geographies g
    JOIN unnest(${layers}::text[], ${areaIds}::text[]) AS p(layer, area)
      ON g.geo_layer = p.layer AND g.area_id = p.area
  `;
  const features: GeoSelectionFeature[] = [];
  for (const r of rows) {
    let geometry: GeoSelectionFeature['geometry'];
    try {
      geometry = JSON.parse(r.geom) as GeoSelectionFeature['geometry'];
    } catch {
      continue;
    }
    features.push({
      type: 'Feature',
      geometry,
      properties: { geo_layer: r.geo_layer, area_id: r.area_id, label: r.label },
    });
  }

  // 2. Compute the census-tract GEOIDs that fall WITHIN or OVERLAP the
  //    selection. We mirror the schools cascade — within a layer = UNION,
  //    across layers = INTERSECTION — so a tract is included only if it
  //    intersects at least one selected polygon in EVERY layer that has
  //    selections. Implemented as count-distinct over layers per tract.
  const distinctLayerCount = new Set(layers).size;
  const tractRows = await sql<{ area_id: string }>`
    WITH selected AS (
      SELECT g.geo_layer, g.geom
      FROM geographies g
      JOIN unnest(${layers}::text[], ${areaIds}::text[]) AS p(layer, area)
        ON g.geo_layer = p.layer AND g.area_id = p.area
    ),
    per_tract_layer AS (
      SELECT t.area_id AS tract_id, s.geo_layer
      FROM geographies t
      JOIN selected s ON ST_Intersects(t.geom, s.geom)
      WHERE t.geo_layer = 'tract'
      GROUP BY t.area_id, s.geo_layer
    )
    SELECT tract_id AS area_id
    FROM per_tract_layer
    GROUP BY tract_id
    HAVING COUNT(DISTINCT geo_layer) = ${distinctLayerCount}
  `;
  const intersectingTractGeoids = tractRows.map((r) => r.area_id);

  return { type: 'FeatureCollection', features, intersectingTractGeoids };
}

/* -------------------------------------------------------------------------- */
/* Tract polygon URL (cached in Blob by ETL 22)                               */
/* -------------------------------------------------------------------------- */

interface TractFinding {
  blob_url: string | null;
}

/**
 * Resolves the public Blob URL of the cached tract GeoJSON written by
 * `scripts/etl/22-fetch-tracts.ts`. We read it from `data_quality_findings`
 * so there's no env-var dance — the URL is already persisted from the ETL run.
 */
export async function getTractBlobUrl(): Promise<string | null> {
  const rows = await sql<{ details: TractFinding }>`
    SELECT details
    FROM data_quality_findings
    WHERE category = 'ingestion_summary'
      AND subject = 'geography:tract'
    ORDER BY run_id DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rows[0]?.details?.blob_url ?? null;
}
