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
import type { AggregationArea, GeoFilterLayerId, ProgramFlag } from '../contract/types';
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

  /** Multipick (OR) of PWC program flags. Empty array = no constraint;
   *  any selection implicitly scopes the universe to PWC schools (because
   *  the flags only exist on PWC rows). Follows the slider year via
   *  `pwcMembers`. */
  programs: ProgramFlag[];

  /** Multipick (OR) of canonical grade tokens (PK / K / 1..12). Empty array
   *  = no constraint. Resolved against `schools_master.grades_canonical` at
   *  filter time. */
  grades: string[];

  /** Spec §6.4 — the school the user picked in the School filter; drives
   *  flyTo + opens the School Details View stub. */
  selectedSchoolDbn: string | null;

  /** Spec §5.4 — the polygon definition used for community indicator
   *  aggregation in the right panel. Default = school_district. */
  aggregationArea: AggregationArea;

  /** Spec §2 — right panel is open by default, collapsible. */
  rightPanelCollapsed: boolean;

  /** When BOTH a school and a community indicator are active, which one the
   *  Analytics panel should focus on. When only one family is active this
   *  preference is ignored (effective family is forced to whichever exists). */
  analyticsFamily: 'school' | 'community';

  /** When true, every school dot (incl. PWC halos) is hidden from the map.
   *  Indicators stay selectable so the user can flip schools back on without
   *  losing context. */
  schoolsHidden: boolean;

  /** When true, the community choropleth is hidden from the map. The active
   *  community indicator stays selected so flipping back on is instant. */
  communityHidden: boolean;

  /** When false, the colored halo / border around PWC school dots is dropped
   *  so they blend visually with non-PWC schools — useful when the user
   *  wants to read the indicator without the PWC overlay. Fills still carry
   *  the category color in baseline mode (magenta/green/blue) so PWC
   *  schools remain identifiable; in indicator mode they look just like
   *  non-PWC dots. Default = true (halos on). */
  pwcHalosVisible: boolean;

  /**
   * "Latest year for all" mode. When true, each active layer resolves its
   * displayYear to ITS OWN latest available year — independent of the
   * slider's position. School + community can end up showing different
   * years simultaneously (e.g. school 2024-25 while community shows 2023),
   * which is exactly the point: every layer at its freshest data without
   * forcing a single shared year. Slider becomes a visual reference only.
   */
  latestPerLayer: boolean;

  setSchoolIndicator: (id: string | null) => void;
  setCommunityIndicator: (id: string | null) => void;
  setYear: (year: SliderYear) => void;
  setSchoolType: (t: SchoolType) => void;
  setGeoFilters: (next: GeoFilterMap) => void;
  clearGeoFilters: () => void;
  setCohort: (cohort: string | null) => void;
  setPrograms: (programs: ProgramFlag[]) => void;
  setGrades: (grades: string[]) => void;
  setSelectedSchool: (dbn: string | null) => void;
  setAggregationArea: (a: AggregationArea) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  setAnalyticsFamily: (f: 'school' | 'community') => void;
  setSchoolsHidden: (hidden: boolean) => void;
  setCommunityHidden: (hidden: boolean) => void;
  setPwcHalosVisible: (visible: boolean) => void;
  setLatestPerLayer: (latest: boolean) => void;
}

export const useHubStore = create<HubState>((set) => ({
  activeSchoolIndicator: null,
  activeCommunityIndicator: null,
  year: DEFAULT_YEAR,
  // Default to PWC-only so the app loads with the partner-school lens applied.
  // Users flip to "All NYC" via the School Type dropdown when they want the
  // citywide universe.
  schoolType: 'pwc',
  geoFilters: {},
  cohort: null,
  programs: [],
  grades: [],
  selectedSchoolDbn: null,
  aggregationArea: 'school_district',
  // Collapsed by default — the panel has nothing to show until the user picks
  // an indicator. Shell auto-expands it once `analyticsIndicator` becomes
  // truthy and re-collapses when it goes back to null.
  rightPanelCollapsed: true,
  analyticsFamily: 'school',
  schoolsHidden: false,
  communityHidden: false,
  pwcHalosVisible: true,
  // Default ON — each indicator opens at its own latest registry year so the
  // dashboard never lands in a 🗓️ no-data state on first load (community
  // indicators in particular don't all have a 2024-25 row). User toggles off
  // via the "Latest" pill in HeaderBar to take manual control of the slider.
  latestPerLayer: true,
  setSchoolIndicator: (id) => set({ activeSchoolIndicator: id }),
  setCommunityIndicator: (id) => set({ activeCommunityIndicator: id }),
  setYear: (year) => set({ year }),
  setSchoolType: (t) => set({ schoolType: t }),
  setGeoFilters: (next) => set({ geoFilters: next }),
  clearGeoFilters: () => set({ geoFilters: {} }),
  setCohort: (c) => set({ cohort: c }),
  setPrograms: (programs) => set({ programs }),
  setGrades: (grades) => set({ grades }),
  setSelectedSchool: (dbn) => set({ selectedSchoolDbn: dbn }),
  setAggregationArea: (a) => set({ aggregationArea: a }),
  setRightPanelCollapsed: (collapsed) => set({ rightPanelCollapsed: collapsed }),
  setAnalyticsFamily: (f) => set({ analyticsFamily: f }),
  setSchoolsHidden: (hidden) => set({ schoolsHidden: hidden }),
  setCommunityHidden: (hidden) => set({ communityHidden: hidden }),
  setPwcHalosVisible: (visible) => set({ pwcHalosVisible: visible }),
  setLatestPerLayer: (latest) => set({ latestPerLayer: latest }),
}));
