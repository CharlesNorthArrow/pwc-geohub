'use client';

import { useMemo } from 'react';
import type { IndicatorPublic, SchoolMaster } from '../contract/types';
import type { RankedRow } from '../store/analytics';
import { useHubStore } from '../store/useHubStore';
import Sparkline from './Sparkline';

interface Props {
  indicator: IndicatorPublic;
  rows: RankedRow[];
  schoolsMaster: SchoolMaster[];
  activeYear: string;
}

const ANCHOR = '#903090';
const HEALING = '#A0B000'; // PWC green — matches map symbology (diamond)
const BLUE = '#027BC0';

/** Spec §5.3 — ranked PWC schools (worst → best per good_direction), each
 *  with a category symbol + latest value + sparkline. Click → flyTo (via
 *  the existing `selectedSchoolDbn` store slice; Shell wires the rest). */
export default function RankedList({
  indicator,
  rows,
  schoolsMaster,
  activeYear,
}: Props): React.JSX.Element {
  const setSelectedSchool = useHubStore((s) => s.setSelectedSchool);
  const nameByDbn = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of schoolsMaster) {
      if (s.school_name) m.set(s.dbn, s.school_name);
    }
    return m;
  }, [schoolsMaster]);

  // Shared sparkline y-domain so rows are visually comparable.
  const sparkDomain = useMemo(() => {
    let mn = Infinity;
    let mx = -Infinity;
    for (const r of rows) {
      for (const p of r.spark) {
        if (p.value == null) continue;
        if (p.value < mn) mn = p.value;
        if (p.value > mx) mx = p.value;
      }
    }
    return Number.isFinite(mn) && Number.isFinite(mx) ? { min: mn, max: mx } : undefined;
  }, [rows]);

  const fmt = formatterFor(indicator);

  if (rows.length === 0) {
    return (
      <div style={{ fontSize: 11, color: '#a8b3bf', padding: '6px 4px' }}>
        No PWC schools match the active filters.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto auto',
          gap: 8,
          padding: '4px 6px',
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          color: '#a8b3bf',
          borderBottom: '1px solid #eef0f3',
        }}
      >
        <span>#</span>
        <span>School</span>
        <span style={{ textAlign: 'right' }}>{indicator.short_label ?? 'Value'}</span>
        <span style={{ textAlign: 'right' }}>Trend</span>
      </div>
      <div style={{ overflowY: 'auto', maxHeight: 320 }}>
        {rows.map((r, i) => {
          const name = nameByDbn.get(r.dbn) ?? r.dbn;
          return (
            <button
              key={r.dbn}
              type="button"
              onClick={() => setSelectedSchool(r.dbn)}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto auto',
                gap: 8,
                padding: '4px 6px',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid #f5f7fa',
                cursor: 'pointer',
                fontSize: 11,
                color: '#002040',
                alignItems: 'center',
              }}
              title={name}
            >
              <span style={{ color: '#a8b3bf', minWidth: 18 }}>{i + 1}</span>
              <span style={{ display: 'flex', gap: 4, alignItems: 'center', overflow: 'hidden' }}>
                <CategoryGlyph category={r.category} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                </span>
              </span>
              <span style={{ textAlign: 'right', fontWeight: 600 }}>
                {r.latestValue == null ? '—' : fmt(r.latestValue)}
              </span>
              <span style={{ textAlign: 'right' }}>
                <Sparkline points={r.spark} highlightYear={activeYear} domain={sparkDomain} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Anchor-wins: both-category schools render as Anchor (triangle). Healing
 * Arts = green diamond. pwc_other = blue circle. Shapes mirror the map
 * symbology so users can scan the list and the map with the same visual
 * vocabulary.
 */
function CategoryGlyph({ category }: { category: RankedRow['category'] }): React.JSX.Element {
  if (category === 'anchor' || category === 'both') {
    return <Glyph shape="triangle" color={ANCHOR} />;
  }
  if (category === 'healing_arts') return <Glyph shape="diamond" color={HEALING} />;
  return <Glyph shape="circle" color={BLUE} />; // pwc_other
}

function Glyph({
  shape,
  color,
}: {
  shape: 'triangle' | 'diamond' | 'circle';
  color: string;
}): React.JSX.Element {
  return (
    <svg aria-hidden viewBox="0 0 20 20" width={11} height={11} style={{ flex: 'none' }}>
      {shape === 'triangle' ? (
        <polygon points="10,2 18,17 2,17" fill={color} />
      ) : shape === 'diamond' ? (
        <polygon points="10,2 18,10 10,18 2,10" fill={color} />
      ) : (
        <circle cx={10} cy={10} r={7} fill={color} />
      )}
    </svg>
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
