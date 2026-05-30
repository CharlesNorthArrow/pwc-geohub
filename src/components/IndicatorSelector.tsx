'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useHubStore } from '../store/useHubStore';
import type { IndicatorPublic } from '../contract/types';
import { SCHOOL_THEME_ORDER } from '../registry/indicators';

/**
 * Spec §3.1 hard rule: at most one school indicator AND one community
 * indicator active at any time. Themes are collapsible to keep the panel
 * compact; each indicator gets a short label + an info icon that surfaces
 * the full name and source on hover.
 */

interface Props {
  indicators: IndicatorPublic[];
}

export default function IndicatorSelector({ indicators }: Props): React.JSX.Element {
  const activeSchool = useHubStore((s) => s.activeSchoolIndicator);
  const activeCommunity = useHubStore((s) => s.activeCommunityIndicator);
  const setSchool = useHubStore((s) => s.setSchoolIndicator);
  const setCommunity = useHubStore((s) => s.setCommunityIndicator);
  const schoolsHidden = useHubStore((s) => s.schoolsHidden);
  const setSchoolsHidden = useHubStore((s) => s.setSchoolsHidden);

  const school = useMemo(() => indicators.filter((i) => i.family === 'school'), [indicators]);
  const community = useMemo(() => indicators.filter((i) => i.family === 'community'), [indicators]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <FamilyGroup
        title="School indicators"
        items={school}
        activeId={activeSchool}
        themeOrder={SCHOOL_THEME_ORDER}
        onPick={(id) => setSchool(activeSchool === id ? null : id)}
        titleAction={
          <HideSchoolsToggle
            hidden={schoolsHidden}
            onToggle={() => setSchoolsHidden(!schoolsHidden)}
          />
        }
      />
      <FamilyGroup
        title="Community indicators"
        items={community}
        activeId={activeCommunity}
        flat
        onPick={(id) => setCommunity(activeCommunity === id ? null : id)}
      />
    </div>
  );
}

/** Small eye toggle that sits in the "School indicators" title row.
 *  Hides every school dot + halo on the map without clearing the active
 *  indicator — flip back on and the gradient returns immediately. */
function HideSchoolsToggle({
  hidden,
  onToggle,
}: {
  hidden: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!hidden}
      aria-label={hidden ? 'Show schools on map' : 'Hide schools on map'}
      title={hidden ? 'Show schools on map' : 'Hide schools on map'}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 2,
        display: 'inline-flex',
        alignItems: 'center',
        color: hidden ? '#a8b3bf' : '#027BC0',
        textTransform: 'none',
        letterSpacing: 0,
      }}
    >
      <EyeIcon hidden={hidden} />
    </button>
  );
}

