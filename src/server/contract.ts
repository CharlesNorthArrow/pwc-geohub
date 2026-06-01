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
  AggregationArea,
  AnalyticsSeriesResponse,
  AnalyticsSeriesRow,
  CommunityResponse,
  GeoArea,
  GeoFilterLayerId,
  GeoSelectionFeature,
  GeoSelectionResponse,
  GeographiesResponse,
  IndicatorPublic,
  PwcCategory,
  PwcHistoryResponse,
  PwcMember,
  PwcProgram,
  PwcProgramResponse,
  PwcResponse,
  SchoolFeature,
  SchoolMaster,
  SchoolProfile,
  SchoolProfileResponse,
  SchoolsMasterResponse,
  SchoolsResponse,
} from '../contract/types';
import { GEO_FILTER_LAYERS } from '../contract/types';

/* -------------------------------------------------------------------------- */
/* Indicators                                                                 */
/* -------------------------------------------------------------------------- */

function describeSource(i: IndicatorRegistryEntry): string {
  // Prefer the curated public-facing label from the Public Data Wishlist when
  // present (school indicators). Falls back to the technical source string.
  if (i.data_source) return i.data_source;
  switch (i.source.type) {
    case 'hosted':
      return `PWC-hosted: ${i.source.dataset}`;
    case 'api':
      if (i.source.provider === 'acs5') {
        return `US Census ACS 5-yr — table ${i.source.table} (${i.source.endpoint})`;
      }
      return `CDC PLACES — measure ${i.source.measure_id} (${i.source.resource})`;
    case 'deferred':
      return `Deferred — planned: ${i.source.planned_method}`;
  }
}

