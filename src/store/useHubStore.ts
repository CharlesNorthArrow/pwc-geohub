/**
 * Single state store — spec §11.3.
 *
 * One slice grows phase by phase; later phases extend it, never fork it.
 *   - Phase 1: active indicators + (temporary) per-layer year overrides
 *   - Phase 2: schoolType
 *   - Phase 3: geoFilters, cohort, selectedSchoolDbn
 *   - Phase 4: replaces the per-layer overrides with one `year` (slider)
 */

import { create } from 'zustand';
import type { AggregationArea, GeoFilterLayerId } from '../contract/types';
import { DEFAULT_YEAR, type SliderYear } from '../contract/year';

/**
 * Spec §6.2 — School Type filter.
 *  - 'all'           → every plottable school, no PWC filter
 *  - 'pwc'           → any active PWC school (anchor | healing_arts | both | pwc_other)
 *  - 'anchor'        → core_school=true (INCLUDES both-category schools)
 *  - 'healing_arts'  → arts_program=true (INCLUDES both-category schools)
 */
export type SchoolType = 'all' | 'pwc' | 'anchor' | 'healing_arts';

/** Spec §6.1 — multi-select per layer. UNION within a layer + UNION across
 *  layers (a school qualifies if it's in any selected pair). Missing key =
 *  no constraint from that layer. */
export type GeoFilterMap = Partial<Record<GeoFilterLayerId, string[]>>;

export interface HubState {
  activeSchoolIndicator: string | null;
  activeCommunityIndicator: string | null;

  /**
   * Spec §6.5 — the time slider's current school_year. Both layers resolve
   * their data availability from this single value (community via
   * `toCommunityYear`). When an active indicator has no data for the chosen
   * year, that layer shows the 🗓️ notice while the OTHER layer keeps
   * rendering — independent resolution.
   */
  year: SliderYear;

  /** Spec §6.2 — see SchoolType doc above. Default 'all'. */
  schoolType: SchoolType;

  /** Spec §6.1 — Geo filter (popup, multi-pick). UNION within layer,
   *  INTERSECTION across layers. */
  geoFilters: GeoFilterMap;

  /** Spec §6.3 — single-select Cohort. null = "All cohorts". */
  cohort: string | null;

  /** Spec §6.4 — the school the user picked in the School filter; drives
   *  flyTo + opens the School Details View stub. */
  selectedSchoolDbn: string | null;

  /** Spec §5.4 — the polygon definition used for community indicator
   *  aggregation in the right panel. Default = school_district. */
  aggregationArea: AggregationArea;

  /** Spec §2 — right panel is open by default, collapsible. */
  rightPanelCollapsed: boolean;

  setSchoolIndicator: (id: string | null) => void;
  setCommunityIndicator: (id: string | null) => void;
  setYear: (year: SliderYear) => void;
  setSchoolType: (t: SchoolType) => void;
  setGeoFilters: (next: GeoFilterMap) => void;
  clearGeoFilters: () => void;
  setCohort: (cohort: string | null) => void;
  setSelectedSchool: (dbn: string | null) => void;
  setAggregationArea: (a: AggregationArea) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
}

export const useHubStore = create<HubState>((set) => ({
  activeSchoolIndicator: null,
  activeCommunityIndicator: null,
  year: DEFAULT_YEAR,
  schoolType: 'all',
  geoFilters: {},
  cohort: null,
  selectedSchoolDbn: null,
  aggregationArea: 'school_district',
  rightPanelCollapsed: false,
  setSchoolIndicator: (id) => set({ activeSchoolIndicator: id }),
  setCommunityIndicator: (id) => set({ activeCommunityIndicator: id }),
  setYear: (year) => set({ year }),
  setSchoolType: (t) => set({ schoolType: t }),
  setGeoFilters: (next) => set({ geoFilters: next }),
  clearGeoFilters: () => set({ geoFilters: {} }),
  setCohort: (c) => set({ cohort: c }),
  setSelectedSchool: (dbn) => set({ selectedSchoolDbn: dbn }),
  setAggregationArea: (a) => set({ aggregationArea: a }),
  setRightPanelCollapsed: (collapsed) => set({ rightPanelCollapsed: collapsed }),
}));
