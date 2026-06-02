/**
 * Phase 5 analytics derivation — KPIs, timeline, ranked list, all in one
 * pure function so client + tests + future Phase 6 polish read the same
 * source of truth (mirrors the Phase 3 `applyFilters` pattern).
 *
 * Inputs (everything the panel needs to render):
 *   - the active indicator (with `good_direction`)
 *   - the active year (slider)
 *   - the series response (all years × all schools)
 *   - per-year PWC membership map
 *   - the Phase 3 filtered universe (the school list the rest of the app sees)
 *
 * Outputs:
 *   - kpis: per-group { n, avg, delta } at the active year
 *   - timeline: 3 series (Anchor avg, HA avg, citywide avg) per year
 *   - list: ranked PWC schools (worst → best per good_direction) with sparkline
 *
 * §5.5 + §6.6 nuance:
 *   - KPI all-schools-avg respects Geo + School Type + Cohort (universe.schoolDbns).
 *   - Timeline citywide line respects Geo + School Type but NOT Cohort — uses
 *     `universe.afterSchoolType` instead.
 *   - KPIs + ranked list use per-year PWC membership (the snapshot at the
 *     active slider year).
 *   - TIMELINE backfills membership from the LATEST PWC vintage so a school
 *     that's currently Anchor contributes its indicator value across all
 *     historical years on the chart — the user wants to see the trajectory
 *     of "schools that are PWC now," not "schools that were PWC then."
 *   - Anchor-wins: both-category schools count ONLY in the Anchor group
 *     (see `belongsToPwcGroup` — the Healing Arts group is disjoint from
 *     Anchor, never an overlap).
 */

import type {
  AnalyticsSeriesRow,
  IndicatorPublic,
  PwcMember,
} from '../contract/types';
import type { GoodDirection } from '../registry/types';
import type { FilteredUniverse } from './derived';
import { belongsToPwcGroup } from './pwcGroups';

export type ListCategory = 'anchor' | 'healing_arts' | 'both' | 'pwc_other';

export interface KpiCell {
  n: number;
  avg: number | null;
  /** Delta vs all-schools-avg (in raw units, e.g. percentage points). */
  delta: number | null;
}

export interface KpiSet {
  anchor: KpiCell;
  healing_arts: KpiCell;
  all: KpiCell;
}

export interface TimelinePoint {
  year: string;
  anchor: { n: number; avg: number | null };
  healing_arts: { n: number; avg: number | null };
  /** Citywide reference — Geo + School Type applied, NOT Cohort. */
  citywide: { n: number; avg: number | null };
}

export interface RankedRow {
  dbn: string;
  category: ListCategory;
  latestValue: number | null;
  /** [year, value | null] pairs ordered ascending by year. */
  spark: Array<{ year: string; value: number | null }>;
}

export interface Analytics {
  kpis: KpiSet;
  timeline: TimelinePoint[];
  list: RankedRow[];
}

interface DeriveInput {
  indicator: IndicatorPublic;
  year: string;
  series: AnalyticsSeriesRow[];
  pwcByYear: Record<string, PwcMember[]>;
  universe: FilteredUniverse;
  /** All years to show on the timeline — typically the 5 slider years
   *  (the call site decides; usually `SLIDER_YEARS`). */
  timelineYears: readonly string[];
}

