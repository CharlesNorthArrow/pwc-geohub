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
  /** UI-friendly short form, e.g. "Math proficiency" instead of
   *  "Math proficiency (gr 3–8, % L3+4)". Falls back to `label` when absent. */
  short_label?: string;
  description?: string;
  /** Verbatim survey-question wording for the 5 survey indicators. Surfaced
   *  in the layer-list info bubble and as a sub-line in the legend. Absent
   *  for non-survey indicators. */
  full_question?: string;
  format: Format;
  scale: {
    type: ScaleType;
    good_direction: GoodDirection;
    categories?: string[];
    /** 'equal' (default) or 'quantile'. Drives `colorBinsFor` bin placement. */
    bin_method?: 'equal' | 'quantile';
    /** Discrete value buckets — one color per listed value, edges computed
     *  at midpoints. When present, overrides `bin_method`. */
    discrete_values?: number[];
    /** Continuous stretched-ramp stops (only when `type === 'continuous'`).
     *  Clamped outside the first/last `value`; linear between adjacent stops. */
    stops?: Array<{ value: number; color: string }>;
    /** Per-feature opacity stretch for categorical layers — share → opacity,
     *  clamped outside the value window. Only consumed by indicators that
     *  ship a `value_num` alongside the category (e.g. `racial_predominance`). */
    opacity_stretch?: {
      value_min: number;
      value_max: number;
      opacity_min: number;
      opacity_max: number;
    };
    /** Uniform per-indicator layer opacity. Overrides the map's 0.65 fill
     *  default when set; ignored when `opacity_stretch` applies (per-tract
     *  stretch wins). */
    layer_opacity?: number;
  };
  geometry: 'point' | 'polygon';
  /** Sorted ascending. Last entry = default display year. */
  years: string[];
  /** Human-readable source string for the info icon, e.g.
   *  "PWC-hosted: arts_ed.csv" or "ACS 5-yr: B17001". */
  source_description: string;
  /** Optional URL to the upstream provider's landing page (when known). */
  source_url?: string;
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
  /**
   * Optional per-geoid intensity score (0–100). Only populated for categorical
   * indicators where the strength of the category matters (e.g.
   * racial_predominance — share of population in the predominant group). The
   * map paints opacity from this so tracts with a clear majority read
   * stronger than mixed tracts.
   */
  intensities?: Record<string, number>;
}

/* -------------------------------------------------------------------------- */
/* PWC programmatic layer (Phase 2)                                           */
/* -------------------------------------------------------------------------- */

export type PwcCategory = 'anchor' | 'healing_arts' | 'both' | 'pwc_other';

/** Raw program flags carried per-year alongside the derived `category` so the
 *  Program filter can match on any subset (Social work / Community school /
 *  Healing arts / Out-of-school). `arts_program` overlaps the `healing_arts`
 *  category but is exposed here too so the Program filter stays uniform across
 *  the four pwc_school_program columns. */
export interface PwcProgramFlags {
  social_work: boolean;
  community_school: boolean;
  arts_program: boolean;
  ost: boolean;
}

export type ProgramFlag = keyof PwcProgramFlags;

export const PROGRAM_FLAGS: ReadonlyArray<{ id: ProgramFlag; label: string }> = [
  { id: 'social_work', label: 'Social Work' },
  { id: 'community_school', label: 'Community School' },
  { id: 'arts_program', label: 'Healing Arts' },
  { id: 'ost', label: 'Out-of-School Time' },
];

export interface PwcMember extends PwcProgramFlags {
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

/** GET /api/pwc/history → membership per year for the timeline. */
export interface PwcHistoryResponse {
  /** `year → members[]`. Year keys mirror `pwc_school_program.school_year`. */
  byYear: Record<string, PwcMember[]>;
}

/* -------------------------------------------------------------------------- */
/* Geo filter + schools-master (Phase 3)                                      */
/* -------------------------------------------------------------------------- */

/** Layers the §6.1 Geo filter spans. Spec §6.1 lists 6; Congressional was
 *  added at user request, and NTA was promoted from aggregation-only into
 *  the Geo filter. NDA still lives in `geographies` for future overlays. */
export type GeoFilterLayerId =
  | 'county'
  | 'senate'
  | 'assembly'
  | 'congressional'
  | 'council'
  | 'school_district'
  | 'community_district'
  | 'nta_2020';

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
  // NTA is NYC-only and not number-keyed — alphabetical sort by NTAName.
  // Allow-list does not apply (only Congressional / Senate / Assembly).
  { id: 'nta_2020', label: 'NYC Neighborhoods (NTAs)' },
];

