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
  /** True when the indicator's scale is categorical — the server averages
   *  a NULL `value_num` for those, so numeric KPIs/timeline/list aren't
   *  meaningful. RightPanel shows a friendly notice instead. */
  analyticsUnavailable: boolean;
  schoolsMaster: SchoolMaster[];
  year: string;
  /** True when the active indicator is community → show aggregation toggle. */
  showAggregationToggle: boolean;
  /** True only when BOTH a school and a community indicator are active —
   *  show a 2-way switch so the user can pick which one drives the panel. */
  showFamilyToggle: boolean;
  /** Current effective analytics family. */
  familyToggleValue: 'school' | 'community';
  /** Labels for the toggle buttons (skipped when the family isn't active). */
  schoolIndicatorLabel: string | null;
  communityIndicatorLabel: string | null;
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
  analyticsUnavailable,
  schoolsMaster,
  year,
  showAggregationToggle,
  showFamilyToggle,
  familyToggleValue,
  schoolIndicatorLabel,
  communityIndicatorLabel,
}: Props): React.JSX.Element {
  const collapsed = useHubStore((s) => s.rightPanelCollapsed);
  const setCollapsed = useHubStore((s) => s.setRightPanelCollapsed);
  const setAnalyticsFamily = useHubStore((s) => s.setAnalyticsFamily);

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

      {showFamilyToggle && schoolIndicatorLabel && communityIndicatorLabel ? (
        <FamilyToggle
          value={familyToggleValue}
          schoolLabel={schoolIndicatorLabel}
          communityLabel={communityIndicatorLabel}
          onChange={setAnalyticsFamily}
        />
      ) : null}

      {showAggregationToggle ? <AggregationToggle /> : null}

      {indicator && analyticsUnavailable ? (
        <CategoricalNotice />
      ) : indicator && analytics ? (
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

/** Shown for categorical indicators (e.g. racial_predominance) where the
 *  server-side AVG(value_num) returns NULL, so numeric KPIs/timeline/list
 *  aren't computable. Points users at the map for the per-tract category. */
function CategoricalNotice(): React.JSX.Element {
  return (
    <div
      style={{
        marginTop: 4,
        padding: 12,
        border: '1px solid #dde4ea',
        borderRadius: 6,
        background: '#fbfcfe',
        fontSize: 12,
        color: '#002040',
        lineHeight: 1.4,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        Numeric analytics not available
      </div>
      <div style={{ color: '#467c9d' }}>
        This is a categorical indicator. The map shows the per-tract category;
        per-school averages aren't meaningful here.
      </div>
    </div>
  );
}

/** Segmented control shown when BOTH families are active — lets the user
 *  pick which one drives the KPIs / timeline / list below. */
function FamilyToggle({
  value,
  schoolLabel,
  communityLabel,
  onChange,
}: {
  value: 'school' | 'community';
  schoolLabel: string;
  communityLabel: string;
  onChange: (next: 'school' | 'community') => void;
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label="Analytics focus"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 4,
        padding: 3,
        background: '#eef2f6',
        borderRadius: 6,
        border: '1px solid #dde4ea',
      }}
    >
      <FamilyToggleButton
        active={value === 'school'}
        family="school"
        label={schoolLabel}
        onClick={() => onChange('school')}
      />
      <FamilyToggleButton
        active={value === 'community'}
        family="community"
        label={communityLabel}
        onClick={() => onChange('community')}
      />
    </div>
  );
}

function FamilyToggleButton({
  active,
  family,
  label,
  onClick,
}: {
  active: boolean;
  family: 'school' | 'community';
  label: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        background: active ? '#027BC0' : 'transparent',
        color: active ? 'white' : '#002040',
        border: 'none',
        padding: '6px 8px',
        borderRadius: 4,
        cursor: 'pointer',
        textAlign: 'left',
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 1,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 9,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          opacity: active ? 0.85 : 0.6,
        }}
      >
        {family === 'school' ? 'School' : 'Community'}
      </span>
      <span
        style={{
          fontSize: 11,
          lineHeight: 1.2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
        }}
        title={label}
      >
        {label}
      </span>
    </button>
  );
}
