'use client';

import { useMemo, useState } from 'react';
import { useHubStore } from '../store/useHubStore';
import type { IndicatorPublic } from '../contract/types';

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

  const school = useMemo(() => indicators.filter((i) => i.family === 'school'), [indicators]);
  const community = useMemo(() => indicators.filter((i) => i.family === 'community'), [indicators]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <FamilyGroup
        title="School indicators"
        items={school}
        activeId={activeSchool}
        onPick={(id) => setSchool(activeSchool === id ? null : id)}
      />
      <FamilyGroup
        title="Community indicators"
        items={community}
        activeId={activeCommunity}
        onPick={(id) => setCommunity(activeCommunity === id ? null : id)}
      />
    </div>
  );
}

function FamilyGroup({
  title,
  items,
  activeId,
  onPick,
}: {
  title: string;
  items: IndicatorPublic[];
  activeId: string | null;
  onPick: (id: string) => void;
}): React.JSX.Element {
  // Group by theme, preserving the registry's theme order.
  const byTheme = useMemo(() => {
    const map = new Map<string, IndicatorPublic[]>();
    for (const i of items) {
      const list = map.get(i.theme) ?? [];
      list.push(i);
      map.set(i.theme, list);
    }
    return [...map.entries()];
  }, [items]);

  const activeTheme = useMemo(
    () => items.find((i) => i.id === activeId)?.theme ?? null,
    [items, activeId],
  );

  // Collapsed by default for compactness; the theme containing the active
  // indicator (if any) starts expanded so users see what's on the map.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeTheme ? [activeTheme] : []),
  );

  // Keep the active theme open as the user changes indicators.
  if (activeTheme && !expanded.has(activeTheme)) {
    setExpanded((prev) => new Set([...prev, activeTheme]));
  }

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
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: '#002040',
          marginBottom: 4,
        }}
      >
        {title}
      </div>
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
                <span style={{ fontSize: 10, color: '#a8b3bf' }}>{list.length}</span>
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
    indicator.source_description,
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
    </div>
  );
}