function toPublic(i: IndicatorRegistryEntry): IndicatorPublic {
  return {
    id: i.id,
    family: i.family,
    theme: i.theme,
    label: i.label,
    short_label: i.short_label,
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
    source_description: describeSource(i),
    source_url: i.data_source_url,
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
 * Map raw program flags → `PwcCategory`. Spec §12 Q1 default: a school is
 * 'both' when core_school AND arts_program are true, 'anchor' when only
 * core_school, 'healing_arts' when only arts_program, 'pwc_other' otherwise.
 *
 * Lives here (server-side) because the client never sees the raw boolean
 * flags — it only consumes the derived category. The client-side
 * `belongsToPwcGroup` predicate consumes this output.
 */
function pwcCategoryFromFlags(
  core_school: boolean | null,
  arts_program: boolean | null,
): PwcCategory {
  const isAnchor = core_school === true;
  const isArts = arts_program === true;
  if (isAnchor && isArts) return 'both';
  if (isAnchor) return 'anchor';
  if (isArts) return 'healing_arts';
  return 'pwc_other';
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
  const members: PwcMember[] = rows.map((r) => ({
    dbn: r.dbn,
    category: pwcCategoryFromFlags(r.core_school, r.arts_program),
    cohort: r.cohort,
  }));
  return { year, members };
}

/* -------------------------------------------------------------------------- */
/* Schools master + geographies (Phase 3 filter universe)                     */
/* -------------------------------------------------------------------------- */

interface SchoolMasterRow {
  dbn: string;
  school_name: string | null;
  borough: string | null;
  longitude: number | null;
  latitude: number | null;
  total_enrollment: number | null;
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
    SELECT s.dbn, s.school_name, s.borough, s.longitude, s.latitude,
      -- Latest non-null enrollment across all known school_year rows.
      (
        SELECT sy.total_enrollment
        FROM schools_year sy
        WHERE sy.dbn = s.dbn AND sy.total_enrollment IS NOT NULL
        ORDER BY sy.school_year DESC
        LIMIT 1
      ) AS total_enrollment,
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
    return {
      dbn: r.dbn,
      school_name: r.school_name,
      borough: r.borough,
      // is_unplottable=false guarantees both coords; assert via Number() so
      // string-typed numerics from the driver stay typed as number.
      longitude: Number(r.longitude),
      latitude: Number(r.latitude),
      total_enrollment: r.total_enrollment,
      geos,
    };
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

/**
 * Full per-year PWC membership map. Drives the Phase 5 timeline so historical
 * Anchor / Healing Arts averages reflect each year's actual membership, not
 * just the current snapshot. Same active-row rule as `getPwcMembership`.
 */
export async function getPwcHistory(): Promise<PwcHistoryResponse> {
  const rows = await sql<{
    dbn: string;
    year: string;
    core_school: boolean | null;
    arts_program: boolean | null;
    cohort: string | null;
  }>`
    SELECT dbn, school_year AS year, core_school, arts_program, cohort
    FROM pwc_school_program
    WHERE core_school IS NOT NULL
       OR arts_program IS NOT NULL
       OR social_work_program IS NOT NULL
       OR community_school_program IS NOT NULL
       OR ost_program IS NOT NULL
       OR food_pantry IS NOT NULL
       OR laundry IS NOT NULL
  `;
  const byYear: Record<string, PwcMember[]> = {};
  for (const r of rows) {
    const category = pwcCategoryFromFlags(r.core_school, r.arts_program);
    (byYear[r.year] ??= []).push({ dbn: r.dbn, category, cohort: r.cohort });
  }
  return { byYear };
}

/* -------------------------------------------------------------------------- */
/* Phase 5 analytics — series for KPI/timeline/list                           */
/* -------------------------------------------------------------------------- */

/**
 * One row per (school, year) for the active indicator.
 *
 * - School indicator: raw school_indicator_values reads.
 * - Community indicator: per-school AVG over tracts intersecting the school's
 *   surrounding `aggArea` polygon. The two crosswalks pre-join the spatial
 *   work so this is a thin GROUP BY at request time (spec §11.9).
 *
 * Schools without a crosswalk row for the chosen aggArea (e.g. ~85 Bronx
 * schools missing school_district crosswalks per the Phase 3 data-quality
 * note) silently drop out — the panel doesn't fabricate values.
 */
export async function getAnalyticsSeries(
  indicatorId: string,
  aggArea: AggregationArea | null,
): Promise<AnalyticsSeriesResponse> {
  const indicator = indicatorOrThrow(indicatorId);
  if (indicator.family === 'school') {
    const rows = await sql<AnalyticsSeriesRow>`
      SELECT siv.dbn, siv.school_year AS year,
             siv.value_num, siv.value_text, siv.label
      FROM school_indicator_values siv
      JOIN schools s ON s.dbn = siv.dbn
      WHERE siv.indicator_id = ${indicatorId}
        AND s.is_unplottable = false
    `;
    return {
      indicator_id: indicatorId,
      family: 'school',
      agg_area: null,
      series: rows,
    };
  }
  // Community indicator — aggregate per school via the chosen area's tracts.
  if (!aggArea) {
    return {
      indicator_id: indicatorId,
      family: 'community',
      agg_area: null,
      series: [],
    };
  }
  const rows = await sql<AnalyticsSeriesRow>`
    SELECT s.dbn,
           civ.year,
           AVG(civ.value_num) AS value_num,
           NULL::text AS value_text,
           NULL::text AS label
    FROM schools s
    JOIN school_geo_crosswalk x1
      ON x1.dbn = s.dbn AND x1.geo_layer = ${aggArea}
    JOIN area_tract_crosswalk x2
      ON x2.area_layer = ${aggArea} AND x2.area_id = x1.area_id
    JOIN community_indicator_values civ
      ON civ.geo_layer = 'tract'
     AND civ.area_id = x2.tract_geoid
     AND civ.indicator_id = ${indicatorId}
    WHERE s.is_unplottable = false
    GROUP BY s.dbn, civ.year
  `;
  return {
    indicator_id: indicatorId,
    family: 'community',
    agg_area: aggArea,
    series: rows,
  };
}

/* -------------------------------------------------------------------------- */
/* School Detail Panel                                                        */
/* -------------------------------------------------------------------------- */

interface SchoolProfileRow {
  dbn: string;
  school_name: string | null;
  borough: string | null;
  grades: string | null;
  is_unplottable: boolean;
  profile_year: string | null;
  total_enrollment: number | null;
  pct_students_with_disabilities: number | null;
  pct_english_language_learners: number | null;
  pct_poverty: number | null;
  economic_need_index: number | null;
  pct_asian: number | null;
  pct_black: number | null;
  pct_hispanic: number | null;
  pct_white: number | null;
  pct_multi_racial: number | null;
}

/**
 * Identity + latest-available-year demographics for one school. The latest
 * row is picked per-column from `schools_year` so a school with patchy years
 * (e.g. enrollment in 2024-25 but demographics last present in 2023-24) still
 * surfaces every field. `profile_year` reports the latest year that had at
 * least one non-null demographic value — the Detail Panel uses it for the
 * year pill on section 1.b.
 *
 * Returns null when the DBN isn't in `schools` at all.
 */
export async function getSchoolProfile(dbn: string): Promise<SchoolProfileResponse> {
  const rows = await sql<SchoolProfileRow>`
    WITH latest AS (
      SELECT DISTINCT ON (dbn)
        dbn, school_year,
        total_enrollment,
        pct_students_with_disabilities,
        pct_english_language_learners,
        pct_poverty,
        economic_need_index,
        pct_asian, pct_black, pct_hispanic, pct_white, pct_multi_racial
      FROM schools_year
      WHERE dbn = ${dbn}
        AND (
          total_enrollment IS NOT NULL
          OR pct_students_with_disabilities IS NOT NULL
          OR pct_english_language_learners IS NOT NULL
          OR pct_poverty IS NOT NULL
          OR economic_need_index IS NOT NULL
          OR pct_asian IS NOT NULL OR pct_black IS NOT NULL
          OR pct_hispanic IS NOT NULL OR pct_white IS NOT NULL
          OR pct_multi_racial IS NOT NULL
        )
      ORDER BY dbn, school_year DESC
    )
    SELECT
      s.dbn,
      s.school_name,
      s.borough,
      s.grades,
      s.is_unplottable,
      latest.school_year AS profile_year,
      latest.total_enrollment,
      latest.pct_students_with_disabilities,
      latest.pct_english_language_learners,
      latest.pct_poverty,
      latest.economic_need_index,
      latest.pct_asian,
      latest.pct_black,
      latest.pct_hispanic,
      latest.pct_white,
      latest.pct_multi_racial
    FROM schools s
    LEFT JOIN latest ON latest.dbn = s.dbn
    WHERE s.dbn = ${dbn}
  `;
  if (rows.length === 0) return { profile: null };
  const r = rows[0]!;
  // schools_master.csv stores pct_* fields as fractions in [0, 1]; the rest
  // of the app's `format: 'percent'` rendering expects 0..100. Scale at the
  // server boundary so the contract stays uniform with every other percent
  // value (math proficiency, suspension rate, etc.). ENI is conventionally
  // reported on a 0..1 scale, so it stays untouched.
  const to100 = (v: number | null): number | null => (v == null ? null : v * 100);
  const profile: SchoolProfile = {
    dbn: r.dbn,
    school_name: r.school_name,
    borough: r.borough,
    grades: r.grades,
    is_unplottable: r.is_unplottable,
    profile_year: r.profile_year,
    total_enrollment: r.total_enrollment,
    pct_students_with_disabilities: to100(r.pct_students_with_disabilities),
    pct_english_language_learners: to100(r.pct_english_language_learners),
    pct_poverty: to100(r.pct_poverty),
    economic_need_index: r.economic_need_index,
    pct_asian: to100(r.pct_asian),
    pct_black: to100(r.pct_black),
    pct_hispanic: to100(r.pct_hispanic),
    pct_white: to100(r.pct_white),
    pct_multi_racial: to100(r.pct_multi_racial),
  };
  return { profile };
}

interface PwcProgramRow {
  dbn: string;
  school_year: string;
  core_school: boolean | null;
  arts_program: boolean | null;
  social_work_program: boolean | null;
  community_school_program: boolean | null;
  community_school_program_status: string | null;
  arts_program_type: string | null;
  ost_program: boolean | null;
  ost_program_type: string | null;
  food_pantry: boolean | null;
  laundry: boolean | null;
  cohort: string | null;
}

/**
 * One pwc_school_program row for (dbn, year). `active=true` when at least one
 * program field is non-null in that year (matches the "active row" rule used
 * by `getPwcMembership`). Inactive rows still come back with the cohort
 * preserved (cohort can be set without any program columns set) so the panel
 * can show "no active program in 2020-21" while keeping context.
 *
 * Returns null when the DBN isn't in `pwc_school_program` AT ALL (= the
 * school is not a PWC school in any year, so §1.c shouldn't render).
 */
export async function getPwcProgram(dbn: string, year: string): Promise<PwcProgramResponse> {
  // Existence check — is this school PWC in any year?
  const existsRows = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM pwc_school_program WHERE dbn = ${dbn}
    ) AS exists
  `;
  if (!existsRows[0]?.exists) return { program: null };

  const rows = await sql<PwcProgramRow>`
    SELECT dbn, school_year,
      core_school, arts_program, social_work_program, community_school_program,
      community_school_program_status, arts_program_type,
      ost_program, ost_program_type, food_pantry, laundry, cohort
    FROM pwc_school_program
    WHERE dbn = ${dbn} AND school_year = ${year}
  `;
  // No row for this year at all → return a stub that the panel can render as
  // "Not in the PWC program panel for {year}". Cohort missing in this case.
  if (rows.length === 0) {
    return {
      program: {
        dbn,
        year,
        category: null,
        cohort: null,
        active: false,
        community_school_program_status: null,
        arts_program_type: null,
        ost_program_type: null,
        food_pantry: null,
        laundry: null,
      },
    };
  }
  const r = rows[0]!;
  const active = [
    r.core_school, r.arts_program, r.social_work_program, r.community_school_program,
    r.ost_program, r.food_pantry, r.laundry,
  ].some((v) => v !== null);
  const category: PwcCategory | null = active
    ? pwcCategoryFromFlags(r.core_school, r.arts_program)
    : null;
  const program: PwcProgram = {
    dbn: r.dbn,
    year: r.school_year,
    category,
    cohort: r.cohort,
    active,
    community_school_program_status: r.community_school_program_status,
    arts_program_type: r.arts_program_type,
    ost_program_type: r.ost_program_type,
    food_pantry: r.food_pantry,
    laundry: r.laundry,
  };
  return { program };
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
  //    selection. Mirrors the schools cascade: across-layer UNION, so a tract
  //    is included if it intersects ANY selected polygon in any layer.
  const tractRows = await sql<{ area_id: string }>`
    SELECT DISTINCT t.area_id
    FROM geographies t
    JOIN geographies s ON ST_Intersects(t.geom, s.geom)
    JOIN unnest(${layers}::text[], ${areaIds}::text[]) AS p(layer, area)
      ON s.geo_layer = p.layer AND s.area_id = p.area
    WHERE t.geo_layer = 'tract'
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
