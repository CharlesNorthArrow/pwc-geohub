/**
 * Color palettes — perceptually-uniform sequential ramps for choropleth +
 * point fills, plus a qualitative palette for categorical indicators.
 *
 * Map ramps are deliberately separate from PWC brand chrome (spec §8) so
 * the data legibility doesn't fight the brand.
 *
 * Sampled 5-stop ramps from canonical sources:
 *  - VIRIDIS — `viridis` (Matplotlib); used for `good_direction = high`.
 *  - ROCKET_R — reverse `rocket` (seaborn); used for `good_direction = low`
 *    so the most saturated end always carries the "bad" signal.
 *  - QUALITATIVE — d3 category10 first four; used for categorical indicators
 *    (e.g. `racial_predominance`).
 */

export const VIRIDIS_5 = ['#440154', '#3b528b', '#21908d', '#5dc863', '#fde725'] as const;
export const ROCKET_R_5 = ['#fbe7c6', '#f1a07a', '#dd5f5f', '#a82255', '#43012e'] as const;

/* -------------------------------------------------------------------------- */
/* Theme-keyed diverging palettes (muted, by request)                         */
/*                                                                            */
/* Each pair is bin0 → bin4 (worst → best for the "good" direction). All     */
/* arrays read low-to-high index = low-to-high *value*. The `rampForIndicator` */
/* helper handles the high-good vs low-good flip.                             */
/* -------------------------------------------------------------------------- */

/** Student Outcomes — muted red↔blue. Low-value end = red (bad when good=high). */
export const DIVERGING_RDBU_MUTED = [
  '#b85b6e', // bad
  '#dba3ab',
  '#ebebeb', // neutral
  '#a3bcd1',
  '#5d83a8', // good
] as const;

/** Student Experience — muted purple↔green. */
export const DIVERGING_PUGN_MUTED = [
  '#8e5a8e', // bad (purple)
  '#cdaecd',
  '#ebebeb',
  '#a8cca0',
  '#5d8e60', // good (green)
] as const;

/** Staff & School Culture — muted dark grey↔teal. */
export const DIVERGING_GREYTEAL_MUTED = [
  '#4a4a4a', // bad (dark grey)
  '#a8a8a8',
  '#dedede',
  '#9cc5c4',
  '#3a8a8a', // good (teal)
] as const;

/**
 * Community sequential ramp — light grey (#D3DCE8) → deep brick red (#932B25).
 * Stops are HAND-PICKED (not linear-RGB interpolated) to maximize perceptual
 * distinction between bins. Earlier linear interpolation produced muddy mids
 * (all greys-with-a-hint-of-pink) that read as "kinda the same color"; this
 * version pushes mid stops toward warm/saturated reds so bin1→bin4 shows a
 * clear ramp of intensity, not just luminance.
 *
 * Used for every sequential community indicator regardless of good_direction;
 * the community registry uses `good_direction: 'low'` across the board, so
 * low values land at the grey end (neutral) and high values land at the deep
 * red end (intense), matching the natural "color = intensity of concern"
 * reading.
 */
export const COMMUNITY_GREY_RED = [
  '#D3DCE8', // bin 0 — light grey-blue (user anchor, low/neutral)
  '#D9A8A4', // bin 1 — light salmon (clear jump from grey)
  '#BC6F5E', // bin 2 — warm rust
  '#A8554C', // bin 3 — strong brick red
  '#932B25', // bin 4 — deep brick red (user anchor, high/intense)
] as const;

/** Stable category → color map for the 4 race categories the registry ships. */
export const RACE_QUALITATIVE: Readonly<Record<string, string>> = {
  White: '#1f77b4',
  Black: '#ff7f0e',
  Asian: '#2ca02c',
  Hispanic: '#d62728',
};

export type Ramp = readonly string[];

/** Pick the 5-stop sequential ramp for an indicator based on `good_direction`. */
export function rampFor(goodDirection: 'high' | 'low' | 'none'): Ramp {
  if (goodDirection === 'low') return ROCKET_R_5;
  // `high` and `none` both use viridis — neutral perceptually-uniform default.
  return VIRIDIS_5;
}

/* -------------------------------------------------------------------------- */
/* Theme-aware ramp dispatch                                                  */
/* -------------------------------------------------------------------------- */

/**
 * School themes that use muted diverging palettes (per UX request). Each
 * theme maps to a base ramp; the ramp is reversed when `good_direction` is
 * low, so the "bad" color always lands on the value-axis end where bad
 * lives. Themes not in this map (and all community indicators) fall back
 * to the original sequential `rampFor` behavior.
 */
const SCHOOL_THEME_DIVERGING: Readonly<Record<string, Ramp>> = {
  'Student Outcomes': DIVERGING_RDBU_MUTED,
  'Student Experience': DIVERGING_PUGN_MUTED,
  'Staff & School Culture': DIVERGING_GREYTEAL_MUTED,
};

/**
 * Theme-aware ramp picker. Returns a 5-stop ramp ordered bin0 → bin4:
 *  - high-good: low value → bad color, high value → good color
 *  - low-good:  low value → good color, high value → bad color
 *
 * The base palettes above are written low-to-high = bad-to-good (i.e.
 * intuitive when good=high). For low-good indicators we reverse so the
 * lowest-value bin reads "good".
 */
export function rampForIndicator(
  family: 'school' | 'community',
  theme: string,
  goodDirection: 'high' | 'low' | 'none',
): Ramp {
  if (family === 'school') {
    const base = SCHOOL_THEME_DIVERGING[theme];
    if (base) {
      return goodDirection === 'low' ? [...base].reverse() : base;
    }
    return rampFor(goodDirection);
  }
  // Community family — single grey→red ramp for every sequential indicator.
  // Reverse for good_direction='high' so the bin0→bin4 = bad→good convention
  // holds. The current community registry uses 'low' across the board, so
  // the reverse branch is defensive and exercised when new indicators arrive.
  return goodDirection === 'high'
    ? [...COMMUNITY_GREY_RED].reverse()
    : COMMUNITY_GREY_RED;
}
