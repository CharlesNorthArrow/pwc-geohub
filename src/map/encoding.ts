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

/* -------------------------------------------------------------------------- */
/* SDF symbols for Anchor stars + Healing-Arts diamonds                       */
/* -------------------------------------------------------------------------- */

/**
 * Native pixel size of the SDF images registered with the map. The shape
 * inside the canvas reaches ~`SDF_SHAPE_RADIUS` px from center, so we scale
 * icon-size by `radius / SDF_SHAPE_RADIUS` to match a circle of the same
 * paint radius (see `iconSizeExpression`).
 */
const SDF_SIZE = 32;
const SDF_SHAPE_RADIUS = 14;
const SDF_BUFFER = 8;

/**
 * Build a zoom-aware `icon-size` expression that makes a star/diamond SDF
 * icon land at the same on-screen radius as a circle drawn with
 * `radiusExpression`. Math: image is `SDF_SIZE` px wide, shape extends
 * `SDF_SHAPE_RADIUS` px from center, so size 1.0 ≈ radius `SDF_SHAPE_RADIUS`.
 * We want effective radius R, so size = R / SDF_SHAPE_RADIUS.
 *
 * Bakes the scale INSIDE each interpolate stop (rather than wrapping the
 * interpolate in a divide) so `['zoom']` stays at the top level — MapLibre
 * rejects nested zoom expressions in non-step/interpolate parents.
 */
export function iconSizeExpression(): unknown {
  const base = baseRadiusExpression();
  const factored = (factor: number): unknown => [
    '/',
    ['*', base, factor],
    SDF_SHAPE_RADIUS,
  ];
  return [
    'interpolate', ['exponential', 1.6], ['zoom'],
    11, factored(1.0),
    13, factored(1.4),
    15, factored(2.0),
    18, factored(3.2),
  ];
}

/** RGBA image bundle in the shape MapLibre's `map.addImage` accepts directly. */
export interface SdfImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Generate the SDF image for the PWC Anchor star (5-pointed). Returns the
 * RGBA bundle MapLibre wants for `addImage(..., { sdf: true })`. Runs in
 * the browser (canvas API); MapView calls this lazily on map load.
 */
export function buildAnchorStarSdf(): SdfImage {
  return buildSdf((ctx, size) => {
    const cx = size / 2;
    const cy = size / 2;
    const outer = SDF_SHAPE_RADIUS;
    const inner = outer * 0.45;
    const points = 5;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const r = i % 2 === 0 ? outer : inner;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  });
}

/** Generate the SDF image for the Healing Arts diamond. */
export function buildHealingDiamondSdf(): SdfImage {
  return buildSdf((ctx, size) => {
    const cx = size / 2;
    const cy = size / 2;
    const r = SDF_SHAPE_RADIUS;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
  });
}

/**
 * Tiny SDF generator: rasterize the shape in white on transparent, then for
 * every pixel store the signed distance to the nearest in/out boundary in
 * the alpha channel. Mapbox / MapLibre encode SDFs as alpha=192+16·dist
 * clamped to [0,255] — 192 is inside, 64 is outside, with a smooth halo so
 * `icon-halo-width` can grow the outline a few pixels in any direction.
 *
 * Brute force: O(N²·R²) where N=32, R=SDF_BUFFER=8 → ~278K ops per image,
 * negligible compared to map style ready time.
 */
function buildSdf(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): SdfImage {
  const size = SDF_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
  }
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'white';
  draw(ctx, size);
  const mask = ctx.getImageData(0, 0, size, size).data;

  const isInside = (x: number, y: number): boolean => {
    if (x < 0 || x >= size || y < 0 || y >= size) return false;
    return (mask[(y * size + x) * 4 + 3] ?? 0) > 128;
  };

  const out = new Uint8ClampedArray(size * size * 4);
  const radius = SDF_BUFFER;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = isInside(x, y);
      let minDistSq = Infinity;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (isInside(x + dx, y + dy) !== inside) {
            const dSq = dx * dx + dy * dy;
            if (dSq < minDistSq) minDistSq = dSq;
          }
        }
      }
      const dist = minDistSq === Infinity ? radius : Math.sqrt(minDistSq);
      const signed = inside ? dist : -dist;
      const alpha = Math.max(0, Math.min(255, Math.round(192 + 16 * signed)));
      const idx = (y * size + x) * 4;
      out[idx] = 255;
      out[idx + 1] = 255;
      out[idx + 2] = 255;
      out[idx + 3] = alpha;
    }
  }
  return { width: size, height: size, data: out };
}
