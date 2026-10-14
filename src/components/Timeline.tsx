'use client';

import { useEffect, useRef, useState } from 'react';
import type { IndicatorPublic } from '../contract/types';
import { PWC_ANCHOR_COLOR, PWC_HEALING_ARTS_COLOR } from '../lib/pwcColors';
import type { TimelinePoint } from '../store/analytics';
import {
  TREND_MIN_N,
  TREND_SERIES_LABELS,
  axisOptionsFor,
  niceAxis,
  pointKind,
  resolveLabelCollisions,
  rosterCaption,
  seriesCell,
  smallSampleNote,
  trendAriaLabel,
  type TrendSeriesKey,
} from '../store/trendChart';

/* ----------------------------- Style constants ----------------------------- */

/** PWC line — dark neutral ink, not blue (blue already means "PWC other
 *  program" and the top of the indicator ramp). One constant, pending
 *  Claudia's colour review. */
export const TREND_PWC_COLOR = '#002040';
const TREND_COMPARISON_COLOR = '#8a96a3';
const TREND_COMPARISON_LABEL_COLOR = '#7a8896';
const TREND_GRID_COLOR = '#e5e9ee';
const TREND_AXIS_TEXT_COLOR = '#a8b3bf';
/** Matches the analytics panel background, so hollow points read as hollow. */
const TREND_BG = '#f7f9fb';

interface SeriesStyle {
  color: string;
  width: number;
  dash?: string;
  markers: boolean;
  primary: boolean;
}

const SERIES_STYLE: Record<TrendSeriesKey, SeriesStyle> = {
  pwc: { color: TREND_PWC_COLOR, width: 3, markers: true, primary: true },
  anchor: { color: PWC_ANCHOR_COLOR, width: 2.5, markers: true, primary: true },
  healing_arts: { color: PWC_HEALING_ARTS_COLOR, width: 2.5, markers: true, primary: true },
  all_in_view: { color: TREND_COMPARISON_COLOR, width: 1.5, markers: false, primary: false },
  citywide: { color: TREND_COMPARISON_COLOR, width: 1.5, dash: '5,4', markers: false, primary: false },
};

const HEIGHT = 150;
const PAD_L = 34;
const PAD_T = 10;
const PAD_B = 22;
const LABEL_FONT = 10;
/** Rough average glyph width at LABEL_FONT, for sizing the right gutter. */
const LABEL_CHAR_W = 5.7;
const LABEL_GAP = 6;
const POINT_R = 3;

interface Props {
  indicator: IndicatorPublic;
  points: TimelinePoint[];
  /** Year shown in the panel — drawn as a vertical marker. */
  activeYear: string;
  /** The series to draw, from `getTrendSeries` (draw-priority order). */
  series: TrendSeriesKey[];
  /** Slider year — the PWC roster the PWC / tier lines hold for every year. */
  rosterYear: string;
}

