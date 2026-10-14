'use client';

import { useMemo } from 'react';

import type {
  AnalyticsSeriesRow,
  PwcMember,
  SchoolsResponse,
} from '../contract/types';
import type { LayerState } from '../store/activeLayers';
import { belongsToPwcGroup } from '../store/pwcGroups';
import { useHubStore } from '../store/useHubStore';

interface Props {
  /** DBNs that pass every active filter (Geo + School Type + Cohort). The
   *  counter's TOTAL is anchored to this set — never to the map's viewport.
   *  That keeps totals stable as the user pans/zooms and consistent across
   *  indicator switches. */
  universeDbns: Set<string>;
  /** Current per-slider-year PWC membership (Shell already keeps this in
   *  sync with the slider position). */
  pwcMembers: PwcMember[];
  /** Active school layer + its feature collection. When both are set, the
   *  counter surfaces a "X of N do not have data for {indicator}" line so
   *  users know why a count looks low — without changing the totals. */
  schoolLayer: LayerState | null;
  schoolData: SchoolsResponse | null;
  /** Same idea for the community family. The series rows already carry
   *  per-school AGGREGATED values from the §11.9 crosswalk path; we just
   *  filter to `layer.cohortYear` to count missing values. */
  communityLayer: LayerState | null;
  communitySeries: AnalyticsSeriesRow[] | null;
}

const PWC_MAGENTA = '#903090';   // Anchor (includes both-category)
const PWC_GREEN = '#A0B000';     // Healing Arts (pure HA only)
const PWC_BLUE = '#027BC0';      // pwc_other
const COMMUNITY_ACCENT = '#F0901F'; // distinct from PWC HA

/**
 * Floating top-left counter — PWC schools currently in view (filtered by
 * Geo + School Type + Cohort cascade, NOT by map viewport). Anchor-wins:
 * both-category schools count ONLY in Anchor, so the Anchor + Healing Arts
 * + Other buckets are disjoint and sum to the total. When an indicator is
 * active, surfaces a "X of N do not have data for {indicator}" line per
 * family so the totals stay honest. The Anchor and Healing Arts only rows are
 * toggles: a click sets School Type to that group, a second click returns to
 * all PWC.
 */
