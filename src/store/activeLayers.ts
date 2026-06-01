/**
 * Active-layer resolution — the single place that answers:
 *   - which school + community indicator is active?
 *   - which year is each layer actually displaying for the current slider?
 *   - is each layer in the 🗓️ "no data for this year" branch?
 *   - which layer drives the right-side analytics panel?
 *
 * Pure function: given the user's picks + the latest fetch counts, returns
 * one struct that every consumer (Shell, YearBadge, Legend, TimeSlider,
 * upcoming School Detail / Scorecard / Admin Panel) can read from. Avoids
 * the prior pattern of re-deriving these inside each component.
 *
 * The two `*Count` inputs let us merge a "data fetched but came back empty"
 * signal into `noData`. Pass `null` when no fetch has happened yet (which is
 * what the snapshot harness does — `noData` then reduces to "the indicator's
 * registry doesn't list this year").
 *
 * Per-layer independence: each layer resolves independently. A missing-year
 * on community never knocks out school, and vice versa — that's the §6.6
 * matrix promise.
 */

import type { IndicatorPublic } from '../contract/types';
import {
  fromCommunityYear,
  indicatorSliderYears,
  nearestSliderYear,
  toCommunityYear,
  type SliderYear,
} from '../contract/year';

export interface LayerState {
  indicator: IndicatorPublic;
  /** Year actually being shown for this layer (slider format for school,
   *  calendar format for community); null when in the missing-year branch. */
  displayYear: string | null;
  /** Slider-format year that matches the analytics-series row keys. For
   *  school this is the same as `displayYear`; for community it's the slider
   *  year that maps to `displayYear`'s calendar year. Drives the Detail
   *  Panel's percentile cohort selection so latest-mode (where school and
   *  community may show different years) Just Works. */
  cohortYear: SliderYear | null;
  /** True when the layer has no data for the current slider year — either
   *  the indicator's registry doesn't list it, or the API returned 0 rows. */
  noData: boolean;
  /** SliderYears the indicator has registry coverage for. */
  available: SliderYear[];
  /** Closest available SliderYear (used by the 🗓️ "jump to" affordance);
   *  null when `displayYear` is set or no year is available at all. */
  nearest: SliderYear | null;
}

export interface ActiveLayers {
  school: LayerState | null;
  community: LayerState | null;
  /** Which layer drives the right-side analytics panel. When both families
   *  are active this honors `analyticsFamilyPref`; otherwise it's forced
   *  to whichever family actually has an indicator. */
  analytics: { family: 'school' | 'community'; indicator: IndicatorPublic } | null;
  bothFamiliesActive: boolean;
}

export interface ResolveInput {
  schoolIndicator: IndicatorPublic | null;
  communityIndicator: IndicatorPublic | null;
  sliderYear: SliderYear;
  analyticsFamilyPref: 'school' | 'community';
  /** Feature count from the most recent /api/schools fetch — null when not
   *  fetched. 0 here flips `noData` even when the registry has the year. */
  schoolFeatureCount: number | null;
  /** Value count from the most recent /api/community fetch (null when not
   *  fetched). */
  communityValueCount: number | null;
  /** "Latest year for all" mode — when true, each layer ignores `sliderYear`
   *  and resolves its `displayYear` to ITS OWN latest registry year. The
   *  slider becomes a visual reference only. Default false. */
  latestPerLayer?: boolean;
}

export function resolveActiveLayers({
  schoolIndicator,
  communityIndicator,
  sliderYear,
  analyticsFamilyPref,
  schoolFeatureCount,
  communityValueCount,
  latestPerLayer = false,
}: ResolveInput): ActiveLayers {
  const school = resolveSchoolLayer(schoolIndicator, sliderYear, schoolFeatureCount, latestPerLayer);
  const community = resolveCommunityLayer(communityIndicator, sliderYear, communityValueCount, latestPerLayer);

  const bothFamiliesActive = !!schoolIndicator && !!communityIndicator;
  let analytics: ActiveLayers['analytics'] = null;
  if (bothFamiliesActive) {
    const ind = analyticsFamilyPref === 'school' ? schoolIndicator : communityIndicator;
    analytics = ind ? { family: analyticsFamilyPref, indicator: ind } : null;
  } else if (schoolIndicator) {
    analytics = { family: 'school', indicator: schoolIndicator };
  } else if (communityIndicator) {
    analytics = { family: 'community', indicator: communityIndicator };
  }

  return { school, community, analytics, bothFamiliesActive };
}

function resolveSchoolLayer(
  indicator: IndicatorPublic | null,
  sliderYear: SliderYear,
  featureCount: number | null,
  latestPerLayer: boolean,
): LayerState | null {
  if (!indicator) return null;
  const available = indicatorSliderYears('school', indicator.years);
  let displayYear: string | null;
  if (latestPerLayer) {
    // Layer's own latest — pick the max year inside the slider window so the
    // fetch path stays within validated bounds.
    displayYear = available.length > 0 ? available[available.length - 1]! : null;
  } else {
    const inRegistry = indicator.years.includes(sliderYear);
    // `displayYear` is registry-driven only — it must stay stable across the
    // fetch lifecycle so the fetch effect doesn't oscillate between sliderYear
    // and null when the API returns an empty body. `noData` ORs in the
    // fetched-and-empty signal.
    displayYear = inRegistry ? sliderYear : null;
  }
  const emptyFetch = featureCount === 0;
  const noData = displayYear == null || emptyFetch;
  return {
    indicator,
    displayYear,
    cohortYear: displayYear as SliderYear | null,
    noData,
    available,
    nearest: noData ? nearestSliderYear(sliderYear, available) : null,
  };
}

function resolveCommunityLayer(
  indicator: IndicatorPublic | null,
  sliderYear: SliderYear,
  valueCount: number | null,
  latestPerLayer: boolean,
): LayerState | null {
  if (!indicator) return null;
  const available = indicatorSliderYears('community', indicator.years);
  let displayYear: string | null;
  if (latestPerLayer) {
    // Max calendar year covered by the indicator that ALSO maps into the
    // slider window. We project via `available` then walk back to calendar.
    const lastSlider = available.length > 0 ? available[available.length - 1]! : null;
    displayYear = lastSlider ? toCommunityYear(lastSlider) : null;
  } else {
    const cal = toCommunityYear(sliderYear);
    const inRegistry = !!cal && indicator.years.includes(cal);
    displayYear = inRegistry ? cal! : null;
  }
  const cohortYear: SliderYear | null = displayYear ? fromCommunityYear(displayYear) : null;
  const emptyFetch = valueCount === 0;
  const noData = displayYear == null || emptyFetch;
  return {
    indicator,
    displayYear,
    cohortYear,
    noData,
    available,
    nearest: noData ? nearestSliderYear(sliderYear, available) : null,
  };
}