/** 14×14 eye SVG with an optional diagonal "off" slash. */
function EyeIcon({ hidden }: { hidden: boolean }): React.JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden>
      <path
        d="M1.5 8 C 3.5 4.5, 5.8 3, 8 3 S 12.5 4.5, 14.5 8 C 12.5 11.5, 10.2 13, 8 13 S 3.5 11.5, 1.5 8 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
      />
      <circle cx={8} cy={8} r={2.2} fill="currentColor" />
      {hidden ? (
        <line
          x1={2}
          y1={14}
          x2={14}
          y2={2}
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

function FamilyGroup({
  title,
  items,
  activeId,
  themeOrder,
  flat = false,
  onPick,
  titleAction,
}: {
  title: string;
  items: IndicatorPublic[];
  activeId: string | null;
  /** Render indicators as a flat list (no theme headers). */
  flat?: boolean;
  /** When set, render themes in this order; otherwise registry order. */
  themeOrder?: readonly string[];
  onPick: (id: string) => void;
  /** Optional right-aligned element rendered inside the title row. */
  titleAction?: React.ReactNode;
}): React.JSX.Element {
  // Group by theme, then apply an explicit order when one is provided. Themes
  // not listed in `themeOrder` are appended (alphabetical) so a new theme
  // doesn't quietly disappear before the order constant is updated.
  const byTheme = useMemo(() => {
    const map = new Map<string, IndicatorPublic[]>();
    for (const i of items) {
      const list = map.get(i.theme) ?? [];
      list.push(i);
      map.set(i.theme, list);
    }
    const entries = [...map.entries()];
    if (!themeOrder) return entries;
    const orderIdx = new Map(themeOrder.map((t, idx) => [t, idx]));
    entries.sort(([a], [b]) => {
      const ai = orderIdx.get(a) ?? Number.POSITIVE_INFINITY;
      const bi = orderIdx.get(b) ?? Number.POSITIVE_INFINITY;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });
    return entries;
  }, [items, themeOrder]);

  const activeTheme = useMemo(
    () => items.find((i) => i.id === activeId)?.theme ?? null,
    [items, activeId],
  );

  // Collapsed by default for compactness; the theme containing the active
  // indicator (if any) starts expanded so users see what's on the map.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeTheme ? [activeTheme] : []),
  );

  // Collapse a theme automatically when its indicator gets deselected — the
  // theme only "stays open by virtue of an active pick" inside it. Manual
  // expands by the user are preserved (we only collapse on the active→null
  // transition).
  const prevActiveTheme = useRef<string | null>(activeTheme);
  useEffect(() => {
    const prev = prevActiveTheme.current;
    if (prev && prev !== activeTheme) {
      setExpanded((cur) => {
        if (!cur.has(prev)) return cur;
        const next = new Set(cur);
        next.delete(prev);
        return next;
      });
    }
    if (activeTheme) {
      setExpanded((cur) => (cur.has(activeTheme) ? cur : new Set([...cur, activeTheme])));
    }
    prevActiveTheme.current = activeTheme;
  }, [activeTheme]);

  function toggle(theme: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(theme)) next.delete(theme);
      else next.add(theme);
      return next;
    });
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: '#002040',
          marginBottom: 4,
        }}
      >
        <span>{title}</span>
        {titleAction}
      </div>
      {flat ? (
        // Community indicators render as a flat list — no theme headers.
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {items.map((i) => (
            <IndicatorRow
              key={i.id}
              indicator={i}
              selected={i.id === activeId}
              onPick={() => onPick(i.id)}
            />
          ))}
        </div>
      ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {byTheme.map(([theme, list]) => {
          const open = expanded.has(theme);
          const hasActive = list.some((i) => i.id === activeId);
          return (
            <div key={theme}>
              <button
                type="button"
                onClick={() => toggle(theme)}
                aria-expanded={open}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  padding: '2px 0',
                  fontSize: 11,
                  cursor: 'pointer',
                  color: hasActive ? '#027BC0' : '#467c9d',
                  fontWeight: hasActive ? 700 : 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span aria-hidden style={{ fontSize: 8, display: 'inline-block', width: 10 }}>
                  {open ? '▼' : '▶'}
                </span>
                <span style={{ flex: 1 }}>{theme}</span>
              </button>
              {open ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: 14 }}>
                  {list.map((i) => (
                    <IndicatorRow
                      key={i.id}
                      indicator={i}
                      selected={i.id === activeId}
                      onPick={() => onPick(i.id)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

function IndicatorRow({
  indicator,
  selected,
  onPick,
}: {
  indicator: IndicatorPublic;
  selected: boolean;
  onPick: () => void;
}): React.JSX.Element {
  const short = indicator.short_label ?? indicator.label;
  const yearSpan =
    indicator.years.length === 0
      ? null
      : indicator.years.length === 1
        ? indicator.years[0]
        : `${indicator.years[0]} – ${indicator.years[indicator.years.length - 1]}`;
  const tooltip = [
    indicator.label,
    `Source: ${indicator.source_description}`,
    indicator.source_url ?? null,
    yearSpan ? `Years: ${yearSpan}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 4px',
        borderRadius: 4,
        background: selected ? '#027BC0' : 'transparent',
        color: selected ? 'white' : '#002040',
      }}
    >
      <button
        type="button"
        onClick={onPick}
        style={{
          flex: 1,
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          padding: 0,
          fontSize: 12,
          cursor: 'pointer',
          lineHeight: 1.3,
          color: 'inherit',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={tooltip}
      >
        {short}
      </button>
      {indicator.source_url ? (
        <a
          href={indicator.source_url}
          target="_blank"
          rel="noreferrer"
          aria-label={tooltip}
          title={tooltip}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 14,
            height: 14,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            fontSize: 9,
            fontWeight: 700,
            border: `1px solid ${selected ? 'rgba(255,255,255,0.6)' : 'rgba(70,124,157,0.45)'}`,
            color: selected ? 'rgba(255,255,255,0.85)' : '#467c9d',
            textDecoration: 'none',
            userSelect: 'none',
          }}
        >
          i
        </a>
      ) : (
        <span
          aria-label={tooltip}
          title={tooltip}
          style={{
            width: 14,
            height: 14,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            fontSize: 9,
            fontWeight: 700,
            border: `1px solid ${selected ? 'rgba(255,255,255,0.6)' : 'rgba(70,124,157,0.45)'}`,
            color: selected ? 'rgba(255,255,255,0.85)' : '#467c9d',
            cursor: 'help',
            userSelect: 'none',
          }}
        >
          i
        </span>
      )}
    </div>
  );
}