export interface GeoArea {
  area_id: string;
  label: string;
  /** Per-layer extras pulled from the source ArcGIS feature (e.g. Assembly
   *  Name + Party, Congressional rep). Keys vary by layer; the Geo popup
   *  picks the ones it knows about. Empty object when nothing extra. */
  attributes?: Record<string, string | null>;
}

/** GET /api/geographies → all 6 §6.1 layers in one round-trip. */
export interface GeographiesResponse {
  layers: Record<GeoFilterLayerId, GeoArea[]>;
}

/**
 * GET /api/geo/tract-nta → tract_geoid → containing NTA. Powers the discreet
 * community-polygon hover tooltip ("Bedford-Stuyvesant — 18.4%"). One-shot
 * fetch on Shell mount; the mapping doesn't change session-to-session.
 */
export interface TractNtaMapResponse {
  tracts: Record<string, { nta_id: string; nta_name: string }>;
}

/** One row in the schools master — lightweight identity + crosswalk memberships.
 *  Used by the Geo cascade, the School filter dropdown, and Phase 5 KPI/list. */
export interface SchoolMaster {
  dbn: string;
  school_name: string | null;
  borough: string | null;
  /** {layer_id → area_id this school belongs to}. Missing key = no crosswalk. */
  geos: Partial<Record<GeoFilterLayerId, string>>;
  /** Plottable coords from `schools`. Always non-null in the response (the
   *  query filters unplottable rows out). */
  longitude: number;
  latitude: number;
  /** Most recently observed total_enrollment across `schools_year` rows.
   *  Null if no year has reported a non-null enrollment. Used to size the
   *  baseline (no-indicator-selected) circles. */
  total_enrollment: number | null;
  /** Latest non-null need demographics per school (same latest-per-field
   *  convention as `total_enrollment`), scaled 0..100 like the profile
   *  endpoint. Added for Spotlight's profile-field candidates; existing
   *  consumers may ignore them. */
  pct_poverty: number | null;
  pct_students_with_disabilities: number | null;
  pct_english_language_learners: number | null;
  /** NYC Community School designation from the master (free text; a value
   *  containing "1" flags membership — interpret via `isNycCommunitySchool`,
   *  never inline). Null until the master refresh carrying it lands. */
  community_school: string | null;
  /** Canonical grade tokens this school serves (PK/K/1..12), normalized
   *  server-side from `schools.grades`. Empty when the source value is
   *  missing or unparseable — the Grade filter treats empty as "doesn't
   *  match anything explicit", which matches DOE convention for ungraded /
   *  alt schools. */
  grades_canonical: string[];
}

/** GET /api/schools-master → ~1,779 plottable schools. */
export interface SchoolsMasterResponse {
  schools: SchoolMaster[];
}

/* -------------------------------------------------------------------------- */
/* Phase 5 analytics                                                          */
/* -------------------------------------------------------------------------- */

/** Area definition for the school↔community aggregation toggle (§5.4). */
export type AggregationArea = 'school_district' | 'nta_2020';

export interface AnalyticsSeriesRow {
  dbn: string;
  year: string;     // school_year for school indicators, calendar year for community
  value_num: number | null;
  value_text: string | null;
  label: string | null;
}

/**
 * GET /api/analytics/series?indicator=X[&aggArea=…]
 *
 * - school indicator → one row per (school, year) from `school_indicator_values`.
 * - community indicator + aggArea → per-school average of community values
 *   across tracts intersecting the school's surrounding area (the chosen
 *   `aggArea` polygon containing the school). Reuses Phase 0/5 crosswalks.
 *
 * Empty `series` is a valid response (e.g. community indicator without an
 * `aggArea` param — the route requires it for community).
 */
export interface AnalyticsSeriesResponse {
  indicator_id: string;
  family: IndicatorFamily;
  agg_area: AggregationArea | null;
  series: AnalyticsSeriesRow[];
}

