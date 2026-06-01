'use client';

/**
 * Compact horizontal distribution viz — places one school inside the
 * distribution of in-view schools that have a value for the active
 * indicator / year. Always fills the container width.
 *
 * Two modes, picked by cohort size:
 *   - N < 10  → dots-only on a single center line (no jitter). At small N
 *               a density curve is meaningless, but each cohort school is
 *               worth showing as an individual mark.
 *   - N ≥ 10  → smoothed kernel-density curve as the distribution shape +
 *               a thin strip + the selected school's pin. Individual dots
 *               are dropped because the curve carries the shape.
 *
 * In both modes the selected school sits as a colored pin on a single
 * center line. Median is marked with a dashed tick.
 */

import type { PercentileResult } from '../store/percentile';

interface Props {
  result: PercentileResult;
  /** Pin color — family accent. */
  accent: string;
  /** Optional value formatter — defaults to `String`. */
  format?: (v: number) => string;
}

/** Internal SVG coordinate space. We omit the SVG `height` attribute and let
 *  the browser derive it from `width="100%"` + this aspect ratio, with
 *  preserveAspectRatio="xMidYMid meet" — so circles stay round at any
 *  container width while the strip spans the full panel width. */
const VB_W = 400;
const VB_H = 56;
const PAD_X = 8;
const STRIP_Y = 24;
const STRIP_H = 14;

export default function StripPlot({ result, accent, format }: Props): React.JSX.Element {
  const fmt = format ?? ((v: number) => v.toFixed(1));

  // Empty cohort / no self value branches: short message instead of a strip.
  if (result.cohortSize === 0 || (result.cohortSize === 1 && result.selfValue == null)) {
    return (
      <div style={{ fontSize: 11, color: '#a8b3bf', padding: '6px 0' }}>{result.callout}</div>
    );
  }

  // Domain — pad the min/max slightly so the edge dots aren't clipped.
  const values = result.cohortValues;
  const dataMin = values[0]!;
  const dataMax = values[values.length - 1]!;
  const range = dataMax - dataMin;
  const pad = range > 0 ? range * 0.04 : Math.max(Math.abs(dataMax) * 0.1, 1);
  const dMin = dataMin - pad;
  const dMax = dataMax + pad;

  const innerW = VB_W - PAD_X * 2;
  const xAt = (v: number): number =>
    range === 0
      ? PAD_X + innerW / 2
      : PAD_X + ((v - dMin) / (dMax - dMin)) * innerW;
  const stripCenter = STRIP_Y + STRIP_H / 2;

  const n = result.cohortSize;
  const mode: 'dots' | 'density' = n < 10 ? 'dots' : 'density';

  // Median tick — same in both modes.
  const median = quantile(values, 0.5);

  const selfX = result.selfValue != null ? xAt(result.selfValue) : null;

  return (
    <div style={{ width: '100%' }}>
      <svg
        width="100%"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={result.callout}
        style={{ display: 'block' }}
      >
        {/* Quartile bands — 4 equal-width visual segments on the AXIS. */}
        {[0, 1, 2, 3].map((i) => (
          <rect
            key={i}
            x={PAD_X + (innerW / 4) * i}
            y={STRIP_Y}
            width={innerW / 4}
            height={STRIP_H}
            fill={i % 2 === 0 ? '#eef2f6' : '#dfe6ec'}
          />
        ))}

        {/* Strip border */}
        <rect
          x={PAD_X}
          y={STRIP_Y}
          width={innerW}
          height={STRIP_H}
          fill="none"
          stroke="#c5cdd6"
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
        />

        {/* Density curve OR individual dots */}
        {mode === 'density' ? (
          <path
            d={buildDensityPath(values, xAt) ?? ''}
            fill="rgba(70, 124, 157, 0.45)"
            stroke="rgba(70, 124, 157, 0.7)"
            strokeWidth={0.8}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          values.map((v, i) => (
            <circle
              key={i}
              cx={xAt(v)}
              cy={stripCenter}
              r={3}
              fill="#467c9d"
              opacity={0.8}
            />
          ))
        )}

        {/* Median tick */}
        <line
          x1={xAt(median)}
          x2={xAt(median)}
          y1={STRIP_Y - 2}
          y2={STRIP_Y + STRIP_H + 2}
          stroke="#002040"
          strokeWidth={1}
          strokeDasharray="2,2"
          opacity={0.4}
          vectorEffect="non-scaling-stroke"
        />

        {/* Selected school pin */}
        {selfX != null ? (
          <circle
            cx={selfX}
            cy={stripCenter}
            r={5.5}
            fill={accent}
            stroke="white"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>

      {/* Axis labels in HTML so they don't squish under the SVG stretch.
       *  Min on the left, median centered (best-effort using flex), max on
       *  the right. The selected school's value sits just above the pin via
       *  a separate label row in the caller; here we keep just the axis. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 9,
          color: '#a8b3bf',
          marginTop: 2,
        }}
      >
        <span>{fmt(dataMin)}</span>
        <span style={{ color: '#467c9d' }}>median {fmt(median)}</span>
        <span>{fmt(dataMax)}</span>
      </div>
      <div style={{ fontSize: 11, color: '#002040', marginTop: 4 }}>{result.callout}</div>
    </div>
  );
}

function quantile(sortedValues: number[], q: number): number {
  // sortedValues is ascending. Linear interpolation between the two closest.
  const pos = (sortedValues.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedValues[lo]!;
  const frac = pos - lo;
  return sortedValues[lo]! + (sortedValues[hi]! - sortedValues[lo]!) * frac;
}

/**
 * Cheap KDE-ish density curve. Buckets values into 40 bins across the data
 * range, applies a 3-pt smoothing kernel, and emits a closed area-fill path
 * sitting above the strip. Returns null when the spread is degenerate.
 */
function buildDensityPath(
  sortedValues: number[],
  xAt: (v: number) => number,
): string | null {
  const n = sortedValues.length;
  if (n < 2) return null;
  const min = sortedValues[0]!;
  const max = sortedValues[n - 1]!;
  if (max === min) return null;
  const NB = 40;
  const counts = new Array<number>(NB).fill(0);
  for (const v of sortedValues) {
    const idx = Math.min(NB - 1, Math.floor(((v - min) / (max - min)) * NB));
    counts[idx]! += 1;
  }
  const smooth = counts.map((_, i) => {
    const a = counts[i - 1] ?? 0;
    const b = counts[i] ?? 0;
    const c = counts[i + 1] ?? 0;
    return (a + 2 * b + c) / 4;
  });
  const peak = Math.max(...smooth, 1);
  // Curve sits ABOVE the strip, taking the top ~16 px of the viewBox.
  const top = 4;
  const baseline = STRIP_Y;
  const height = baseline - top;
  let path = '';
  for (let i = 0; i < NB; i++) {
    const v = min + ((i + 0.5) / NB) * (max - min);
    const x = xAt(v);
    const y = baseline - (smooth[i]! / peak) * height;
    path += i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`;
  }
  // Close back along the strip top.
  path += ` L${xAt(max).toFixed(1)},${baseline} L${xAt(min).toFixed(1)},${baseline} Z`;
  return path;
}
