'use client';

import type { IndicatorPublic } from '../contract/types';
import { deltaStatus, type KpiSet } from '../store/analytics';

interface Props {
  indicator: IndicatorPublic;
  kpis: KpiSet;
  year: string;
}

/** Three cards: PWC schools, All Schools, Citywide. Captions tell the user
 *  what each scope means so the difference between "All Schools shown on
 *  map" and "Static NYC average" is unambiguous when filters are active.
 *  The PWC card carries a Δ vs the All-Schools cell, color-coded via
 *  good_direction. To break out Anchor vs Healing Arts the user filters
 *  School Type. */
export default function KpiCards({ indicator, kpis, year }: Props): React.JSX.Element {
  const fmt = formatterFor(indicator);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      <Card
        label="PWC schools"
        caption="PWC schools shown on map"
        value={kpis.pwc.avg}
        delta={kpis.pwc.delta}
        n={kpis.pwc.n}
        formatter={fmt}
        deltaFormatter={deltaFormatterFor(indicator)}
        status={deltaStatus(kpis.pwc.delta, indicator.scale.good_direction)}
        accent="#027BC0"
      />
      <Card
        label="All Schools"
        caption="All schools shown on map"
        value={kpis.all.avg}
        delta={null}
        n={kpis.all.n}
        formatter={fmt}
        deltaFormatter={deltaFormatterFor(indicator)}
        status="neutral"
        accent="#1c3557"
        sub={`as of ${year}`}
      />
      <Card
        label="Citywide"
        caption="Static NYC average"
        value={kpis.citywide.avg}
        delta={null}
        n={kpis.citywide.n}
        formatter={fmt}
        deltaFormatter={deltaFormatterFor(indicator)}
        status="neutral"
        accent="#467c9d"
        sub={`as of ${year}`}
      />
    </div>
  );
}

function Card({
  label,
  caption,
  value,
  delta,
  n,
  formatter,
  deltaFormatter,
  status,
  accent,
  sub,
}: {
  label: string;
  /** Short explanatory line under the label — tells the user what the cell
   *  is scoped to (e.g. "PWC schools shown on map" vs "Static NYC average"). */
  caption?: string;
  value: number | null;
  delta: number | null;
  n: number;
  formatter: (v: number) => string;
  deltaFormatter: (v: number) => string;
  status: 'better' | 'worse' | 'neutral';
  accent: string;
  sub?: string;
}): React.JSX.Element {
  const deltaColor = status === 'better' ? '#1a7a3d' : status === 'worse' ? '#a82255' : '#467c9d';
  return (
    <div
      style={{
        border: '1px solid #e5e9ee',
        borderTop: `3px solid ${accent}`,
        borderRadius: 6,
        padding: '8px 10px',
        background: 'white',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minHeight: 70,
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          color: '#467c9d',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      {caption ? (
        <div style={{ fontSize: 9.5, color: '#7f8b97', lineHeight: 1.25 }}>
          {caption}
        </div>
      ) : null}
      <div style={{ fontSize: 20, fontWeight: 700, color: '#002040', lineHeight: 1.1 }}>
        {value == null ? '—' : formatter(value)}
      </div>
      {delta != null ? (
        <div style={{ fontSize: 11, color: deltaColor, fontWeight: 600 }}>
          {delta >= 0 ? '+' : ''}
          {deltaFormatter(delta)} vs All
        </div>
      ) : null}
      <div style={{ fontSize: 10, color: '#a8b3bf', marginTop: 'auto' }}>
        {sub ?? `n=${n}`}
      </div>
    </div>
  );
}

function formatterFor(indicator: IndicatorPublic): (v: number) => string {
  switch (indicator.format) {
    case 'percent':
    case 'rate_per_100':
      return (v) => `${v.toFixed(1)}%`;
    case 'integer':
    case 'count':
      return (v) => v.toFixed(0);
    case 'index':
      return (v) => v.toFixed(2);
    default:
      return (v) => v.toFixed(1);
  }
}

function deltaFormatterFor(indicator: IndicatorPublic): (v: number) => string {
  switch (indicator.format) {
    case 'percent':
    case 'rate_per_100':
      return (v) => `${v.toFixed(1)} pp`;
    case 'integer':
    case 'count':
      return (v) => v.toFixed(0);
    default:
      return (v) => v.toFixed(1);
  }
}
