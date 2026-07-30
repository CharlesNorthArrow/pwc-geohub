/**
 * Year format helpers.
 *
 * The time slider operates in **school_year** format (e.g. "2020-21"). School
 * indicators speak that format directly after Phase 0 normalization (incl.
 * graduation's `cohort_year` → `school_year` remap). Community indicators
 * (ACS / CDC PLACES) store a calendar year (e.g. "2023"); we map the slider's
 * school_year to its spring half to query community data — so when community
 * gets longitudinal backfill later, the slider Just Works across the range.
 *
 * Today most community indicators only have a single year of data, so most
 * slider positions will trigger the 🗓️ "Data not available" branch for the
 * community layer — that's the honest behaviour and the acceptance test.
 */

/** A school-year string within the slider window (e.g. "2024-25"). Widened
 *  from a literal union when the window became clock-derived — use
 *  `isSliderYear` for runtime membership checks. */
export type SliderYear = string;

/**
 * Compute the slider window: '2020-21' (spec §6.5 floor) through the LATER of
 *  - '2025-26' (added per PWC request, resolves spec Q5 — PWC program data
 *    runs one year past the public indicators), and
 *  - the school year whose spring term is the current calendar year.
 *
 * Clock-derived so an Admin Panel upload of a brand-new year has a reachable
 * slider stop without a code edit: on 1 Jan 2027 the '2026-27' stop appears
 * automatically (showing the honest 🗓️ no-data state until data exists).
 * Server and client both compute from their own clock; they can only diverge
 * in the seconds around New Year, which we accept.
 */
export function computeSliderYears(now: Date = new Date()): readonly string[] {
  const FLOOR_START = 2020; // '2020-21'
  const MIN_LAST_START = 2025; // '2025-26'
  const lastStart = Math.max(MIN_LAST_START, now.getFullYear() - 1);
  const out: string[] = [];
  for (let start = FLOOR_START; start <= lastStart; start++) {
    out.push(`${start}-${String((start + 1) % 100).padStart(2, '0')}`);
  }
  return out;
}

/** The year window the slider exposes. */
export const SLIDER_YEARS: readonly string[] = computeSliderYears();

/** Default slider position — always the latest year in the window (so PWC
 *  program data, which runs a year past the public indicators, is what the
 *  app opens on). Indicator layers open in Latest mode anyway, so each still
 *  shows its own freshest data regardless of this position. */
export const DEFAULT_YEAR: SliderYear = SLIDER_YEARS[SLIDER_YEARS.length - 1]!;

/**
 * Convert a school_year ("YYYY-YY") to the calendar year used by community
 * indicators. We take the spring half (e.g. "2020-21" → "2021") because:
 *   - ACS 5-year releases are named after the trailing year
 *   - CDC PLACES tags rows with the release year
 *   - K-12 reporting conventions reference the spring of the academic year
 */
export function toCommunityYear(schoolYear: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(schoolYear);
  if (!m) return null;
  const startYear = Number(m[1]);
  return String(startYear + 1);
}

/**
 * Inverse of `toCommunityYear`. Maps a community calendar year back to the
 * slider's school_year by subtracting one from the start year:
 *   "2021" → "2020-21", "2022" → "2021-22", … "2025" → "2024-25".
 *
 * Returns null when the calendar year falls outside `SLIDER_YEARS` (e.g.
 * "2020" would be "2019-20" — pre-slider). Used by Shell to remap community
 * analytics series rows into the slider's year space so `deriveAnalytics`
 * stays family-agnostic.
 */
export function fromCommunityYear(communityYear: string): SliderYear | null {
  const n = Number.parseInt(communityYear, 10);
  if (!Number.isFinite(n)) return null;
  const start = n - 1;
  const tail = String((start + 1) % 100).padStart(2, '0');
  const candidate = `${start}-${tail}`;
  return isSliderYear(candidate) ? (candidate as SliderYear) : null;
}

export function isSliderYear(s: string): s is SliderYear {
  return (SLIDER_YEARS as readonly string[]).includes(s);
}

/**
 * Project the years an indicator has data for back into the slider's
 * SliderYear space. Used by the time-slider availability dots and the
 * nearest-year jump affordance in YearBadge.
 *  - school indicators speak school_year directly; rows outside `SLIDER_YEARS`
 *    are dropped (the slider can't reach them anyway).
 *  - community indicators speak calendar year; we map via `fromCommunityYear`.
 */
export function indicatorSliderYears(
  family: 'school' | 'community',
  years: readonly string[],
): SliderYear[] {
  const out: SliderYear[] = [];
  for (const y of years) {
    if (family === 'school') {
      if (isSliderYear(y)) out.push(y as SliderYear);
    } else {
      const sy = fromCommunityYear(y);
      if (sy) out.push(sy);
    }
  }
  return out;
}

/**
 * Nearest SliderYear in `availableYears` to `target`, measured by index
 * distance in `SLIDER_YEARS`. Ties break toward the earlier year. Returns
 * null when `availableYears` is empty.
 */
export function nearestSliderYear(
  target: SliderYear,
  availableYears: readonly SliderYear[],
): SliderYear | null {
  if (availableYears.length === 0) return null;
  const targetIdx = SLIDER_YEARS.indexOf(target);
  let best: SliderYear | null = null;
  let bestDist = Infinity;
  for (const y of availableYears) {
    const dist = Math.abs(SLIDER_YEARS.indexOf(y) - targetIdx);
    if (dist < bestDist) {
      best = y;
      bestDist = dist;
    }
  }
  return best;
}
