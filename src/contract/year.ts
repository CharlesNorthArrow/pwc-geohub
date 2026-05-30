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

/** The 5-year window the Phase 4 slider exposes (spec §6.5). */
export const SLIDER_YEARS = ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25'] as const;
export type SliderYear = (typeof SLIDER_YEARS)[number];

/** Default slider position — the spec's "latest available year" convention. */
export const DEFAULT_YEAR: SliderYear = '2024-25';

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