export default function PwcCounter({
  universeDbns,
  pwcMembers,
  schoolLayer,
  schoolData,
  communityLayer,
  communitySeries,
}: Props): React.JSX.Element | null {
  const pwcHalosVisible = useHubStore((s) => s.pwcHalosVisible);
  const setPwcHalosVisible = useHubStore((s) => s.setPwcHalosVisible);
  const schoolType = useHubStore((s) => s.schoolType);
  const setSchoolType = useHubStore((s) => s.setSchoolType);

  // Clicking a group row filters to it (same School Type values the header
  // dropdown writes); clicking the active row again goes back to all PWC.
  const toggleGroup = (group: 'anchor' | 'healing_arts'): void =>
    setSchoolType(schoolType === group ? 'pwc' : group);
  const groupFilterOn = schoolType === 'anchor' || schoolType === 'healing_arts';

  const counts = useMemo(() => {
    const pwcByDbn = new Map(pwcMembers.map((m) => [m.dbn, m]));
    let anchor = 0;
    let healing = 0;
    let other = 0;
    const pwcInUniverse: string[] = [];
    for (const dbn of universeDbns) {
      const m = pwcByDbn.get(dbn);
      if (!m) continue;
      pwcInUniverse.push(dbn);
      // Anchor-wins: both-category schools fold into Anchor only. Healing Arts
      // counts pure HA only — these three buckets are disjoint.
      if (m.category === 'anchor' || m.category === 'both') anchor++;
      else if (m.category === 'healing_arts') healing++;
      else other++;
    }
    return {
      anchor,
      healing,
      other,
      total: pwcInUniverse.length,
      pwcDbns: pwcInUniverse,
    };
  }, [pwcMembers, universeDbns]);

  // Per-family missing-data counts — only over the PWC schools that the
  // total already includes. Lets the user see how many PWC schools lack
  // data for the active indicator without ever changing the headline total.
  const schoolMissing = useMemo(() => {
    if (!schoolLayer || schoolLayer.noData || !schoolData) return null;
    const hasValue = new Set<string>();
    for (const f of schoolData.features) {
      if (f.properties.value_num != null) hasValue.add(f.properties.dbn);
    }
    let missing = 0;
    for (const dbn of counts.pwcDbns) if (!hasValue.has(dbn)) missing++;
    return missing;
  }, [schoolLayer, schoolData, counts.pwcDbns]);

  const communityMissing = useMemo(() => {
    if (!communityLayer || communityLayer.noData || !communitySeries) return null;
    const cy = communityLayer.cohortYear;
    if (!cy) return null;
    const hasValue = new Set<string>();
    for (const r of communitySeries) {
      if (r.year === cy && r.value_num != null) hasValue.add(r.dbn);
    }
    let missing = 0;
    for (const dbn of counts.pwcDbns) if (!hasValue.has(dbn)) missing++;
    return missing;
  }, [communityLayer, communitySeries, counts.pwcDbns]);

  // Stay visible while a group filter is on, so the user can click back out.
  if (counts.total === 0 && !groupFilterOn) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        background: 'rgba(255,255,255,0.96)',
        border: '1px solid #dde4ea',
        borderRadius: 6,
        boxShadow: '0 2px 6px rgba(0,32,64,0.12)',
        padding: '8px 10px',
        fontSize: 11,
        color: '#002040',
        minWidth: 176,
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 5,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: '#467c9d',
          marginBottom: 4,
        }}
      >
        PWC schools in view
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: '#002040',
          lineHeight: 1,
          marginBottom: 6,
        }}
      >
        {counts.total}
      </div>
      <Row
        color={PWC_MAGENTA}
        label="Anchor"
        count={counts.anchor}
        active={schoolType === 'anchor'}
        dimmed={groupFilterOn && schoolType !== 'anchor'}
        onClick={() => toggleGroup('anchor')}
      />
      <Row
        color={PWC_GREEN}
        label="Healing Arts only"
        count={counts.healing}
        active={schoolType === 'healing_arts'}
        dimmed={groupFilterOn && schoolType !== 'healing_arts'}
        onClick={() => toggleGroup('healing_arts')}
      />
      {counts.other > 0 ? (
        <Row color={PWC_BLUE} label="Other program" count={counts.other} />
      ) : null}

      {/* Missing-data lines — one per active family. Only render when the
       *  indicator's data has come back AND at least one PWC school in view
       *  lacks a value for it. Total above never moves. */}
      {schoolMissing != null && schoolMissing > 0 && schoolLayer ? (
        <MissingLine
          accent={PWC_BLUE}
          label={schoolLayer.indicator.short_label ?? schoolLayer.indicator.label}
          missing={schoolMissing}
          total={counts.total}
        />
      ) : null}
      {communityMissing != null && communityMissing > 0 && communityLayer ? (
        <MissingLine
          accent={COMMUNITY_ACCENT}
          label={communityLayer.indicator.short_label ?? communityLayer.indicator.label}
          missing={communityMissing}
          total={counts.total}
        />
      ) : null}

      {/* Halo toggle — drops the colored border around PWC dots so the map
       *  reads as a clean indicator view without the PWC overlay. Only shown
       *  when a school indicator is active; in baseline view the PWC color
       *  is the fill itself so no halo is in play. */}
      {schoolLayer ? (
        <button
          type="button"
          onClick={() => setPwcHalosVisible(!pwcHalosVisible)}
          aria-pressed={!pwcHalosVisible}
          title={pwcHalosVisible ? 'Hide PWC halos' : 'Show PWC halos'}
          style={{
            marginTop: 8,
            padding: '4px 6px',
            background: pwcHalosVisible ? '#eef4f8' : '#ffffff',
            color: pwcHalosVisible ? '#1a4a73' : '#467c9d',
            border: '1px solid #c5cdd6',
            borderRadius: 4,
            fontSize: 10,
            cursor: 'pointer',
            fontWeight: 600,
            width: '100%',
            textAlign: 'center',
            letterSpacing: 0.2,
          }}
        >
          {pwcHalosVisible ? '◉ Halos on' : '○ Halos off'}
        </button>
      ) : null}
    </div>
  );
}

function Row({
  color,
  label,
  count,
  active = false,
  dimmed = false,
  onClick,
}: {
  color: string;
  label: string;
  count: number;
  active?: boolean;
  dimmed?: boolean;
  /** When set, the row is a toggle button that filters the map to this group. */
  onClick?: () => void;
}): React.JSX.Element {
  const content = (
    <>
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
        }}
      />
      <span style={{ flex: 1, color: '#002040', fontWeight: active ? 700 : 400 }}>{label}</span>
      <span style={{ fontWeight: 700, color: '#002040' }}>{count}</span>
    </>
  );
  const layout: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 0',
  };
  if (!onClick) return <div style={layout}>{content}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? 'Show all PWC schools' : `Show only ${label}`}
      style={{
        ...layout,
        width: 'calc(100% + 8px)',
        margin: '0 -4px',
        padding: '2px 4px',
        background: active ? '#eef4f8' : 'transparent',
        border: 'none',
        borderRadius: 3,
        cursor: 'pointer',
        font: 'inherit',
        textAlign: 'left',
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      {content}
    </button>
  );
}

function MissingLine({
  accent,
  label,
  missing,
  total,
}: {
  accent: string;
  label: string;
  missing: number;
  total: number;
}): React.JSX.Element {
  return (
    <div
      style={{
        marginTop: 6,
        paddingTop: 6,
        borderTop: '1px solid #eef0f3',
        fontSize: 10,
        color: '#467c9d',
        lineHeight: 1.35,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: 1,
            background: accent,
          }}
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }} title={label}>
          {label}
        </span>
      </div>
      <div>
        <strong style={{ color: '#002040' }}>{missing}</strong> of {total} have no data for this indicator
      </div>
    </div>
  );
}
