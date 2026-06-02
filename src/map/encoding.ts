/**
 * Encoding logic — value→color and enrollment→radius. Used by BOTH `<MapView/>`
 * (via MapLibre paint expressions) and `<Legend/>` (HTML swatches). Keeping
 * them in one module is the spec §11.4 anti-debt rule: legend can never
 * disagree with the map because both reference these same bins.
 */

import type { IndicatorPublic } from '../contract/types';
import { RACE_QUALITATIVE, rampForIndicator, type Ramp } from './palettes';

/* -------------------------------------------------------------------------- */
/* Color bins                                                                 */
/* -------------------------------------------------------------------------- */

export interface SequentialBins {
  type: 'sequential';
  /** Length 5; ramp[i] applies when value < edges[i] (or last bin). */
  ramp: Ramp;
  /** Length 4 — internal break points. Bin 0: ≤edges[0]; bin 4: >edges[3]. */
  edges: [number, number, number, number];
  format: (v: number) => string;
}

export interface CategoricalBins {
  type: 'categorical';
  categories: string[];
  /** Map from category label → color. */
  colorFor: (cat: string) => string;
}

export type ColorBins = SequentialBins | CategoricalBins | { type: 'none' };

/**
 * Build the bin scale for an indicator + its observed domain. Sequential
 * indicators default to **equal-interval** bins over the observed min/max.
 * Indicators flagged with `scale.bin_method === 'quantile'` use **quintile**
 * edges (20/40/60/80 percentiles) instead — better for skewed distributions
 * where equal-interval lumps most tracts in one bin.
 *
 * `allValues` is required for quantile binning (we need the full distribution
 * to compute percentiles); when absent, quantile-flagged indicators fall back
 * to equal-interval so this stays a pure function. Both the Legend and the
 * MapView path the same value list down so legend swatches and tract colors
 * never disagree (spec §11.4).
 */
export function colorBinsFor(
  indicator: IndicatorPublic,
  domain: { min: number; max: number } | null,
  allValues?: ReadonlyArray<number>,
): ColorBins {
  if (indicator.scale.type === 'categorical') {
    const categories = indicator.scale.categories ?? [];
    return {
      type: 'categorical',
      categories,
      colorFor: (cat: string) => RACE_QUALITATIVE[cat] ?? '#999999',
    };
  }
  if (!domain || !Number.isFinite(domain.min) || !Number.isFinite(domain.max) || domain.min === domain.max) {
    return { type: 'none' };
  }
  const ramp = rampForIndicator(
    indicator.family,
    indicator.theme,
    indicator.scale.good_direction,
  );
  const wantsQuantile = indicator.scale.bin_method === 'quantile';
  const quantileEdges =
    wantsQuantile && allValues && allValues.length > 0
      ? quintileEdges(allValues)
      : null;
  const edges: [number, number, number, number] = quantileEdges ?? equalIntervalEdges(domain);
  return { type: 'sequential', ramp, edges, format: formatterFor(indicator) };
}

function equalIntervalEdges(domain: { min: number; max: number }): [number, number, number, number] {
  const span = domain.max - domain.min;
  const step = span / 5;
  return [
    domain.min + step,
    domain.min + 2 * step,
    domain.min + 3 * step,
    domain.min + 4 * step,
  ];
}

/**
 * Quintile (20/40/60/80 percentile) edges over the full value distribution.
 * Returns null when the data is too degenerate to compute distinct edges
 * (e.g. >80% of values identical) — caller falls back to equal-interval.
 */
function quintileEdges(values: ReadonlyArray<number>): [number, number, number, number] | null {
  const sorted = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const at = (p: number): number => {
    // Linear-interpolation between two nearest ranks (standard "type 7" quantile).
    const idx = p * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const w = idx - lo;
    return sorted[lo]! * (1 - w) + sorted[hi]! * w;
  };
  const e: [number, number, number, number] = [at(0.2), at(0.4), at(0.6), at(0.8)];
  // Strictly increasing? If not, distribution is too clumped — bail to
  // equal-interval so the legend isn't degenerate.
  if (!(e[0] < e[1] && e[1] < e[2] && e[2] < e[3])) return null;
  return e;
}

/** Strip a trailing `.0` so legend brackets read `12%` not `12.0%`, while
 *  keeping precision when the fractional part is non-zero (`12.5%`). */
function trim(v: string): string {
  return v.replace(/\.0+(?=[^\d]|$)/, '');
}

