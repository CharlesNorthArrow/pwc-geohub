'use client';

import type { IndicatorPublic } from '../contract/types';
import type { TimelinePoint } from '../store/analytics';

interface Props {
  indicator: IndicatorPublic;
  points: TimelinePoint[];
  /** Slider year — drawn as a vertical marker. */
  activeYear: string;
  /** Legend label for the reference (third) series. "Citywide" when no
   *  Geo/School Type filter is active; under filters it describes the
   *  actual comparison cohort. */
  comparisonLabel: string;
}

const SERIES_COLORS = {
  anchor: '#903090',
  healing_arts: '#F0901F',
  citywide: '#467c9d',
} as const;

/** Spec §5.2 — 3 series + vertical marker at the selected year.
 *  Custom SVG, no chart library. */
export default function Timeline({
  indicator,
  points,
  activeYear,
  comparisonLabel,
}: Props): React.JSX.Element {
  const width = 320;
  const height = 130;
  const padL = 36;
  const padR = 8;
  const padT = 8;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  // Y domain across all three series; ignore nulls.
  let dMin = Infinity;
  let dMax = -Infinity;
  for (const p of points) {
    for (const v of [p.anchor.avg, p.healing_arts.avg, p.citywide.avg]) {
      if (v == null) continue;
      if (v < dMin) dMin = v;
      if (v > dMax) dMax = v;
    }
  }
  if (!Number.isFinite(dMin) || !Number.isFinite(dMax)) {
    return (
      <div style={{ fontSize: 11, color: '#a8b3bf', padding: '8px 0' }}>
        No timeline data for this indicator.
      </div>
    );
  }
  const span = Math.max(1e-6, dMax - dMin);
  const yPad = span * 0.08;
  const y0 = dMin - yPad;
  const y1 = dMax + yPad;

  const xAt = (i: number): number =>
    points.length <= 1 ? padL + innerW / 2 : padL + (i / (points.length - 1)) * innerW;
  const yAt = (v: number): number => padT + innerH - ((v - y0) / (y1 - y0)) * innerH;

  const linePath = (key: 'anchor' | 'healing_arts' | 'citywide'): string => {
    let path = '';
    let started = false;
    points.forEach((p, i) => {
      const v = p[key].avg;
      if (v == null) {
        started = false;
        return;
      }
      const x = xAt(i);
      const y = yAt(v);
      path += started ? ` L${x.toFixed(1)},${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`;
      started = true;
    });
    return path;
  };

  const activeIdx = points.findIndex((p) => p.year === activeYear);

  const fmt = formatterFor(indicator);
  const tickValues = [y0, y0 + (y1 - y0) / 2, y1];

  return (
    <div>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Y axis grid */}
        {tickValues.map((tv, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={width - padR}
              y1={yAt(tv)}
              y2={yAt(tv)}
              stroke="#eef0f3"
              strokeWidth={1}
            />
            <text x={padL - 4} y={yAt(tv) + 3} fontSize="9" fill="#a8b3bf" textAnchor="end">
              {fmt(tv)}
            </text>
          </g>
        ))}

        {/* Active-year marker (drawn first, behind lines) */}
        {activeIdx >= 0 ? (
          <line
            x1={xAt(activeIdx)}
            x2={xAt(activeIdx)}
            y1={padT}
            y2={padT + innerH}
            stroke="#002040"
            strokeWidth={1}
            strokeDasharray="3,3"
            opacity={0.4}
          />
        ) : null}

        {/* Lines */}
        <path d={linePath('citywide')} stroke={SERIES_COLORS.citywide} fill="none" strokeWidth={1.6} />
        <path d={linePath('healing_arts')} stroke={SERIES_COLORS.healing_arts} fill="none" strokeWidth={1.6} />
        <path d={linePath('anchor')} stroke={SERIES_COLORS.anchor} fill="none" strokeWidth={1.6} />

        {/* X-axis labels */}
        {points.map((p, i) => (
          <text
            key={p.year}
            x={xAt(i)}
            y={height - 12}
            fontSize="9"
            fill={p.year === activeYear ? '#002040' : '#a8b3bf'}
            fontWeight={p.year === activeYear ? 700 : 400}
            textAnchor="middle"
          >
            {p.year.replace(/^20/, "'")}
          </text>
        ))}
      </svg>
      {/* Legend strip — the third series's label is dynamic ("Citywide" when
       *  the user has no Geo/School Type filter active, otherwise reflects
       *  the actual cohort that line is averaged over). */}
      <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#467c9d', marginTop: 4, flexWrap: 'wrap' }}>
        <LegendDot color={SERIES_COLORS.anchor} label="Anchor" />
        <LegendDot color={SERIES_COLORS.healing_arts} label="Healing Arts" />
        <LegendDot color={SERIES_COLORS.citywide} label={comparisonLabel} />
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }): React.JSX.Element {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <span style={{ width: 10, height: 2, background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

function formatterFor(indicator: IndicatorPublic): (v: number) => string {
  switch (indicator.format) {
    case 'percent':
    case 'rate_per_100':
      return (v) => `${v.toFixed(0)}%`;
    case 'integer':
    case 'count':
      return (v) => v.toFixed(0);
    case 'index':
      return (v) => v.toFixed(1);
    default:
      return (v) => v.toFixed(0);
  }
}
