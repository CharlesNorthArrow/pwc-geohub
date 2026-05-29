/**
 * Encoding logic — value→color and enrollment→radius. Used by BOTH `<MapView/>`
 * (via MapLibre paint expressions) and `<Legend/>` (HTML swatches). Keeping
 * them in one module is the spec §11.4 anti-debt rule: legend can never
 * disagree with the map because both reference these same bins.
 */

import type { IndicatorPublic } from '../contract/types';
import { RACE_QUALITATIVE, rampFor, type Ramp } from './palettes';

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
 * indicators use **equal-interval** bins over the observed min/max — fine
 * for Phase 1; quantile bins arrive when the spec asks for them.
 */
export function colorBinsFor(
  indicator: IndicatorPublic,
  domain: { min: number; max: number } | null,
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
  const ramp = rampFor(indicator.scale.good_direction);
  const span = domain.max - domain.min;
  const step = span / 5;
  const edges: [number, number, number, number] = [
    domain.min + step,
    domain.min + 2 * step,
    domain.min + 3 * step,
    domain.min + 4 * step,
  ];
  return { type: 'sequential', ramp, edges, format: formatterFor(indicator) };
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
 * Fixed 5-bin radii driven by total_enrollment. Stable across indicators so
 * size is comparable when switching the active indicator (spec §4.2).
 */
export const ENROLLMENT_BINS = [
  { upTo: 200, radius: 3, label: '≤200' },
  { upTo: 400, radius: 5, label: '201–400' },
  { upTo: 700, radius: 7, label: '401–700' },
  { upTo: 1200, radius: 9, label: '701–1,200' },
  { upTo: Infinity, radius: 12, label: '>1,200' },
] as const;

export function radiusExpression(): unknown {
  // MapLibre `step` on properties.total_enrollment. Missing → smallest dot.
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
