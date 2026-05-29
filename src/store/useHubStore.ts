/**
 * Single state store — spec §11.3.
 *
 * Phase 1 slice only: the two active indicators, plus optional per-layer
 * `displayYear` overrides used to test the no-data branch ahead of the
 * Phase 4 time slider. No `cohort`, `schoolType`, `geoFilters`,
 * `selectedSchool`, or `aggregationArea` yet — those land in Phases 2–5.
 */

import { create } from 'zustand';
import type { GeoFilterLayerId } from '../contract/types';

/**
 * Spec §6.2 — School Type filter. Phase 2 wires this to the **map only** via
 * a temporary left-panel toggle; Phase 3 attaches the real header control to
 * the same state, no fork.
 *
 * Semantics:
 *  - 'all'           → every plottable school, no PWC filter
 *  - 'pwc'           → any active PWC school (anchor | healing_arts | both | pwc_other)
 *  - 'anchor'        → core_school=true (INCLUDES both-category schools)
 *  - 'healing_arts'  → arts_program=true (INCLUDES both-category schools)
 */
export type SchoolType = 'all' | 'pwc' | 'anchor' | 'healing_arts';

/** Spec §6.1 — multi-select per layer, UNION within a layer + INTERSECTION
 *  across layers. Missing key = no constraint from that layer. */
export type GeoFilterMap = Partial<Record<GeoFilterLayerId, string[]>>;

export interface HubState {
  activeSchoolIndicator: string | null;
  activeCommunityIndicator: string | null;

  /**
   * Optional override on the displayed year for each layer. When null, the
   * layer uses its registry-defined latest year (per spec §6.5). Phase 4
   * replaces this with a single shared `year` driven by the time slider.
   */
  schoolYearOverride: string | null;
  communityYearOverride: string | null;

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

  setSchoolIndicator: (id: string | null) => void;
  setCommunityIndicator: (id: string | null) => void;
  setSchoolYearOverride: (year: string | null) => void;
  setCommunityYearOverride: (year: string | null) => void;
  setSchoolType: (t: SchoolType) => void;
  setGeoFilters: (next: GeoFilterMap) => void;
  clearGeoFilters: () => void;
  setCohort: (cohort: string | null) => void;
  setSelectedSchool: (dbn: string | null) => void;
}

export const useHubStore = create<HubState>((set) => ({
  activeSchoolIndicator: null,
  activeCommunityIndicator: null,
  schoolYearOverride: null,
  communityYearOverride: null,
  schoolType: 'all',
  geoFilters: {},
  cohort: null,
  selectedSchoolDbn: null,
  setSchoolIndicator: (id) =>
    // Clearing the indicator also clears its year override — both are
    // per-indicator state and should reset together.
    set({ activeSchoolIndicator: id, schoolYearOverride: null }),
  setCommunityIndicator: (id) =>
    set({ activeCommunityIndicator: id, communityYearOverride: null }),
  setSchoolYearOverride: (year) => set({ schoolYearOverride: year }),
  setCommunityYearOverride: (year) => set({ communityYearOverride: year }),
  setSchoolType: (t) => set({ schoolType: t }),
  setGeoFilters: (next) => set({ geoFilters: next }),
  clearGeoFilters: () => set({ geoFilters: {} }),
  setCohort: (c) => set({ cohort: c }),
  setSelectedSchool: (dbn) => set({ selectedSchoolDbn: dbn }),
}));
