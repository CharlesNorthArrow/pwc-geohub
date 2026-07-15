/**
 * Color palettes — one diverging ramp for school bubbles, one sequential
 * ramp for community choropleths, plus a qualitative palette for
 * categorical indicators (e.g. `racial_predominance`).
 *
 * Map ramps are deliberately separate from PWC brand chrome (spec §8) so
 * the data legibility doesn't fight the brand.
 */

/**
 * THE school indicator ramp — a single red↔blue diverging palette for every
 * school indicator, regardless of theme (2026-07 standardization; the
 * previous per-theme palettes read as three different "systems"). Ordered
 * bin0 → bin4 = bad → good; `rampForIndicator` flips it for low-good
 * indicators so red always carries the "bad" signal.
 */
export const DIVERGING_RDBU_MUTED = [
  '#a82838', // bad (deep red)
  '#e07a8a', // light red
  '#b9c0c8', // neutral mid (legible grey)
  '#5d92c4', // medium blue
  '#1f4d8c', // good (strong navy)
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
  '#F0A8A0', // bin 1 — vivid light salmon
  '#E26A55', // bin 2 — vivid coral
  '#C44438', // bin 3 — vivid brick red
  '#932B25', // bin 4 — deep brick red (user anchor, high/intense)
] as const;

/**
 * Stable category → color map for `racial_predominance`. Hex codes sampled
 * from PWC's authoritative ArcGIS Story Map / IIT renderer so this map reads
 * identically when Wes presents alongside it. AmInd / Some Other Race
 * winners are suppressed at ETL time, so any tract whose `value_text` is not
 * a key here will fall through to the no-data path.
 */
export const RACE_QUALITATIVE: Readonly<Record<string, string>> = {
  White: '#D5D5D5',
  Latinx: '#D8B600',
  Black: '#6FA980',
  Asian: '#3761C3',
  'Pacific Islander': '#B49A7F',
  'Two or More Races': '#9A6BA2',
};

export type Ramp = readonly string[];

/**
 * Ramp picker. Returns a 5-stop ramp ordered bin0 → bin4 along the VALUE
 * axis:
 *  - high-good: low value → bad color, high value → good color
 *  - low-good:  low value → good color, high value → bad color
 *
 * School family: the single red↔blue diverging ramp for every indicator
 * (reversed for low-good so red = bad on the correct end). The `theme`
 * param is kept for signature stability; it no longer affects the ramp.
 */
export function rampForIndicator(
  family: 'school' | 'community',
  theme: string,
  goodDirection: 'high' | 'low' | 'none',
): Ramp {
  void theme;
  if (family === 'school') {
    return goodDirection === 'low' ? [...DIVERGING_RDBU_MUTED].reverse() : DIVERGING_RDBU_MUTED;
  }
  // Community family — single grey→red ramp for every sequential indicator.
  // Reverse for good_direction='high' so the bin0→bin4 = bad→good convention
  // holds. The current community registry uses 'low' across the board, so
  // the reverse branch is defensive and exercised when new indicators arrive.
  return goodDirection === 'high'
    ? [...COMMUNITY_GREY_RED].reverse()
    : COMMUNITY_GREY_RED;
}