function formatterFor(indicator: IndicatorPublic): (v: number) => string {
  switch (indicator.format) {
    case 'percent':
    case 'rate_per_100':
      return (v) => `${trim(v.toFixed(1))}%`;
    case 'integer':
    case 'count':
      return (v) => `${Math.round(v)}`;
    case 'index':
      return (v) => trim(v.toFixed(2));
    default:
      return (v) => trim(v.toFixed(1));
  }
}

/** MapLibre `paint['fill-color']` / `paint['circle-color']` step expression. */
export function colorExpression(bins: ColorBins, valueAccessor: unknown[]): unknown {
  if (bins.type === 'none') return '#cccccc';
  if (bins.type === 'categorical') {
    const match: unknown[] = ['match', valueAccessor];
    for (const cat of bins.categories) match.push(cat, bins.colorFor(cat));
    match.push('#999999');
    return match;
  }
  // Sequential: ['step', value, color0, edge0, color1, edge1, color2, edge2, color3, edge3, color4]
  return [
    'step',
    valueAccessor,
    bins.ramp[0],
    bins.edges[0], bins.ramp[1],
    bins.edges[1], bins.ramp[2],
    bins.edges[2], bins.ramp[3],
    bins.edges[3], bins.ramp[4],
  ];
}

/* -------------------------------------------------------------------------- */
/* Enrollment → radius                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Reference radii (in CSS pixels) driven by total_enrollment. These are the
 * sizes at the LEGEND zoom — the on-map size scales up/down with zoom via
 * `radiusExpression`'s interpolation (see below). Stable across indicators
 * so size is comparable when switching the active indicator (spec §4.2).
 */
export const ENROLLMENT_BINS = [
  { upTo: 200, radius: 3, label: '≤200' },
  { upTo: 400, radius: 5, label: '201–400' },
  { upTo: 700, radius: 7, label: '401–700' },
  { upTo: 1200, radius: 9, label: '701–1,200' },
  { upTo: Infinity, radius: 12, label: '>1,200' },
] as const;

/** Internal: the enrollment-driven reference radius (no zoom scaling). */
function baseRadiusExpression(): unknown {
  const fallback = 2;
  return [
    'case',
    ['==', ['get', 'total_enrollment'], null], fallback,
    [
      'step', ['get', 'total_enrollment'],
      ENROLLMENT_BINS[0].radius,
      ENROLLMENT_BINS[0].upTo, ENROLLMENT_BINS[1].radius,
      ENROLLMENT_BINS[1].upTo, ENROLLMENT_BINS[2].radius,
      ENROLLMENT_BINS[2].upTo, ENROLLMENT_BINS[3].radius,
      ENROLLMENT_BINS[3].upTo, ENROLLMENT_BINS[4].radius,
    ],
  ];
}

/**
 * Build a zoom-interpolated `circle-radius` expression with a per-stop offset
 * baked in. MapLibre requires `['zoom']` at the TOP LEVEL of a `step` or
 * `interpolate` — so the offset (backdrop +2 px, halo-outer "+2 px if both")
 * is added inside each stop's output rather than wrapping the whole thing.
 *
 * Zoom factor never drops below 1.0 — at city-overview zoom dots sit at
 * their enrollment-driven reference size (preserving the size→enrollment
 * encoding) and grow as the user zooms in so they stay proportionate to
 * streets and buildings.
 *
 *   z ≤ 11  → 1.0× (reference)
 *   z 13   → 1.4×  (NTA / Detail Panel zoom)
 *   z 15   → 2.0×
 *   z 18   → 3.2×
 */
function zoomScaledRadius(offsetExpr: number | unknown): unknown {
  const base = baseRadiusExpression();
  const factored = (factor: number): unknown =>
    typeof offsetExpr === 'number' && offsetExpr === 0
      ? ['*', base, factor]
      : ['+', ['*', base, factor], offsetExpr];
  return [
    'interpolate', ['exponential', 1.6], ['zoom'],
    11, factored(1.0),
    13, factored(1.4),
    15, factored(2.0),
    18, factored(3.2),
  ];
}

/** Radius for the school-dot layers + halo inner. */
export function radiusExpression(): unknown {
  return zoomScaledRadius(0);
}

/** Radius for the soft drop-shadow backdrop — same zoom curve, plus a 2 px
 *  offset so the shadow always peeks out around the dot. */
export function backdropRadiusExpression(): unknown {
  return zoomScaledRadius(2);
}