/* -------------------------------------------------------------------------- */
/* School Detail Panel                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Per-school identity + latest-year demographics. Section 1.b of the Detail
 * Panel — pinned to the school's most-recent `schools_year` row regardless of
 * the slider, since the panel itself notes we lack historical demographics for
 * every school.
 *
 * `profile_year` is the school_year of the row we returned. The race + need
 * breakdowns come straight from `schools_year`; any field missing in the
 * source CSV stays null.
 */
export interface SchoolProfile {
  dbn: string;
  school_name: string | null;
  borough: string | null;
  grades: string | null;
  /** Whether the schools table flagged this DBN as unplottable (no lat/lng).
   *  The Detail Panel surfaces a "Not shown on map" note for these. */
  is_unplottable: boolean;
  /** school_year of the row whose values populate the rest of this object.
   *  Null when there isn't a single non-null demographic row in `schools_year`
   *  (e.g. an entry that exists only in `pwc_school_program`). */
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

/** GET /api/schools/profile?dbn= */
export interface SchoolProfileResponse {
  profile: SchoolProfile | null;
}

/**
 * Arts Education enrichment surfaced in the Detail Panel below the school
 * profile. Sourced from `arts_ed.csv`'s `arts_ed_disciplines` column (the
 * comma-separated list of disciplines taught at the school), captured via the
 * registry's `categorical_field` side-text knob on `arts_ed_score`. Slider-
 * independent — the panel pins to the school's latest arts_ed vintage with
 * non-null disciplines.
 */
export interface SchoolArtsEd {
  dbn: string;
  /** school_year of the row whose disciplines populate `disciplines`. Null
   *  when this DBN has no row in arts_ed at all (or every row has empty
   *  disciplines) — the panel falls back to a "not available" state. */
  year: string | null;
  /** Canonical discipline tokens for that year, deduped + ordered as they
   *  appear in the source CSV (Dance, Music, Theater, Visual Arts in the
   *  full-coverage case). */
  disciplines: string[];
}

/** GET /api/schools/arts-ed?dbn= */
export interface SchoolArtsEdResponse {
  artsEd: SchoolArtsEd;
}

/**
 * One row of `pwc_school_program` for a (dbn, year) — only the columns the
 * Detail Panel surfaces (§1.c): group flags via the derived `category`, plus
 * cohort, program statuses, and the two boolean services.
 *
 * `active = false` means all program fields are null for this year (per spec
 * §3.5 — a placeholder row that means "no active program that year"). The
 * panel still renders a row saying as much, so the year-by-year pulse is
 * visible from inside the panel.
 */
export interface PwcProgram {
  dbn: string;
  year: string;
  /** Same Q1-default category model the rest of the app uses; null when
   *  `active=false`. */
  category: PwcCategory | null;
  cohort: string | null;
  active: boolean;
  /** Program booleans — the Detail Panel's §1.c display driver: a program
   *  row renders iff its boolean is true; the *_status / *_type text is
   *  optional detail, never a display gate. */
  social_work_program: boolean | null;
  community_school_program: boolean | null;
  arts_program: boolean | null;
  ost_program: boolean | null;
  community_school_program_status: string | null;
  arts_program_type: string | null;
  ost_program_type: string | null;
  food_pantry: boolean | null;
  laundry: boolean | null;
}

/** GET /api/pwc/program?dbn=&year= */
export interface PwcProgramResponse {
  /** Null when the school isn't in pwc_school_program at all (= not a PWC
   *  school in ANY year). */
  program: PwcProgram | null;
}

/* -------------------------------------------------------------------------- */
/* Selected geographies overlay (Phase 3 polish)                              */
/* -------------------------------------------------------------------------- */

export interface GeoSelectionFeature {
  type: 'Feature';
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  properties: {
    geo_layer: GeoFilterLayerId;
    area_id: string;
    label: string | null;
  };
}

/** GET /api/geo/selection?picks=… → MultiPolygons for the currently-selected
 *  (layer, area_id) pairs PLUS the census tract GEOIDs that fall within or
 *  overlap those polygons. The map draws the boundaries as an overlay and
 *  filters the community choropleth to `intersectingTractGeoids`. */
export interface GeoSelectionResponse {
  type: 'FeatureCollection';
  features: GeoSelectionFeature[];
  /** Distinct tract GEOIDs (11 chars) intersecting the UNION of selected
   *  polygons. Empty array when nothing is selected. */
  intersectingTractGeoids: string[];
}
