/**
 * Pure helpers behind the analytics panel's 5-year trend chart
 * (`src/components/Timeline.tsx`): which series to draw, the round-number
 * y-axis, end-label spacing and the small-sample point rule. No rendering
 * here — unit-tested by `scripts/test-trend-chart.ts` (`npm run test:trend`).
 */

import type { TimelinePoint } from './analytics';
import type { SchoolType } from './useHubStore';

export type TrendSeriesKey = 'pwc' | 'anchor' | 'healing_arts' | 'all_in_view' | 'citywide';
export type PwcTier = 'anchor' | 'healing_arts';

/** Below this many schools reporting, a point is drawn hollow. */
export const TREND_MIN_N = 5;

export const TREND_SERIES_LABELS: Record<TrendSeriesKey, string> = {
  pwc: 'PWC schools',
  anchor: 'Anchor',
  healing_arts: 'Healing Arts only',
  all_in_view: 'All schools in view',
  citywide: 'Citywide',
};

/** The PWC / Anchor / Healing Arts lines hold the slider year's roster for
 *  every plotted year (`pwcMembershipYear` in `deriveAnalytics`). */
export const TREND_ROSTER_CAPTION = 'PWC lines use the {year} partner roster for all years.';

export function rosterCaption(year: string): string {
  return TREND_ROSTER_CAPTION.replace('{year}', year);
}

export function smallSampleNote(minN: number = TREND_MIN_N): string {
  return `Hollow points = fewer than ${minN} schools reporting`;
}

/** The partnership tiers in view, from the School Type filter: one ticked
 *  group → that tier; anything else → both. */
export function activeTiersFor(schoolType: SchoolType): PwcTier[] {
  if (schoolType === 'anchor') return ['anchor'];
  if (schoolType === 'healing_arts') return ['healing_arts'];
  return ['anchor', 'healing_arts'];
}

/**
 * Which series the chart draws, in draw-priority / tooltip order. Never both
 * `pwc` and a tier, never more than 4 keys. With exactly one tier active the
 * PWC line IS that tier, so the tier key is returned (drawn in its colour).
 */
export function getTrendSeries({
  splitByTier,
  activeTiers,
}: {
  splitByTier: boolean;
  activeTiers: ReadonlyArray<PwcTier>;
}): TrendSeriesKey[] {
  const hasAnchor = activeTiers.includes('anchor');
  const hasHa = activeTiers.includes('healing_arts');
  if (hasAnchor !== hasHa) {
    return [hasAnchor ? 'anchor' : 'healing_arts', 'all_in_view', 'citywide'];
  }
  if (splitByTier) return ['anchor', 'healing_arts', 'all_in_view', 'citywide'];
  return ['pwc', 'all_in_view', 'citywide'];
}

/** One series' cell from a timeline point. */
export function seriesCell(
  p: TimelinePoint,
  key: TrendSeriesKey,
): { n: number; avg: number | null } {
  return key === 'all_in_view' ? p.allInView : p[key];
}

export type PointKind = 'gap' | 'hollow' | 'filled';

/** n = 0 or no value → gap (line breaks, no point); 0 < n < minN → hollow;
 *  otherwise filled. */
export function pointKind(n: number, value: number | null, minN: number = TREND_MIN_N): PointKind {
  if (value == null || n === 0) return 'gap';
  if (n < minN) return 'hollow';
  return 'filled';
}

/**
 * Push labels apart so neighbours are at least `minGap` px apart vertically.
 * Sorted by y, each label moves down only as far as needed. Returns the
 * labels in their input order with adjusted `y`; the result doesn't depend
 * on input order (ties broken by original y, then input position).
 */
export function resolveLabelCollisions<T extends { y: number }>(labels: T[], minGap = 14): T[] {
  const order = labels.map((l, i) => ({ l, i })).sort((a, b) => a.l.y - b.l.y || a.i - b.i);
  const out = labels.slice();
  let prev = -Infinity;
  for (const { l, i } of order) {
    const y = Math.max(l.y, prev + minGap);
    out[i] = { ...l, y };
    prev = y;
  }
  return out;
}

export interface AxisSpec {
  min: number;
  max: number;
  step: number;
}

const tickCount = (min: number, max: number, step: number): number =>
  Math.round((max - min) / step) + 1;

/**
 * Round-number y-axis.
 *  - fixedDomain → as given, step 1.
 *  - isPercent   → min 0; the smallest step from 1/2/5/10/20/25 giving 3–5
 *                  ticks; max = first step multiple ≥ dataMax, never above
 *                  100 when the data fits under it.
 *  - otherwise   → step from {1, 2, 5} × 10^k giving at most 5 ticks, with
 *                  min and max on step multiples.
 */
export function niceAxis(
  dataMin: number,
  dataMax: number,
  { isPercent = false, fixedDomain }: { isPercent?: boolean; fixedDomain?: readonly [number, number] } = {},
): AxisSpec {
  if (fixedDomain) return { min: fixedDomain[0], max: fixedDomain[1], step: 1 };

  if (isPercent) {
    for (const step of [1, 2, 5, 10, 20, 25]) {
      let max = Math.max(step, Math.ceil(dataMax / step) * step);
      if (dataMax <= 100) max = Math.min(max, 100);
      const n = tickCount(0, max, step);
      if (n >= 3 && n <= 5) return { min: 0, max, step };
    }
    return dataMax <= 100
      ? { min: 0, max: 100, step: 25 }
      : { min: 0, max: Math.ceil(dataMax / 50) * 50, step: 50 };
  }

  const span = dataMax - dataMin;
  const ref = span > 0 ? span : Math.max(Math.abs(dataMax), 1);
  const k0 = Math.floor(Math.log10(ref)) - 1;
  for (let k = k0; k <= k0 + 3; k++) {
    for (const m of [1, 2, 5]) {
      const step = m * 10 ** k;
      const min = Math.floor(dataMin / step) * step;
      let max = Math.ceil(dataMax / step) * step;
      if (max === min) max = min + step;
      if (tickCount(min, max, step) <= 5) return { min, max, step };
    }
  }
  return { min: dataMin, max: dataMax === dataMin ? dataMin + 1 : dataMax, step: ref };
}

/** Screen-reader summary: "Math 2020-21 to 2025-26: PWC schools 21% to 46.5%, …". */
export function trendAriaLabel(
  indicatorLabel: string,
  points: TimelinePoint[],
  series: ReadonlyArray<TrendSeriesKey>,
  fmt: (v: number) => string,
): string {
  if (points.length === 0) return `${indicatorLabel}: no trend data`;
  const parts: string[] = [];
  for (const key of series) {
    const vals = points.map((p) => seriesCell(p, key).avg);
    const first = vals.find((v) => v != null);
    const last = [...vals].reverse().find((v) => v != null);
    parts.push(
      first == null || last == null
        ? `${TREND_SERIES_LABELS[key]} no data`
        : `${TREND_SERIES_LABELS[key]} ${fmt(first)} to ${fmt(last)}`,
    );
  }
  return `${indicatorLabel} ${points[0]!.year} to ${points[points.length - 1]!.year}: ${parts.join(', ')}`;
}
