/**
 * Contract types — the wire format between API routes and the React app.
 *
 * Per spec §11.1, no component reads a CSV or hits a federal API directly.
 * Everything flows through this contract; quirks (cohort grain, redaction
 * sentinels, "Above 95%") were normalized at ETL time and won't reach here.
 */

import type {
  Format,
  GoodDirection,
  IndicatorFamily,
  ScaleType,
} from '../registry/types';

/** Subset of the registry shipped to the client — no source/credentials. */
export interface IndicatorPublic {
  id: string;
  family: IndicatorFamily;
  theme: string;
  label: string;
  description?: string;
  format: Format;
  scale: {
    type: ScaleType;
    good_direction: GoodDirection;
    categories?: string[];
  };
  geometry: 'point' | 'polygon';
  /** Sorted ascending. Last entry = default display year. */
  years: string[];
}

/** GET /api/indicators */
export interface IndicatorsResponse {
  indicators: IndicatorPublic[];
}

/** One school point ready to render.
 *
 * The Phase 2 `is_pwc | is_anchor | is_arts | pwc_other | pwc_category | pwc_cohort`
 * fields are merged in client-side by `<Shell/>` from `GET /api/pwc`; the schools
 * route itself stays PWC-agnostic so switching PWC year doesn't re-fetch points.
 */
export interface SchoolPointProps {
  dbn: string;
  school_name: string | null;
  total_enrollment: number | null;
  value_num: number | null;
  value_text: string | null;
  label: string | null;
  is_pwc?: boolean;
  is_anchor?: boolean;
  is_arts?: boolean;
  pwc_other?: boolean;
  pwc_category?: PwcCategory | null;
  pwc_cohort?: string | null;
}

export interface SchoolFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: SchoolPointProps;
}

/** GET /api/schools?indicator=&year= */
export interface SchoolsResponse {
  type: 'FeatureCollection';
  indicator_id: string;
  year: string;
  /** Min / max of value_num across features (drives the legend domain). */
  domain: { min: number; max: number } | null;
  features: SchoolFeature[];
}

/** GET /api/community?indicator=&year= */
export interface CommunityResponse {
  indicator_id: string;
  year: string;
  /** `geoid → value`. Categorical indicators send `value_text` instead. */
  values: Record<string, number | string | null>;
  domain: { min: number; max: number } | null;
  categories?: string[];
}

/* -------------------------------------------------------------------------- */
/* PWC programmatic layer (Phase 2)                                           */
/* -------------------------------------------------------------------------- */

export type PwcCategory = 'anchor' | 'healing_arts' | 'both' | 'pwc_other';

export interface PwcMember {
  dbn: string;
  category: PwcCategory;
  cohort: string | null;
}

/**
 * GET /api/pwc?year=YYYY-YY
 *
 * Membership snapshot for one school year. Anchor = `core_school=true`,
 * Healing Arts = `arts_program=true` (Q1 default applied at Phase 0 — confirm
 * with PWC). Both-category schools (`core_school=true AND arts_program=true`)
 * receive category `'both'` and follow the goal-text rule: dual halo on the
 * map, and they appear in both the Anchor and Healing Arts group filters.
 *
 * An "active" row is one with at least one program field non-null — the
 * 2020-21 / 2021-22 placeholder rows have all-null program columns and are
 * excluded per spec §3.5.
 */
export interface PwcResponse {
  year: string;
  members: PwcMember[];
}

/* -------------------------------------------------------------------------- */
/* Geo filter + schools-master (Phase 3)                                      */
/* -------------------------------------------------------------------------- */

/** Layers the §6.1 Geo filter spans. NDA / NTA exist in `geographies` but
 *  aren't surfaced here — they're used elsewhere (aggregation toggle, future
 *  overlays). Spec §6.1 lists 6; Congressional was added at user request. */
export type GeoFilterLayerId =
  | 'county'
  | 'senate'
  | 'assembly'
  | 'congressional'
  | 'council'
  | 'school_district'
  | 'community_district';

/** Ordered by administrative hierarchy — Federal → State → Local — and
 *  prefixed accordingly. The order drives the Geo popup tab layout. */
export const GEO_FILTER_LAYERS: ReadonlyArray<{ id: GeoFilterLayerId; label: string }> = [
  // Federal
  { id: 'congressional', label: 'US Congressional' },
  // State
  { id: 'senate', label: 'NYS Senate' },
  { id: 'assembly', label: 'NYS Assembly' },
  // Local
  { id: 'county', label: 'NYC Counties' },
  { id: 'council', label: 'NYC City Council' },
  { id: 'school_district', label: 'NYC School Districts' },
  { id: 'community_district', label: 'NYC Community Districts' },
];

export interface GeoArea {
  area_id: string;
  label: string;
}

/** GET /api/geographies → all 6 §6.1 layers in one round-trip. */
export interface GeographiesResponse {
  layers: Record<GeoFilterLayerId, GeoArea[]>;
}

/** One row in the schools master — lightweight identity + crosswalk memberships.
 *  Used by the Geo cascade, the School filter dropdown, and Phase 5 KPI/list. */
export interface SchoolMaster {
  dbn: string;
  school_name: string | null;
  borough: string | null;
  /** {layer_id → area_id this school belongs to}. Missing key = no crosswalk. */
  geos: Partial<Record<GeoFilterLayerId, string>>;
}

/** GET /api/schools-master → ~1,779 plottable schools. */
export interface SchoolsMasterResponse {
  schools: SchoolMaster[];
}
