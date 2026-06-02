'use client';

import type { IndicatorPublic } from '../contract/types';
import { deltaStatus, type KpiSet } from '../store/analytics';

interface Props {
  indicator: IndicatorPublic;
  kpis: KpiSet;
  year: string;
}

/** Spec §5.1 — three cards: Anchor avg, Healing Arts avg, All-schools avg.
 *  Anchor / Healing Arts show a Δ vs the All-schools cell, color-coded via
 *  good_direction. The number is the raw delta — color carries the
 *  better/worse semantics so users can read both signal and direction. */
export default function KpiCards({ indicator, kpis, year }: Props): React.JSX.Element {
  const fmt = formatterFor(indicator);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      <Card
        label="Anchor avg"
        value={kpis.anchor.avg}
        delta={kpis.anchor.delta}
        n={kpis.anchor.n}
        formatter={fmt}
        deltaFormatter={deltaFormatterFor(indicator)}
        status={deltaStatus(kpis.anchor.delta, indicator.scale.good_direction)}
        accent="#903090"
      />
      <Card
        label="Healing Arts avg"
        value={kpis.healing_arts.avg}
        delta={kpis.healing_arts.delta}
        n={kpis.healing_arts.n}
        formatter={fmt}
        deltaFormatter={deltaFormatterFor(indicator)}
        status={deltaStatus(kpis.healing_arts.delta, indicator.scale.good_direction)}
        accent="#A0B000"
      />
      <Card
        label="All in view"
        value={kpis.all.avg}
        delta={null}
        n={kpis.all.n}
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
