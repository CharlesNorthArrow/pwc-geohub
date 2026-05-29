'use client';

import { useHubStore } from '../store/useHubStore';
import AggregationToggle from './AggregationToggle';
import KpiCards from './KpiCards';
import RankedList from './RankedList';
import Timeline from './Timeline';
import type {
  IndicatorPublic,
  SchoolMaster,
} from '../contract/types';
import type { Analytics } from '../store/analytics';

interface Props {
  indicator: IndicatorPublic | null;
  analytics: Analytics | null;
  schoolsMaster: SchoolMaster[];
  year: string;
  /** True when the active indicator is community → show aggregation toggle. */
  showAggregationToggle: boolean;
}

/**
 * Spec §2 — right panel ~35% width, open by default, collapsible. Contents
 * (§5.1–5.4):
 *   - KPI cards (Anchor / Healing Arts / All)
 *   - 5-year timeline (3 series + active-year marker)
 *   - Ranked PWC school list with sparklines
 *   - District ↔ NTA toggle when a community indicator is the focus
 */
export default function RightPanel({
  indicator,
  analytics,
  schoolsMaster,
  year,
  showAggregationToggle,
}: Props): React.JSX.Element {
  const collapsed = useHubStore((s) => s.rightPanelCollapsed);
  const setCollapsed = useHubStore((s) => s.setRightPanelCollapsed);

  if (collapsed) {
    return (
      <aside
        style={{
          width: 28,
          borderLeft: '1px solid #e5e9ee',
          background: '#f7f9fb',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '8px 0',
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand analytics panel"
          title="Expand analytics panel"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: '#467c9d',
            fontSize: 14,
            padding: 0,
          }}
        >
          ◀
        </button>
      </aside>
    );
  }

  return (
    <aside
      style={{
        borderLeft: '1px solid #e5e9ee',
        background: '#f7f9fb',
        overflowY: 'auto',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minWidth: 0,
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: '#002040',
            }}
          >
            Analytics
          </div>
          <div style={{ fontSize: 11, color: '#467c9d', marginTop: 2 }}>
            {indicator ? (indicator.short_label ?? indicator.label) : 'Pick an indicator'}
            {indicator ? <span style={{ color: '#a8b3bf' }}> · {year}</span> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse analytics panel"
          title="Collapse"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: '#467c9d',
            fontSize: 14,
          }}
        >
          ▶
        </button>
      </header>

      {showAggregationToggle ? <AggregationToggle /> : null}

      {indicator && analytics ? (
        <>
          <KpiCards indicator={indicator} kpis={analytics.kpis} year={year} />
          <section>
            <div
              style={{
                fontSize: 10,
                color: '#467c9d',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                fontWeight: 600,
                marginBottom: 4,
              }}
            >
              5-year trend
            </div>
            <Timeline indicator={indicator} points={analytics.timeline} activeYear={year} />
          </section>
          <section>
            <div
              style={{
                fontSize: 10,
                color: '#467c9d',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                fontWeight: 600,
                marginBottom: 4,
              }}
            >
              PWC schools (worst → best)
            </div>
            <RankedList
              indicator={indicator}
              rows={analytics.list}
              schoolsMaster={schoolsMaster}
              activeYear={year}
            />
          </section>
        </>
      ) : (
        <div style={{ fontSize: 11, color: '#a8b3bf', padding: '16px 0' }}>
          Select a school or community indicator to see analytics.
        </div>
      )}
    </aside>
  );
}
