/**
 * Percentile selector — places one school in the in-view distribution of
 * any active indicator. Consumed by the School Detail Panel's §1.a (and
 * later by Scorecard).
 *
 * What this DOES:
 *   - intersects the analytics series with `universeDbns` (the Phase 3
 *     filtered universe) and keeps only the rows whose `value_num` is
 *     non-null at the requested year — that's the comparison cohort.
 *   - looks up the selected school's value within the cohort.
 *   - computes a "percent of in-view schools this school does BETTER than"
 *     reading via `good_direction`, so the same percentile means the same
 *     thing across high-is-good and low-is-good indicators.
 *
 * What this does NOT do:
 *   - it does NOT compute the universe (call `applyFilters` upstream);
 *   - it does NOT compute the community aggregation — the SQL behind
 *     `getAnalyticsSeries` already produced per-school aggregated rows
 *     (§11.9 invariant: crosswalks, not point-in-polygon at request time);
 *   - it does NOT re-resolve the year (call `resolveActiveLayers` upstream).
 *
 * All of those live in shared selectors already; this builds on top.
 *
 * Tied rank semantics: ranks are assigned 1..N worst→best with EQUAL values
 * sharing the lowest rank in their tie (the "1224" / standard competition
 * ranking convention) so a tie can't put two schools in different cohorts.
 */

import type { AnalyticsSeriesRow } from '../contract/types';
import type { GoodDirection } from '../registry/types';

export interface PercentileInput {
  series: AnalyticsSeriesRow[];
  /** Slider-format year for the cohort (school indicators speak this format
   *  directly; for community indicators Shell already remaps calendar→slider
   *  via `fromCommunityYear` before handing the series here). */
  year: string;
  universeDbns: Set<string>;
  selectedDbn: string;
  goodDirection: GoodDirection;
}

export interface PercentileResult {
  /** In-view schools with a non-null value at `year`, ascending. */
  cohortValues: number[];
  /** Selected school's value at `year`, or null when not in series. */
  selfValue: number | null;
  /** 1-based rank, worst → best per `goodDirection`. Null when self has
   *  no value or cohort is empty. */
  rank: number | null;
  /** Total cohort size (n with values, includes the selected school when
   *  selfValue is non-null). */
  cohortSize: number;
  /** Fraction in [0,1] of cohort the selected school does BETTER than per
   *  `goodDirection`. Null when self has no value or cohort < 2. */
  betterThanFraction: number | null;
  /** Display-ready callout string for the panel. */
  callout: string;
}

export function computePercentile({
  series,
  year,
  universeDbns,
  selectedDbn,
  goodDirection,
}: PercentileInput): PercentileResult {
  // Build cohort: in-view schools with a value at the requested year.
  // We index by dbn to dedupe in case the upstream join ever produced more
  // than one row per (dbn, year).
  const cohortByDbn = new Map<string, number>();
  let selfValue: number | null = null;
  for (const r of series) {
    if (r.year !== year) continue;
    if (r.value_num == null) continue;
    if (r.dbn === selectedDbn) {
      // Selected school is INCLUDED in the cohort regardless of whether it
      // sits inside the current filter universe — the user explicitly picked
      // it. Filtering it out would make the percentile undefined for a school
      // that just stepped outside its own filter (e.g. picking an East
      // Harlem school after selecting cohort=Brownsville).
      selfValue = r.value_num;
      cohortByDbn.set(r.dbn, r.value_num);
      continue;
    }
    if (!universeDbns.has(r.dbn)) continue;
    cohortByDbn.set(r.dbn, r.value_num);
  }

  const cohortValues = [...cohortByDbn.values()].sort((a, b) => a - b);
  const cohortSize = cohortValues.length;

  if (selfValue == null) {
    return {
      cohortValues,
      selfValue: null,
      rank: null,
      cohortSize,
      betterThanFraction: null,
      callout: cohortSize === 0
        ? 'No comparison group — no in-view schools have data for this year.'
        : 'No data for this school this year.',
    };
  }

  if (cohortSize < 2) {
    return {
      cohortValues,
      selfValue,
      rank: 1,
      cohortSize,
      betterThanFraction: null,
      callout: 'Only school in view with data for this year.',
    };
  }

  // Count how many cohort schools the selected one does strictly better
  // than. "Better" is direction-aware: for good='high' a higher value is
  // better; for good='low' a lower value is better; for good='none' we just
  // report the position.
  let strictlyWorse = 0;
  for (const v of cohortValues) {
    if (v === selfValue) continue;
    if (goodDirection === 'high' && selfValue > v) strictlyWorse++;
    else if (goodDirection === 'low' && selfValue < v) strictlyWorse++;
    else if (goodDirection === 'none' && selfValue > v) strictlyWorse++;
  }

  // Standard-competition rank, worst → best per direction.
  // For good='high', WORST = lowest value; rank 1 = lowest. For good='low',
  // worst = highest value; rank 1 = highest. For good='none' we treat it
  // like good='high' so the ranked list has a deterministic order.
  let strictlyBetterForRank = 0;
  for (const v of cohortValues) {
    if (v === selfValue) continue;
    if (goodDirection === 'low') {
      // lower=better → worst→best = highest→lowest → rank by how many cohort
      // values are HIGHER than self (those are "worse" than self).
      if (v > selfValue) strictlyBetterForRank++;
    } else {
      // high or none → worst→best = lowest→highest → rank by how many cohort
      // values are LOWER than self (worse than self).
      if (v < selfValue) strictlyBetterForRank++;
    }
  }
  const rank = strictlyBetterForRank + 1;

  // "Better-than-fraction" is symmetric for high/low; for `none` we use it
  // as a neutral position indicator only and the callout reflects that.
  const betterThanFraction = strictlyWorse / (cohortSize - 1);

  const pct = Math.round(betterThanFraction * 100);
  let callout: string;
  if (goodDirection === 'none') {
    callout = `Higher than ${pct}% of schools in view · rank ${rank} of ${cohortSize}`;
  } else if (cohortSize < 10) {
    // Small-N: percentiles from 6-9 schools mislead. Lead with rank.
    callout = `Rank ${rank} of ${cohortSize} schools in view`;
  } else {
    callout = `Better than ${pct}% of schools in view · rank ${rank} of ${cohortSize}`;
  }

  return {
    cohortValues,
    selfValue,
    rank,
    cohortSize,
    betterThanFraction,
    callout,
  };
}
