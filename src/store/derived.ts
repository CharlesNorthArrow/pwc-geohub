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
  PROGRAM_FLAGS,
  type GeoFilterLayerId,
  type ProgramFlag,
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
  /** Note shown above the Program dropdown — Geo + School Type + Cohort. */
  forProgram: string | null;
  /** Note shown above the Grade dropdown — Geo + School Type + Cohort + Program. */
  forGrade: string | null;
  /** Note shown above the School dropdown — every upstream filter. */
  forSchool: string | null;
}

export interface FilteredUniverse {
  /** DBNs that pass every active filter. Use this for the map + Phase 5. */
  schoolDbns: Set<string>;
  /** DBNs that pass only Geo (used to decide School Type counts). */
  afterGeo: Set<string>;
  /** DBNs that pass Geo + School Type (used to compute cohort options/counts). */
  afterSchoolType: Set<string>;
  /** DBNs that pass Geo + School Type + Cohort. */
  afterCohort: Set<string>;
  /** DBNs that pass Geo + School Type + Cohort + Program. */
  afterProgram: Set<string>;
  /** Cohort options shown in the dropdown, with `count` = number of in-view
   *  schools that belong to that cohort under the current Geo + School Type
   *  cascade. Greyed/disabled when count = 0 (per the agreed UX). */
  cohortOptions: Array<{ cohort: string; count: number }>;
  /** Pre-filter notes per downstream dropdown. */
  prefilterSummary: PrefilterSummary;
}

interface FiltersInput {
  state: Pick<HubState, 'geoFilters' | 'schoolType' | 'cohort' | 'programs' | 'grades'>;
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
  const schoolByDbn = new Map(schoolsMaster.map((s) => [s.dbn, s]));

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
  const afterCohort = new Set<string>();
  for (const dbn of afterSchoolType) {
    if (passesCohort(dbn, state.cohort, pwcByDbn)) afterCohort.add(dbn);
  }

  // --- Step 4: Program cascade (PWC-only, OR over picked flags) ------------
  const afterProgram = new Set<string>();
  for (const dbn of afterCohort) {
    if (passesProgram(dbn, state.programs, pwcByDbn)) afterProgram.add(dbn);
  }

  // --- Step 5: Grade cascade (OR over picked tokens) -----------------------
  const finalSet = new Set<string>();
  for (const dbn of afterProgram) {
    if (passesGrade(dbn, state.grades, schoolByDbn)) finalSet.add(dbn);
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
  const programSummary = summarizePrograms(state.programs);
  const gradeSummary = summarizeGrades(state.grades);

  const forSchoolType = geoSummary ? `Geo: ${geoSummary}` : null;
  const forCohort = joinNotes({ geo: geoSummary, schoolType: schoolTypeSummary });
  const forProgram = joinNotes({
    geo: geoSummary,
    schoolType: schoolTypeSummary,
    cohort: cohortSummary,
  });
  const forGrade = joinNotes({
    geo: geoSummary,
    schoolType: schoolTypeSummary,
    cohort: cohortSummary,
    program: programSummary,
  });
  const forSchool = joinNotes({
    geo: geoSummary,
    schoolType: schoolTypeSummary,
    cohort: cohortSummary,
    program: programSummary,
    grade: gradeSummary,
  });

  return {
    schoolDbns: finalSet,
    afterGeo,
    afterSchoolType,
    afterCohort,
    afterProgram,
    cohortOptions,
    prefilterSummary: { forSchoolType, forCohort, forProgram, forGrade, forSchool },
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

/** Program filter: OR across picked flags. Empty pick = pass. Non-PWC dbns
 *  drop out because they're absent from `pwcByDbn` — selection implicitly
 *  scopes the universe to PWC schools. Honors per-year active logic because
 *  `pwcByDbn` is built from the slider-year membership snapshot. */
function passesProgram(
  dbn: string,
  picked: ProgramFlag[],
  pwcByDbn: Map<string, PwcMember>,
): boolean {
  if (picked.length === 0) return true;
  const m = pwcByDbn.get(dbn);
  if (!m) return false;
  for (const flag of picked) {
    if (m[flag]) return true;
  }
  return false;
}

/** Grade filter: OR across picked tokens. Empty pick = pass. Compares against
 *  `schools_master.grades_canonical` (already normalized at the server). */
function passesGrade(
  dbn: string,
  picked: string[],
  schoolByDbn: Map<string, SchoolMaster>,
): boolean {
  if (picked.length === 0) return true;
  const s = schoolByDbn.get(dbn);
  if (!s) return false;
  if (s.grades_canonical.length === 0) return false;
  const set = new Set(s.grades_canonical);
  for (const g of picked) {
    if (set.has(g)) return true;
  }
  return false;
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
    case 'nta_2020': return 'NTA';
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

interface NoteParts {
  geo?: string | null;
  schoolType?: string | null;
  cohort?: string | null;
  program?: string | null;
  grade?: string | null;
}

function joinNotes(parts: NoteParts): string | null {
  const segs: string[] = [];
  if (parts.geo) segs.push(`Geo: ${parts.geo}`);
  if (parts.schoolType) segs.push(`School Type: ${parts.schoolType}`);
  if (parts.cohort) segs.push(`Cohort: ${parts.cohort}`);
  if (parts.program) segs.push(`Program: ${parts.program}`);
  if (parts.grade) segs.push(`Grade: ${parts.grade}`);
  return segs.length > 0 ? segs.join(' · ') : null;
}

function summarizePrograms(picked: ProgramFlag[]): string | null {
  if (picked.length === 0) return null;
  if (picked.length === 1) {
    const flag = picked[0]!;
    const def = PROGRAM_FLAGS.find((p) => p.id === flag);
    return def?.label ?? flag;
  }
  return `${picked.length} selected`;
}

function summarizeGrades(picked: string[]): string | null {
  if (picked.length === 0) return null;
  if (picked.length <= 4) return picked.join(', ');
  return `${picked.length} selected`;
}
