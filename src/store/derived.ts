/**
 * Derived filter universe — spec §6.6 matrix, computed in one place.
 *
 * `applyFilters` is a PURE function from {state, schoolsMaster, pwcMembers}.
 * It returns the set of DBNs currently in view plus per-dropdown narrowing
 * info so the header dropdowns and pre-filter notes can read from one source.
 *
 * Used by:
 *   - MapView          → builds MapLibre `filter` on the school layers
 *   - HeaderBar        → option lists + "pre-filtered by …" notes
 *   - Phase 5 (later)  → KPI cards / ranked list / community aggregation read
 *                        the SAME set so they can't drift from the map
 *
 * Semantics:
 *   - within a layer: UNION (school in layer A area-id1 OR area-id2)
 *   - across layers:  UNION (school qualifies if it's in any selected pair)
 *   - missing layer:  no constraint
 *   - cascade order:  Geo → SchoolType → Cohort → School
 *
 * Both-category PWC schools (anchor ∩ healing_arts) pass either group filter.
 */

import {
  GEO_FILTER_LAYERS,
  type GeoFilterLayerId,
  type PwcMember,
  type SchoolMaster,
} from '../contract/types';
import { belongsToPwcGroup } from './pwcGroups';
import type { GeoFilterMap, HubState, SchoolType } from './useHubStore';

export interface PrefilterSummary {
  /** Note shown above the School Type dropdown — driven by Geo only. */
  forSchoolType: string | null;
  /** Note shown above the Cohort dropdown — Geo + School Type. */
  forCohort: string | null;
  /** Note shown above the School dropdown — Geo + School Type + Cohort. */
  forSchool: string | null;
}

export interface FilteredUniverse {
  /** DBNs that pass every active filter. Use this for the map + Phase 5. */
  schoolDbns: Set<string>;
  /** DBNs that pass only Geo (used to decide School Type counts). */
  afterGeo: Set<string>;
  /** DBNs that pass Geo + School Type (used to compute cohort options/counts). */
  afterSchoolType: Set<string>;
  /** Cohort options shown in the dropdown, with `count` = number of in-view
   *  schools that belong to that cohort under the current Geo + School Type
   *  cascade. Greyed/disabled when count = 0 (per the agreed UX). */
  cohortOptions: Array<{ cohort: string; count: number }>;
  /** Pre-filter notes per downstream dropdown. */
  prefilterSummary: PrefilterSummary;
}

interface FiltersInput {
  state: Pick<HubState, 'geoFilters' | 'schoolType' | 'cohort'>;
  schoolsMaster: SchoolMaster[];
  pwcMembers: PwcMember[];
  /** All cohort labels seen in pwc_schools.csv. Driven from the same data —
   *  computed at the call site to avoid baking labels into code. */
  allCohorts: string[];
}