/** Spec §5.2 — the 5-year trend. Custom SVG, no chart library. */
export default function Timeline({
  indicator,
  points,
  activeYear,
  series,
  rosterYear,
}: Props): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const valueFmt = valueFormatterFor(indicator);

  // Y extent over the drawn series only.
  let dMin = Infinity;
  let dMax = -Infinity;
  for (const p of points) {
    for (const key of series) {
      const v = seriesCell(p, key).avg;
      if (v == null) continue;
      if (v < dMin) dMin = v;
      if (v > dMax) dMax = v;
    }
  }
  const hasData = Number.isFinite(dMin) && Number.isFinite(dMax);

  // Measure the real width so label text is true-size; re-attach when the
  // chart swaps between its empty and drawn states (different elements).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasData]);

  if (!hasData) {
    return (
      <div ref={wrapRef} style={{ fontSize: 11, color: '#a8b3bf', padding: '8px 0' }}>
        No timeline data for this indicator.
      </div>
    );
  }
  const axis = niceAxis(dMin, dMax, axisOptionsFor(indicator));

  // End label per series, at its last non-null point.
  const endLabels: Array<{ key: TrendSeriesKey; idx: number; value: number; text: string }> = [];
  for (const key of series) {
    for (let i = points.length - 1; i >= 0; i--) {
      const v = seriesCell(points[i]!, key).avg;
      if (v != null) {
        endLabels.push({ key, idx: i, value: v, text: `${TREND_SERIES_LABELS[key]}  ${valueFmt(v)}` });
        break;
      }
    }
  }

  const longestLabel = endLabels.reduce((m, l) => Math.max(m, l.text.length), 0);
  const padR = Math.ceil(longestLabel * LABEL_CHAR_W) + LABEL_GAP + 4;
  const innerW = Math.max(80, width - PAD_L - padR);
  const innerH = HEIGHT - PAD_T - PAD_B;

  const xAt = (i: number): number =>
    points.length <= 1 ? PAD_L + innerW / 2 : PAD_L + (i / (points.length - 1)) * innerW;
  const yAt = (v: number): number =>
    PAD_T + innerH - ((v - axis.min) / (axis.max - axis.min)) * innerH;

  const ticks: number[] = [];
  for (let t = axis.min; t <= axis.max + axis.step / 1000; t += axis.step) ticks.push(t);
  const tickFmt = tickFormatterFor(indicator, axis.step);

  // Lines break wherever a year has no schools reporting — never interpolated.
  const pathFor = (key: TrendSeriesKey): string => {
    let d = '';
    let started = false;
    points.forEach((p, i) => {
      const c = seriesCell(p, key);
      if (pointKind(c.n, c.avg) === 'gap') {
        started = false;
        return;
      }
      d += `${started ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(c.avg!).toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };

  const placedLabels = resolveLabelCollisions(
    endLabels.map((l) => ({ ...l, y: yAt(l.value) })),
    14,
  );

  // The small-sample note shows only when a hollow point is actually drawn.
  const anyHollow = series.some(
    (key) =>
      SERIES_STYLE[key].markers &&
      points.some((p) => {
        const c = seriesCell(p, key);
        return pointKind(c.n, c.avg) === 'hollow';
      }),
  );

  const activeIdx = points.findIndex((p) => p.year === activeYear);
  // Comparison lines underneath, primaries on top (first key topmost).
  const drawOrder = [...series].reverse();
  const ariaLabel = trendAriaLabel(indicator.short_label ?? indicator.label, points, series, valueFmt);
  const colHalf = points.length <= 1 ? innerW / 2 : innerW / (points.length - 1) / 2;

  return (
    <div>
      <div
        ref={wrapRef}
        role="img"
        aria-label={ariaLabel}
        style={{ position: 'relative' }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <svg width="100%" height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden>
          {/* Horizontal gridlines at round-number ticks; no vertical grid */}
          {ticks.map((tv) => (
            <g key={tv}>
              <line
                x1={PAD_L}
                x2={PAD_L + innerW}
                y1={yAt(tv)}
                y2={yAt(tv)}
                stroke={TREND_GRID_COLOR}
                strokeWidth={1}
              />
              <text
                x={PAD_L - 5}
                y={yAt(tv) + 3}
                fontSize="9"
                fill={TREND_AXIS_TEXT_COLOR}
                textAnchor="end"
              >
                {tickFmt(tv)}
              </text>
            </g>
          ))}

          {/* Panel-year marker, behind the lines */}
          {activeIdx >= 0 ? (
            <line
              x1={xAt(activeIdx)}
              x2={xAt(activeIdx)}
              y1={PAD_T}
              y2={PAD_T + innerH}
              stroke="#002040"
              strokeWidth={1}
              strokeDasharray="3,3"
              opacity={0.3}
            />
          ) : null}

          {hoverIdx != null ? (
            <line
              x1={xAt(hoverIdx)}
              x2={xAt(hoverIdx)}
              y1={PAD_T}
              y2={PAD_T + innerH}
              stroke="#467c9d"
              strokeWidth={1}
              opacity={0.5}
            />
          ) : null}

          {drawOrder.map((key) => {
            const s = SERIES_STYLE[key];
            return (
              <path
                key={`line-${key}`}
                d={pathFor(key)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width}
                strokeDasharray={s.dash}
                strokeLinejoin="round"
                strokeLinecap={s.dash ? 'butt' : 'round'}
              />
            );
          })}

          {drawOrder
            .filter((key) => SERIES_STYLE[key].markers)
            .map((key) =>
              points.map((p, i) => {
                const c = seriesCell(p, key);
                const kind = pointKind(c.n, c.avg);
                if (kind === 'gap') return null;
                const color = SERIES_STYLE[key].color;
                return (
                  <circle
                    key={`pt-${key}-${p.year}`}
                    cx={xAt(i)}
                    cy={yAt(c.avg!)}
                    r={POINT_R}
                    fill={kind === 'hollow' ? TREND_BG : color}
                    stroke={color}
                    strokeWidth={kind === 'hollow' ? 1.5 : 0}
                  />
                );
              }),
            )}

          {/* Direct end labels — replace the legend */}
          {placedLabels.map((l) => {
            const s = SERIES_STYLE[l.key];
            return (
              <text
                key={`lbl-${l.key}`}
                x={xAt(l.idx) + LABEL_GAP}
                y={l.y + 3.5}
                fontSize={LABEL_FONT}
                fontWeight={s.primary ? 600 : 400}
                fill={s.primary ? s.color : TREND_COMPARISON_LABEL_COLOR}
                style={{ whiteSpace: 'pre' }}
              >
                {l.text}
              </text>
            );
          })}

          {points.map((p, i) => (
            <text
              key={p.year}
              x={xAt(i)}
              y={HEIGHT - 6}
              fontSize="9"
              fill={p.year === activeYear ? '#002040' : TREND_AXIS_TEXT_COLOR}
              fontWeight={p.year === activeYear ? 700 : 400}
              textAnchor="middle"
            >
              {p.year.replace(/^20/, "'")}
            </text>
          ))}

          {/* Hover targets — one transparent column per year */}
          {points.map((p, i) => (
            <rect
              key={`hit-${p.year}`}
              x={xAt(i) - colHalf}
              y={PAD_T}
              width={colHalf * 2}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          ))}
        </svg>

        {hoverIdx != null && points[hoverIdx] ? (
          <TrendTooltip
            point={points[hoverIdx]!}
            series={series}
            fmt={valueFmt}
            x={xAt(hoverIdx)}
            flip={xAt(hoverIdx) > width / 2}
          />
        ) : null}
      </div>

      {anyHollow ? <Caption>{smallSampleNote(TREND_MIN_N)}</Caption> : null}
      <Caption>{rosterCaption(rosterYear)}</Caption>
    </div>
  );
}

function TrendTooltip({
  point,
  series,
  fmt,
  x,
  flip,
}: {
  point: TimelinePoint;
  series: TrendSeriesKey[];
  fmt: (v: number) => string;
  x: number;
  /** Open to the left of the hovered year when it sits in the right half. */
  flip: boolean;
}): React.JSX.Element {
  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        top: 4,
        left: x + 8,
        transform: flip ? 'translateX(calc(-100% - 16px))' : undefined,
        background: 'white',
        border: '1px solid #c5cdd6',
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0,32,64,0.15)',
        padding: '5px 7px',
        fontSize: 10,
        lineHeight: 1.45,
        color: '#002040',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      <div style={{ fontWeight: 700 }}>{point.year}</div>
      {series.map((key) => {
        const c = seriesCell(point, key);
        const value = c.avg == null ? 'no data' : fmt(c.avg);
        const n = key === 'citywide' || c.avg == null ? '' : ` (n=${c.n})`;
        return (
          <div key={key}>
            {TREND_SERIES_LABELS[key]}: {value}
            {n}
          </div>
        );
      })}
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div style={{ fontSize: 10, color: '#7a8896', marginTop: 3 }}>{children}</div>;
}

/** Values: one decimal, as in the KPI cards and ranked list. */
function valueFormatterFor(indicator: IndicatorPublic): (v: number) => string {
  switch (indicator.format) {
    case 'percent':
    case 'rate_per_100':
      return (v) => `${v.toFixed(1)}%`;
    case 'index':
      return (v) => v.toFixed(2);
    default:
      return (v) => v.toFixed(1);
  }
}

/** Axis ticks: round numbers, decimals only when the step needs them. */
function tickFormatterFor(indicator: IndicatorPublic, step: number): (v: number) => string {
  const decimals = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  const pct = indicator.format === 'percent' || indicator.format === 'rate_per_100';
  return (v) => `${v.toFixed(decimals)}${pct ? '%' : ''}`;
}
