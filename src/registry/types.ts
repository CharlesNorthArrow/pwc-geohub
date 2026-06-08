/**
 * Indicator Registry types — spec §11.2.
 *
 * The registry is the single source of truth for what an indicator IS:
 * where its data comes from, how it's keyed, how it should be rendered,
 * and what counts as "good". Adding an indicator = a registry edit.
 */

export type IndicatorFamily = 'school' | 'community';
export type Geometry = 'point' | 'polygon' | 'site';
export type ScaleType = 'sequential' | 'diverging' | 'categorical';
export type GoodDirection = 'high' | 'low' | 'none';
export type Format =
  | 'percent'
  | 'rate_per_100'
  | 'integer'
  | 'count'
  | 'index'
  | 'categorical';
export type Status = 'active' | 'deferred';

export interface HostedSource {
  type: 'hosted';
  dataset: string;
  value_field: string;
  label_field: string;
  /** Join key on the source CSV. Always 'dbn' for school indicators. */
  key: 'dbn';
  /**
   * Year field on the source CSV. Most use `school_year`; graduation uses
   * `cohort_year` and is mapped to school_year at ETL time (spec §3.6/§12 Q4).
   */
  year_field: 'school_year' | 'cohort_year';
  /** Optional categorical sibling field (e.g. safety_climate_rating). */
  categorical_field?: string;
  categorical_label_field?: string;
}

export interface AcsSource {
  type: 'api';
  provider: 'acs5';
  endpoint: 'acs5' | 'acs5/subject' | 'acs5/profile';
  table: string;
  /** Variable codes pulled from ACS for the computation. */
  fields: string[];
  geo: 'tract';
}

export interface CdcPlacesSource {
  type: 'api';
  provider: 'cdc_places';
  /** Socrata dataset resource id (without .json). */
  resource: 'cwsq-ngmh';
  measure_id: string;
  geo: 'tract';
}

export interface DeferredSource {
  type: 'deferred';
  planned_method: string;
}

export type IndicatorSource =
  | HostedSource
  | AcsSource
  | CdcPlacesSource
  | DeferredSource;

export type BinMethod = 'equal' | 'quantile';

export interface IndicatorScale {
  type: ScaleType;
  good_direction: GoodDirection;
  /** Placeholder ramp name; final ramps picked at Phase 1. */
  ramp: string;
  categories?: string[];
  /**
   * How to slice the value range into legend bins. Default 'equal' = equal
   * intervals over min/max (works when values are spread evenly). Set
   * 'quantile' for skewed distributions so each bin holds ~the same number
   * of tracts — better visual contrast across the choropleth.
   */
  bin_method?: BinMethod;
  /**
   * Discrete value buckets — one color per listed value. Edges are computed
   * as midpoints between consecutive entries, so e.g. `[0,1,2,3,4]` puts
   * each integer in its own color and the legend renders "0", "1", "2", "3",
   * "4" instead of bracket strings. Length must equal the ramp size (5).
   * Set on indicators whose values are inherently discrete (e.g.
   * arts_ed_score counts 0–4 disciplines). Overrides `bin_method` when set.
   */
  discrete_values?: number[];
}

export interface IndicatorRegistryEntry {
  id: string;
  family: IndicatorFamily;
  theme: string;
  label: string;
  /** Optional short form for tight UI surfaces (left-panel selector). Falls
   *  back to `label` when absent. */
  short_label?: string;
  description?: string;
  /** Verbatim survey-question wording for the survey indicators (NYC School
   *  Survey, Public Data Wishlist col C). Rendered in the layer-list info
   *  bubble and as a sub-line in the legend. Non-survey indicators omit it. */
  full_question?: string;
  source: IndicatorSource;
  /** Human-friendly upstream provider — surfaced in the info-icon tooltip in
   *  place of the technical `source_description`. Pulled from the Public Data
   *  Wishlist (column F) for school indicators. */
  data_source?: string;
  /** Optional canonical landing page for the upstream source. */
  data_source_url?: string;
  format: Format;
  scale: IndicatorScale;
  geometry: Geometry;
  /**
   * Year coverage. For hosted indicators this is enumerated from the source
   * data at ETL time; the registry value is the *declared* expectation.
   * For ACS the year is the 5-year vintage endpoint (e.g. '2024' = 2020–2024).
   */
  years: string[];
  status: Status;
  notes?: string;
}