export function applyFilters({
  state,
  schoolsMaster,
  pwcMembers,
  allCohorts,
}: FiltersInput): FilteredUniverse {
  const pwcByDbn = new Map(pwcMembers.map((m) => [m.dbn, m]));

  // --- Step 1: Geo cascade --------------------------------------------------
  const geoActive = countGeoLayers(state.geoFilters) > 0;
  const afterGeo = new Set<string>();
  for (const s of schoolsMaster) {
    if (passesGeo(s, state.geoFilters)) afterGeo.add(s.dbn);
  }

  // --- Step 2: School Type cascade -----------------------------------------
  const afterSchoolType = new Set<string>();
  for (const dbn of afterGeo) {
    if (passesSchoolType(dbn, state.schoolType, pwcByDbn)) afterSchoolType.add(dbn);
  }

  // --- Step 3: Cohort cascade ----------------------------------------------
  const finalSet = new Set<string>();
  for (const dbn of afterSchoolType) {
    if (passesCohort(dbn, state.cohort, pwcByDbn)) finalSet.add(dbn);
  }

  // --- Cohort options + counts (computed against afterSchoolType so the cohort
  // dropdown reflects what's pickable in the current Geo + SchoolType universe).
  const cohortCounts = new Map<string, number>();
  for (const c of allCohorts) cohortCounts.set(c, 0);
  for (const dbn of afterSchoolType) {
    const member = pwcByDbn.get(dbn);
    if (member?.cohort) {
      cohortCounts.set(member.cohort, (cohortCounts.get(member.cohort) ?? 0) + 1);
    }
  }
  const cohortOptions = allCohorts
    .map((c) => ({ cohort: c, count: cohortCounts.get(c) ?? 0 }))
    .sort((a, b) => a.cohort.localeCompare(b.cohort));

  // --- Pre-filter notes -----------------------------------------------------
  const geoSummary = geoActive ? summarizeGeo(state.geoFilters) : null;
  const schoolTypeSummary = state.schoolType !== 'all' ? labelSchoolType(state.schoolType) : null;
  const cohortSummary = state.cohort ?? null;

  const forSchoolType = geoSummary ? `Geo: ${geoSummary}` : null;
  const forCohort = joinNotes(geoSummary, schoolTypeSummary, null);
  const forSchool = joinNotes(geoSummary, schoolTypeSummary, cohortSummary);

  return {
    schoolDbns: finalSet,
    afterGeo,
    afterSchoolType,
    cohortOptions,
    prefilterSummary: { forSchoolType, forCohort, forSchool },
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function countGeoLayers(g: GeoFilterMap): number {
  let n = 0;
  for (const layer of GEO_FILTER_LAYERS) {
    if ((g[layer.id]?.length ?? 0) > 0) n++;
  }
  return n;
}

function passesGeo(s: SchoolMaster, g: GeoFilterMap): boolean {
  // Within a layer = UNION; ACROSS layers = UNION too (OR). A school passes
  // if it sits in at least one selected (layer, area_id) pair. With no
  // selections anywhere, the filter is unconstrained and everything passes.
  let anyActive = false;
  for (const layer of GEO_FILTER_LAYERS) {
    const picks = g[layer.id];
    if (!picks || picks.length === 0) continue;
    anyActive = true;
    const schoolArea = s.geos[layer.id];
    if (schoolArea && picks.includes(schoolArea)) return true;
  }
  return !anyActive;
}

function passesSchoolType(
  dbn: string,
  t: SchoolType,
  pwcByDbn: Map<string, PwcMember>,
): boolean {
  if (t === 'all') return true;
  const m = pwcByDbn.get(dbn);
  if (!m) return false;
  switch (t) {
    case 'pwc':
      return true; // any PWC member (category in {anchor, healing_arts, both, pwc_other})
    case 'anchor':
      return belongsToPwcGroup(m.category, 'anchor');
    case 'healing_arts':
      return belongsToPwcGroup(m.category, 'healing_arts');
  }
}

function passesCohort(
  dbn: string,
  cohort: string | null,
  pwcByDbn: Map<string, PwcMember>,
): boolean {
  if (cohort == null) return true;
  const m = pwcByDbn.get(dbn);
  return m?.cohort === cohort;
}

function summarizeGeo(g: GeoFilterMap): string {
  const parts: string[] = [];
  for (const layer of GEO_FILTER_LAYERS) {
    const picks = g[layer.id] ?? [];
    if (picks.length === 0) continue;
    const name = layerShortName(layer.id);
    if (picks.length === 1) parts.push(`${name} ${picks[0]}`);
    else parts.push(`${name} (${picks.length})`);
  }
  return parts.join(' · ');
}

function layerShortName(id: GeoFilterLayerId): string {
  switch (id) {
    case 'county': return 'County';
    case 'senate': return 'Senate';
    case 'assembly': return 'Assembly';
    case 'congressional': return 'Cong';
    case 'council': return 'Council';
    case 'school_district': return 'SD';
    case 'community_district': return 'CD';
  }
}

function labelSchoolType(t: SchoolType): string {
  switch (t) {
    case 'pwc': return 'PWC';
    case 'anchor': return 'Anchor';
    case 'healing_arts': return 'Healing Arts';
    case 'all': return 'All';
  }
}

function joinNotes(
  geo: string | null,
  schoolType: string | null,
  cohort: string | null,
): string | null {
  const segs: string[] = [];
  if (geo) segs.push(`Geo: ${geo}`);
  if (schoolType) segs.push(`School Type: ${schoolType}`);
  if (cohort) segs.push(`Cohort: ${cohort}`);
  return segs.length > 0 ? segs.join(' · ') : null;
}