export function deriveAnalytics({
  indicator,
  year,
  series,
  pwcByYear,
  universe,
  timelineYears,
}: DeriveInput): Analytics {
  // Index series by (year, dbn) for O(1) lookup.
  const byYear = new Map<string, Map<string, number>>();
  for (const r of series) {
    if (r.value_num == null) continue;
    let inner = byYear.get(r.year);
    if (!inner) {
      inner = new Map();
      byYear.set(r.year, inner);
    }
    inner.set(r.dbn, r.value_num);
  }

  const valuesAt = (y: string): Map<string, number> => byYear.get(y) ?? new Map();

  const pwcAt = (y: string): Map<string, PwcMember> => {
    const list = pwcByYear[y] ?? [];
    return new Map(list.map((m) => [m.dbn, m]));
  };

  /* -------------------- KPIs at the active year -------------------- */
  const valuesNow = valuesAt(year);
  const pwcNow = pwcAt(year);

  const allValuesInUniverse: number[] = [];
  for (const dbn of universe.schoolDbns) {
    const v = valuesNow.get(dbn);
    if (v != null) allValuesInUniverse.push(v);
  }
  const allAvg = mean(allValuesInUniverse);

  const anchorValues: number[] = [];
  const healingValues: number[] = [];
  for (const dbn of universe.schoolDbns) {
    const v = valuesNow.get(dbn);
    if (v == null) continue;
    const m = pwcNow.get(dbn);
    if (!m) continue;
    if (belongsToPwcGroup(m.category, 'anchor')) anchorValues.push(v);
    if (belongsToPwcGroup(m.category, 'healing_arts')) healingValues.push(v);
  }
  const anchorAvg = mean(anchorValues);
  const healingAvg = mean(healingValues);

  const kpis: KpiSet = {
    anchor: {
      n: anchorValues.length,
      avg: anchorAvg,
      delta: anchorAvg != null && allAvg != null ? anchorAvg - allAvg : null,
    },
    healing_arts: {
      n: healingValues.length,
      avg: healingAvg,
      delta: healingAvg != null && allAvg != null ? healingAvg - allAvg : null,
    },
    all: { n: allValuesInUniverse.length, avg: allAvg, delta: null },
  };

  /* -------------------- Timeline (3 series × N years) --------------------
   * Timeline uses LATEST-vintage PWC membership for every year on the chart,
   * so a school that's Anchor today contributes its 2019 / 2020 / … values
   * to the Anchor line even though it may not have been on the program then.
   * Backfilling like this lets the user see the trajectory of "schools that
   * are PWC now" rather than "schools that were PWC at year Y." */
  const pwcLatest = latestPwcMembership(pwcByYear);
  const timeline: TimelinePoint[] = timelineYears.map((y) => {
    const vYear = valuesAt(y);

    // Citywide line — pre-Cohort universe (afterSchoolType).
    const cityVals: number[] = [];
    for (const dbn of universe.afterSchoolType) {
      const v = vYear.get(dbn);
      if (v != null) cityVals.push(v);
    }

    // Anchor / HA lines — full filtered universe, latest-vintage membership.
    const anchorVals: number[] = [];
    const haVals: number[] = [];
    for (const dbn of universe.schoolDbns) {
      const v = vYear.get(dbn);
      if (v == null) continue;
      const m = pwcLatest.get(dbn);
      if (!m) continue;
      if (belongsToPwcGroup(m.category, 'anchor')) anchorVals.push(v);
      else if (belongsToPwcGroup(m.category, 'healing_arts')) haVals.push(v);
    }

    return {
      year: y,
      anchor: { n: anchorVals.length, avg: mean(anchorVals) },
      healing_arts: { n: haVals.length, avg: mean(haVals) },
      citywide: { n: cityVals.length, avg: mean(cityVals) },
    };
  });

  /* -------------------- Ranked PWC school list -------------------- */
  const list: RankedRow[] = [];
  for (const [dbn, m] of pwcNow) {
    if (!universe.schoolDbns.has(dbn)) continue; // respects all filters
    const latest = valuesNow.get(dbn);
    const spark = timelineYears.map((y) => ({
      year: y,
      value: valuesAt(y).get(dbn) ?? null,
    }));
    list.push({
      dbn,
      category: m.category as ListCategory,
      latestValue: latest ?? null,
      spark,
    });
  }
  // Worst → best per good_direction.
  const sortedList = rankByGoodDirection(
    list,
    (r) => r.latestValue,
    indicator.scale.good_direction,
    (r) => r.dbn,
  );

  return { kpis, timeline, list: sortedList };
}

/**
 * Sort `rows` worst → best for a given `good_direction`. Nulls sort last.
 * `tiebreakKey` (typically `r => r.dbn`) keeps output deterministic when
 * values match or both sides are null. Pure; returns a new array.
 *
 * Exported so future features (School Detail, Scorecard) can rank their own
 * rows without re-deriving the worst→best convention.
 */
export function rankByGoodDirection<T>(
  rows: T[],
  valueOf: (row: T) => number | null,
  goodDirection: GoodDirection,
  tiebreakKey: (row: T) => string,
): T[] {
  const out = rows.slice();
  out.sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    if (av == null && bv == null) return tiebreakKey(a).localeCompare(tiebreakKey(b));
    if (av == null) return 1;
    if (bv == null) return -1;
    if (goodDirection === 'low') return bv - av;
    if (goodDirection === 'high') return av - bv;
    return tiebreakKey(a).localeCompare(tiebreakKey(b));
  });
  return out;
}

/**
 * The most recent PWC membership snapshot in `pwcByYear`. Keys are sortable
 * school_year strings ("2024-25" > "2023-24" lexicographically), so the max
 * key gives us the freshest vintage. Returns a Dbn→PwcMember map for O(1)
 * lookups in the timeline loop. Empty input → empty map.
 */
function latestPwcMembership(
  pwcByYear: Record<string, PwcMember[]>,
): Map<string, PwcMember> {
  const years = Object.keys(pwcByYear);
  if (years.length === 0) return new Map();
  years.sort();
  const latest = years[years.length - 1]!;
  return new Map((pwcByYear[latest] ?? []).map((m) => [m.dbn, m]));
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

/** Maps (delta, good_direction) → semantic status for color in cards. */
export function deltaStatus(
  delta: number | null,
  goodDirection: IndicatorPublic['scale']['good_direction'],
): 'better' | 'worse' | 'neutral' {
  if (delta == null || goodDirection === 'none' || delta === 0) return 'neutral';
  const positive = delta > 0;
  return positive === (goodDirection === 'high') ? 'better' : 'worse';
}
