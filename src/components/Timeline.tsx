'use client';

import type { IndicatorPublic } from '../contract/types';
import type { TimelinePoint } from '../store/analytics';

interface Props {
  indicator: IndicatorPublic;
  points: TimelinePoint[];
  /** Slider year — drawn as a vertical marker. */
  activeYear: string;
}

const SERIES_COLORS = {
  pwc: '#027BC0',          // PWC brand blue — roll-up of every PWC school
  anchor: '#903090',
  healing_arts: '#A0B000', // PWC green — matches map symbology
  allInView: '#1c3557',    // dark navy — All Schools (filtered universe)
  citywide: '#467c9d',     // slate — Citywide (static NYC average)
} as const;

/** Series-key helper that stays in sync with TimelinePoint. */
type SeriesKey = keyof typeof SERIES_COLORS;

/** Spec §5.2 — 3 series + vertical marker at the selected year.
 *  Custom SVG, no chart library. */
export default function Timeline({
  indicator,
  points,
  activeYear,
}: Props): React.JSX.Element {
  const width = 320;
  const height = 130;
  const padL = 36;
  const padR = 8;
  const padT = 8;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  // Y domain across all five series; ignore nulls.
  let dMin = Infinity;
  let dMax = -Infinity;
  for (const p of points) {
    for (const v of [p.pwc.avg, p.anchor.avg, p.healing_arts.avg, p.allInView.avg, p.citywide.avg]) {
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

  const linePath = (key: SeriesKey): string => {
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

  // Dots at every defined point, drawn on top of lines. Single-year indicators
  // (e.g. CDC PLACES 2023-only) have no line at all — the dots are the chart.
  const dotsFor = (key: SeriesKey): Array<{ x: number; y: number }> => {
    const out: Array<{ x: number; y: number }> = [];
    points.forEach((p, i) => {
      const v = p[key].avg;
      if (v == null) return;
      out.push({ x: xAt(i), y: yAt(v) });
    });
    return out;
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

        {/* Lines — paint reference lines (citywide, all-in-view) first so
         *  they sit underneath the PWC group lines, with the PWC roll-up
         *  rendered LAST and thicker so it's the primary signal. The
         *  citywide line is dashed to signal it's a static reference (vs
         *  the solid lines, which react to the filter cascade). */}
        <path
          d={linePath('citywide')}
          stroke={SERIES_COLORS.citywide}
          fill="none"
          strokeWidth={1.6}
          strokeDasharray="4,3"
        />
        <path d={linePath('allInView')} stroke={SERIES_COLORS.allInView} fill="none" strokeWidth={1.6} />
        <path d={linePath('healing_arts')} stroke={SERIES_COLORS.healing_arts} fill="none" strokeWidth={1.6} />
        <path d={linePath('anchor')} stroke={SERIES_COLORS.anchor} fill="none" strokeWidth={1.6} />
        <path d={linePath('pwc')} stroke={SERIES_COLORS.pwc} fill="none" strokeWidth={2.4} />

        {/* Dots — drawn after lines so they sit on top. */}
        {dotsFor('citywide').map((d, i) => (
          <circle key={`c${i}`} cx={d.x} cy={d.y} r={2.4} fill={SERIES_COLORS.citywide} />
        ))}
        {dotsFor('allInView').map((d, i) => (
          <circle key={`v${i}`} cx={d.x} cy={d.y} r={2.4} fill={SERIES_COLORS.allInView} />
        ))}
        {dotsFor('healing_arts').map((d, i) => (
          <circle key={`h${i}`} cx={d.x} cy={d.y} r={2.4} fill={SERIES_COLORS.healing_arts} />
        ))}
        {dotsFor('anchor').map((d, i) => (
          <circle key={`a${i}`} cx={d.x} cy={d.y} r={2.4} fill={SERIES_COLORS.anchor} />
        ))}
        {dotsFor('pwc').map((d, i) => (
          <circle key={`p${i}`} cx={d.x} cy={d.y} r={3} fill={SERIES_COLORS.pwc} />
        ))}

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
      {/* Legend strip — five static labels. "All Schools in view" tracks
       *  the filter cascade; "Citywide" is a static NYC reference that
       *  never moves with filters. */}
      <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#467c9d', marginTop: 4, flexWrap: 'wrap' }}>
        <LegendDot color={SERIES_COLORS.pwc} label="PWC schools" />
        <LegendDot color={SERIES_COLORS.anchor} label="Anchor" />
        <LegendDot color={SERIES_COLORS.healing_arts} label="Healing Arts" />
        <LegendDot color={SERIES_COLORS.allInView} label="All Schools in view" />
        <LegendDot color={SERIES_COLORS.citywide} label="Citywide" dashed />
      </div>
    </div>
  );
}

function LegendDot({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}): React.JSX.Element {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {dashed ? (
        // Mirror the chart's strokeDasharray="4,3" with a CSS dashed border
        // so the legend swatch matches the line.
        <span
          style={{
            width: 12,
            height: 0,
            borderTop: `2px dashed ${color}`,
            display: 'inline-block',
          }}
        />
      ) : (
        <span style={{ width: 10, height: 2, background: color, display: 'inline-block' }} />
      )}
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
