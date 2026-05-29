'use client';

import { useHubStore } from '../store/useHubStore';
import type { IndicatorPublic } from '../contract/types';

/**
 * Spec §3.1 hard rule: at most one school indicator AND one community
 * indicator active at any time. Enforced here as two parallel radio-style
 * groups, each clearable. Selecting a different indicator in the same
 * family replaces the active one; never additive.
 */

interface Props {
  indicators: IndicatorPublic[];
}

export default function IndicatorSelector({ indicators }: Props): React.JSX.Element {
  const activeSchool = useHubStore((s) => s.activeSchoolIndicator);
  const activeCommunity = useHubStore((s) => s.activeCommunityIndicator);
  const setSchool = useHubStore((s) => s.setSchoolIndicator);
  const setCommunity = useHubStore((s) => s.setCommunityIndicator);

  const school = indicators.filter((i) => i.family === 'school');
  const community = indicators.filter((i) => i.family === 'community');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Group
        title="School indicators"
        items={school}
        activeId={activeSchool}
        onPick={(id) => setSchool(activeSchool === id ? null : id)}
      />
      <Group
        title="Community indicators"
        items={community}
        activeId={activeCommunity}
        onPick={(id) => setCommunity(activeCommunity === id ? null : id)}
      />
    </div>
  );
}

function Group({
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
  const byTheme = new Map<string, IndicatorPublic[]>();
  for (const i of items) {
    const list = byTheme.get(i.theme) ?? [];
    list.push(i);
    byTheme.set(i.theme, list);
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
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[...byTheme.entries()].map(([theme, list]) => (
          <div key={theme}>
            <div style={{ fontSize: 11, color: '#467c9d', marginBottom: 4 }}>{theme}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {list.map((i) => {
                const selected = i.id === activeId;
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => onPick(i.id)}
                    style={{
                      textAlign: 'left',
                      padding: '4px 6px',
                      borderRadius: 4,
                      border: '1px solid transparent',
                      background: selected ? '#027BC0' : 'transparent',
                      color: selected ? 'white' : '#002040',
                      fontSize: 12,
                      cursor: 'pointer',
                      lineHeight: 1.3,
                    }}
                  >
                    {i.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
