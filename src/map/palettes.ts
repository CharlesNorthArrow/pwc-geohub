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
