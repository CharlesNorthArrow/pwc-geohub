'use client';

import { useEffect, useMemo, useState } from 'react';

import Logo from './Logo';
import {
  fetchAnalyticsSeries,
  fetchPwcHistory,
  fetchSchoolsMaster,
} from '../contract/client';
import type {
  AnalyticsSeriesRow,
  IndicatorPublic,
  PwcMember,
  SchoolMaster,
} from '../contract/types';
import { SCHOOL_THEME_ORDER } from '../registry/indicators';
import type { Format, GoodDirection } from '../registry/types';
import { applyFilters } from '../store/derived';
import { deltaStatus } from '../store/analytics';
import { belongsToPwcGroup } from '../store/pwcGroups';
import { formatDelta, formatValue, mean } from '../lib/format';

interface InitialProps {
  initialIndicators: IndicatorPublic[];
}

/**
 * Spec §10 "Scorecard" — full-screen, read-at-a-glance comparison of PWC
 * groups (Anchor / Healing Arts) vs a benchmark (the same scope) across
 * every active indicator at its own latest year.
 *
 * Decoupled from the dashboard: no slider, no Geo/Cohort/School Type
 * filters. The only control is the scope toggle (Citywide or one of the
 * five boroughs) — which filters BOTH PWC group avgs AND the benchmark
 * consistently so deltas stay comparable.
 *
 * Pre-fetches all 20 indicator series in parallel on mount; scope changes
 * are client-side recomputes only.
 */
export default function Scorecard({ initialIndicators }: InitialProps): React.JSX.Element {
  const [indicators] = useState<IndicatorPublic[]>(initialIndicators);
  const [schoolsMaster, setSchoolsMaster] = useState<SchoolMaster[] | null>(null);
  const [pwcMembers, setPwcMembers] = useState<PwcMember[] | null>(null);
  // dbn → value at indicator.latestYear, keyed by indicator id. Built once
  // per indicator from the analytics series — scope toggle never refetches.
  const [valuesByIndicator, setValuesByIndicator] = useState<Record<string, Map<string, number>>>(
    {},
  );
  const [scope, setScope] = useState<Scope>('citywide');

  /* -------------------- one-shot fetches -------------------- */
  useEffect(() => {
    fetchSchoolsMaster()
      .then((r) => setSchoolsMaster(r.schools))
      .catch((err) => console.warn('[Scorecard] schools-master fetch failed', err));

    // Use the LATEST snapshot of PWC membership for the "is this school an
    // Anchor / Healing Arts school today" classification. Scorecard is a
    // present-tense snapshot, not a longitudinal view — using current
    // membership is the honest choice.
    fetchPwcHistory()
      .then((r) => {
        const years = Object.keys(r.byYear).sort();
        const latest = years[years.length - 1];
        setPwcMembers(latest ? (r.byYear[latest] ?? []) : []);
      })
      .catch((err) => console.warn('[Scorecard] pwc history fetch failed', err));
  }, []);

  /* -------------------- 20 indicator-series fetches (parallel) -------------------- */
  useEffect(() => {
    if (indicators.length === 0) return;
    let abandoned = false;
    Promise.all(
      indicators.map(async (ind) => {
        try {
          // Community indicators always use NTA aggregation here (no toggle).
          // School indicators don't take aggArea — pass null.
          const aggArea = ind.family === 'community' ? 'nta_2020' : null;
          const r = await fetchAnalyticsSeries(ind.id, aggArea);
          return { id: ind.id, rows: r.series, latest: latestYear(ind) };
        } catch (err) {
          console.warn(`[Scorecard] series fetch failed for ${ind.id}`, err);
          return { id: ind.id, rows: [] as AnalyticsSeriesRow[], latest: null };
        }
      }),
    ).then((results) => {
      if (abandoned) return;
      const next: Record<string, Map<string, number>> = {};
      for (const { id, rows, latest } of results) {
        const m = new Map<string, number>();
        if (latest != null) {
          for (const r of rows) {
            if (r.year === latest && r.value_num != null) m.set(r.dbn, r.value_num);
          }
        }
        next[id] = m;
      }
      setValuesByIndicator(next);
    });
    return () => {
      abandoned = true;
    };
  }, [indicators]);

  /* -------------------- universe + PWC group sets per scope -------------------- */
  const inScope = useMemo(() => {
    if (!schoolsMaster) return null;
    const county = SCOPE_TO_COUNTY[scope];
    // applyFilters is the documented "schools-in-view" selector. We feed it
    // a scope-driven geo filter (or {} for Citywide), allCohorts=[] since
    // we don't surface a cohort dropdown here, and let it produce the
    // canonical in-scope set. `pwcMembers ?? []` keeps the cohort math safe
    // until the PWC fetch settles.
    const universe = applyFilters({
      state: {
        geoFilters: county ? { county: [county] } : {},
        schoolType: 'all',
        cohort: null,
        programs: [],
        grades: [],
      },
      schoolsMaster,
      pwcMembers: pwcMembers ?? [],
      allCohorts: [],
    });
    return universe.schoolDbns;
  }, [schoolsMaster, pwcMembers, scope]);

  const groupDbns = useMemo(() => {
    if (!inScope || !pwcMembers) return null;
    const byDbn = new Map(pwcMembers.map((m) => [m.dbn, m]));
    const anchor = new Set<string>();
    const healing = new Set<string>();
    for (const dbn of inScope) {
      const m = byDbn.get(dbn);
      if (!m) continue;
      if (belongsToPwcGroup(m.category, 'anchor')) anchor.add(dbn);
      if (belongsToPwcGroup(m.category, 'healing_arts')) healing.add(dbn);
    }
    return { anchor, healing, benchmark: inScope };
  }, [inScope, pwcMembers]);

  /* -------------------- grouped indicator lists -------------------- */
  const schoolByTheme = useMemo(() => {
    const buckets = new Map<string, IndicatorPublic[]>();
    for (const ind of indicators) {
      if (ind.family !== 'school') continue;
      const list = buckets.get(ind.theme) ?? [];
      list.push(ind);
      buckets.set(ind.theme, list);
    }
    const ordered: Array<[string, IndicatorPublic[]]> = [];
    for (const theme of SCHOOL_THEME_ORDER) {
      const list = buckets.get(theme);
      if (list) ordered.push([theme, list]);
      buckets.delete(theme);
    }
    // Anything not in the canonical order trailing.
    for (const [theme, list] of buckets) ordered.push([theme, list]);
    return ordered;
  }, [indicators]);

  const communityIndicators = useMemo(
    () => indicators.filter((i) => i.family === 'community'),
    [indicators],
  );

  const ready = schoolsMaster != null && pwcMembers != null && groupDbns != null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        // Global body sets `overflow: hidden` so the dashboard's panel-scroll
        // layout works; the Scorecard pins the Logo bar at the top and gives
        // its own <main> the document scroll instead.
        height: '100dvh',
        background: '#f7f9fb',
        minHeight: 0,
      }}
    >
      {/* Full-width Logo bar — same component as the dashboard so the brand
       *  chrome stays consistent across views. */}
      <Logo />

      <main
        style={{
          // Two rows: pinned header (title + scope toggle) and scrolling
          // table area. Only the table scrolls — the page header stays put.
          display: 'grid',
          gridTemplateRows: 'auto 1fr',
          padding: '20px 28px 0',
          maxWidth: 1280,
          width: '100%',
          margin: '0 auto',
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 16,
            marginBottom: 16,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: '#002040',
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              Indicator Scorecard
            </h1>
            <p style={{ fontSize: 13, color: '#467c9d', margin: '4px 0 0' }}>
              How PWC schools compare to a benchmark, at each indicator&apos;s latest year.
              Community-indicator rows use each school&apos;s NTA-aggregated area value.
            </p>
          </div>
          <ScopeToggle value={scope} onChange={setScope} />
        </header>

        <div
          style={{
            // Only this region scrolls — page header (above) + Logo bar stay
            // fixed so the scope toggle is always reachable while reading.
            overflowY: 'auto',
            minHeight: 0,
            paddingBottom: 40,
          }}
        >
          {!ready ? (
            <LoadingState />
          ) : (
            <ScorecardTable
              schoolByTheme={schoolByTheme}
              communityIndicators={communityIndicators}
              valuesByIndicator={valuesByIndicator}
              groupDbns={groupDbns!}
              scope={scope}
            />
          )}
        </div>
      </main>
    </div>
  );
}

/* ========================================================================== */
/* Loading state                                                              */
/* ========================================================================== */

function LoadingState(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label="Loading scorecard data"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '60px 0',
        color: '#467c9d',
        fontSize: 13,
      }}
    >
      <style>{SPINNER_CSS}</style>
      <svg
        width={32}
        height={32}
        viewBox="0 0 32 32"
        aria-hidden
        style={{ display: 'block' }}
      >
        <circle
          cx={16}
          cy={16}
          r={13}
          fill="none"
          stroke="#dde4ea"
          strokeWidth={3}
        />
        <circle
          cx={16}
          cy={16}
          r={13}
          fill="none"
          stroke="#027BC0"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="20 60"
          className="scorecard-spinner"
        />
      </svg>
      <span>Loading indicator data…</span>
    </div>
  );
}

const SPINNER_CSS = `
@keyframes scorecard-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.scorecard-spinner {
  transform-origin: 16px 16px;
  transform-box: view-box;
  animation: scorecard-spin 1s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .scorecard-spinner { animation: none; }
}
`;

/* ========================================================================== */
/* Scope                                                                      */
/* ========================================================================== */

export type Scope =
  | 'citywide'
  | 'bronx'
  | 'brooklyn'
  | 'manhattan'
  | 'queens'
  | 'staten_island';

/** Maps the scope toggle to a `county` geo `area_id`. The cached county layer
 *  uses 5-digit state+county FIPS codes (NY = 36; Bronx = 005, Kings = 047,
 *  New York = 061, Queens = 081, Richmond = 085), matching what we get from
 *  `getGeographies()` and what `school_geo_crosswalk.county` stores. */
const SCOPE_TO_COUNTY: Record<Scope, string | null> = {
  citywide: null,
  bronx: '36005',
  brooklyn: '36047',
  manhattan: '36061',
  queens: '36081',
  staten_island: '36085',
};

const SCOPE_LABELS: Record<Scope, string> = {
  citywide: 'Citywide',
  bronx: 'Bronx',
  brooklyn: 'Brooklyn',
  manhattan: 'Manhattan',
  queens: 'Queens',
  staten_island: 'Staten Island',
};

const SCOPE_ORDER: Scope[] = ['citywide', 'bronx', 'brooklyn', 'manhattan', 'queens', 'staten_island'];

function ScopeToggle({
  value,
  onChange,
}: {
  value: Scope;
  onChange: (next: Scope) => void;
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Scope"
      style={{
        display: 'inline-flex',
        background: 'white',
        border: '1px solid #c5cdd6',
        borderRadius: 6,
        padding: 3,
        gap: 2,
        flexWrap: 'wrap',
      }}
    >
      {SCOPE_ORDER.map((s) => {
        const active = s === value;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(s)}
            style={{
              background: active ? '#027BC0' : 'transparent',
              color: active ? 'white' : '#002040',
              border: 'none',
              padding: '5px 10px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              whiteSpace: 'nowrap',
            }}
          >
            {SCOPE_LABELS[s]}
          </button>
        );
      })}
    </div>
  );
}

/* ========================================================================== */
/* Table                                                                      */
/* ========================================================================== */

interface GroupDbns {
  anchor: Set<string>;
  healing: Set<string>;
  benchmark: Set<string>;
}

function ScorecardTable({
  schoolByTheme,
  communityIndicators,
  valuesByIndicator,
  groupDbns,
  scope,
}: {
  schoolByTheme: Array<[string, IndicatorPublic[]]>;
  communityIndicators: IndicatorPublic[];
  valuesByIndicator: Record<string, Map<string, number>>;
  groupDbns: GroupDbns;
  scope: Scope;
}): React.JSX.Element {
  return (
    <div
      style={{
        background: 'white',
        border: '1px solid #e5e9ee',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <TableHeader scope={scope} />

      {/* ───── School Indicators (top-level group) ───── */}
      <FamilyHeader label="School Indicators" />
      {schoolByTheme.map(([theme, list]) => (
        <ThemeSection key={theme} theme={theme}>
          {list.map((ind) => (
            <ScorecardRow
              key={ind.id}
              indicator={ind}
              values={valuesByIndicator[ind.id] ?? new Map()}
              groupDbns={groupDbns}
            />
          ))}
        </ThemeSection>
      ))}

      {/* ───── Community Indicators (top-level group, flat list) ───── */}
      <FamilyHeader label="Community Indicators" hint="NTA-aggregated" />
      {communityIndicators.map((ind) => (
        <ScorecardRow
          key={ind.id}
          indicator={ind}
          values={valuesByIndicator[ind.id] ?? new Map()}
          groupDbns={groupDbns}
        />
      ))}
    </div>
  );
}

/** 7-column grid, shared by header + rows so they line up exactly.
 *  Order: Indicator | Anchor avg | Δ Anchor | HA avg | Δ HA | Benchmark | seam.
 *  Each Δ column sits IMMEDIATELY after the group it compares so the eye can
 *  read "value → delta" without crossing the table. Δ columns are tinted to
 *  reinforce the grouping. Column 7 is the future "open in dashboard /
 *  download row" action seam (currently empty per the goal's clean-seam rule). */
const GRID_TEMPLATE = '1.6fr 0.95fr 0.7fr 0.95fr 0.7fr 1.0fr 28px';

/** Subtle tint applied to the two Δ columns (header + every cell) so the
 *  "value → delta" pairing reads at a glance. Very light brand-blue so it
 *  doesn't fight the indicator name's prominence. */
const DELTA_BG = '#f0f6fb';

/** What the benchmark column averages over, in plain English. Citywide =
 *  all in-scope schools (no county filter). For boroughs, label as such so
 *  the header reads honestly. */
function benchmarkLabel(scope: Scope): string {
  return scope === 'citywide' ? 'Citywide avg' : `${SCOPE_LABELS[scope]} avg`;
}

function TableHeader({ scope }: { scope: Scope }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: GRID_TEMPLATE,
        gap: 0,
        padding: '0 16px',
        background: '#eef4f8',
        borderBottom: '1px solid #c5cdd6',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        color: '#467c9d',
      }}
    >
      <span style={{ padding: '8px 0' }}>Indicator</span>
      <HeadCell>Anchor avg</HeadCell>
      <HeadCell tint>Δ Anchor</HeadCell>
      <HeadCell>Healing Arts avg</HeadCell>
      <HeadCell tint>Δ Healing Arts</HeadCell>
      <HeadCell>{benchmarkLabel(scope)}</HeadCell>
      <span />
    </div>
  );
}

function HeadCell({
  children,
  tint,
}: {
  children: React.ReactNode;
  tint?: boolean;
}): React.JSX.Element {
  return (
    <span
      style={{
        textAlign: 'right',
        padding: '8px 8px',
        background: tint ? DELTA_BG : undefined,
      }}
    >
      {children}
    </span>
  );
}

function FamilyHeader({
  label,
  hint,
}: {
  label: string;
  hint?: string;
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: '12px 16px 8px',
        background: '#027BC0',
        color: 'white',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        borderTop: '1px solid #e5e9ee',
      }}
    >
      <span>{label}</span>
      {hint ? (
        <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.85, textTransform: 'none' }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function ThemeSection({
  theme,
  children,
}: {
  theme: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div
        style={{
          padding: '6px 16px',
          background: '#f7f9fb',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: '#467c9d',
          borderTop: '1px solid #eef0f3',
        }}
      >
        {theme}
      </div>
      {children}
    </div>
  );
}

/* ========================================================================== */
/* Row                                                                        */
/* ========================================================================== */

function ScorecardRow({
  indicator,
  values,
  groupDbns,
}: {
  indicator: IndicatorPublic;
  values: Map<string, number>;
  groupDbns: GroupDbns;
}): React.JSX.Element {
  const latest = latestYear(indicator);

  // Categorical indicators have no `value_num` — averaging would yield null
  // anyway. Render a friendly placeholder row so the table is complete.
  if (indicator.scale.type === 'categorical') {
    return (
      <RowShell indicator={indicator} latest={latest}>
        <Spanned label="categorical · see map" />
      </RowShell>
    );
  }

  // Build per-group value lists from the scope-restricted dbn sets.
  const anchorVals = collectValues(values, groupDbns.anchor);
  const healingVals = collectValues(values, groupDbns.healing);
  const benchVals = collectValues(values, groupDbns.benchmark);

  const anchorAvg = mean(anchorVals);
  const healingAvg = mean(healingVals);
  const benchAvg = mean(benchVals);

  // No value-in-scope at all → full no-data row.
  if (benchAvg == null && anchorAvg == null && healingAvg == null) {
    return (
      <RowShell indicator={indicator} latest={latest}>
        <Spanned label="🗓️ No data in scope" tone="warn" />
      </RowShell>
    );
  }

  // Column order: Anchor avg · Δ Anchor · HA avg · Δ HA · Benchmark · seam.
  // Δ cells sit right next to the group they compare so the eye reads
  // value → delta as a pair. Δ cells carry a subtle tint (DELTA_BG).
  return (
    <RowShell indicator={indicator} latest={latest}>
      <ValueCell value={anchorAvg} n={anchorVals.length} format={indicator.format} />
      <DeltaCell
        groupAvg={anchorAvg}
        benchAvg={benchAvg}
        format={indicator.format}
        goodDirection={indicator.scale.good_direction}
        tint
      />
      <ValueCell value={healingAvg} n={healingVals.length} format={indicator.format} />
      <DeltaCell
        groupAvg={healingAvg}
        benchAvg={benchAvg}
        format={indicator.format}
        goodDirection={indicator.scale.good_direction}
        tint
      />
      <ValueCell value={benchAvg} n={benchVals.length} format={indicator.format} isBenchmark />
      <span />
    </RowShell>
  );
}

function RowShell({
  indicator,
  latest,
  children,
}: {
  indicator: IndicatorPublic;
  latest: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  const name = indicator.short_label ?? indicator.label;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: GRID_TEMPLATE,
        // No grid gap and no vertical row padding — each numeric cell owns
        // its own vertical + horizontal padding so the tinted Δ columns
        // extend full row height, top to bottom, forming a continuous band.
        gap: 0,
        padding: '0 16px',
        borderTop: '1px solid #f5f7fa',
        alignItems: 'stretch',
      }}
    >
      <div style={{ minWidth: 0, paddingRight: 12, paddingTop: 10, paddingBottom: 10, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div
          style={{
            fontSize: 13,
            color: '#002040',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={indicator.description ? `${indicator.label} — ${indicator.description}` : indicator.label}
        >
          {name}
        </div>
        <div style={{ fontSize: 10, color: '#a8b3bf', marginTop: 1 }}>
          {latest ?? '—'}
        </div>
      </div>
      {children}
    </div>
  );
}

function ValueCell({
  value,
  n,
  format,
  isBenchmark,
}: {
  value: number | null;
  n: number;
  format: Format;
  /** When true, n is rendered without the small-N warning tint — the
   *  benchmark is over the whole in-scope universe and is expected to be
   *  large; flagging it as "small N" would just be noise. */
  isBenchmark?: boolean;
}): React.JSX.Element {
  // `n` here is the number of cohort schools with a VALUE for this indicator-
  // year (i.e. contributing to the avg) — that's what honestly contextualizes
  // the mean. Per the goal: "show the group's school count (e.g. Anchor (n=3))".
  // Cells own their padding so the row's grid stretches every cell to the
  // same height. The Δ cells use the same vertical padding so their tint
  // bands match the value-cell heights for a clean column-strip look.
  const cellStyle: React.CSSProperties = {
    padding: '10px 8px',
    textAlign: 'right',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignSelf: 'stretch',
  };
  if (n === 0 || value == null) {
    return <div style={{ ...cellStyle, color: '#a8b3bf', fontSize: 13 }}>n/a</div>;
  }
  const smallN = !isBenchmark && n <= 3;
  return (
    <div style={cellStyle}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#002040', lineHeight: 1.1 }}>
        {formatValue(value, format)}
      </div>
      <div
        style={{
          fontSize: 10,
          color: smallN ? '#9a4a08' : '#a8b3bf',
          fontWeight: smallN ? 600 : 400,
          marginTop: 1,
        }}
        title={smallN ? 'Small group — interpret cautiously' : undefined}
      >
        n={n}
      </div>
    </div>
  );
}

function DeltaCell({
  groupAvg,
  benchAvg,
  format,
  goodDirection,
  tint,
}: {
  groupAvg: number | null;
  benchAvg: number | null;
  format: Format;
  goodDirection: GoodDirection;
  /** Apply the column tint background so Δ cells read as a tinted band. */
  tint?: boolean;
}): React.JSX.Element {
  // Matches ValueCell's 10 px vertical padding so the tinted Δ band lines
  // up exactly with the adjacent value cell on every row.
  const cellPad: React.CSSProperties = {
    padding: '10px 8px',
    background: tint ? DELTA_BG : undefined,
    alignSelf: 'stretch',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  };
  if (groupAvg == null || benchAvg == null) {
    return (
      <div style={{ ...cellPad, textAlign: 'right', color: '#a8b3bf', fontSize: 13 }}>
        n/a
      </div>
    );
  }
  const delta = groupAvg - benchAvg;
  // Reuses the same status function as the dashboard KPI cards — color
  // semantics are identical app-wide.
  const status = deltaStatus(delta, goodDirection);
  const color = status === 'better' ? '#1a7a3d' : status === 'worse' ? '#a82255' : '#467c9d';
  const arrow = status === 'better' ? '↑' : status === 'worse' ? '↓' : '';
  return (
    <div style={{ ...cellPad, textAlign: 'right', color, fontSize: 13, fontWeight: 600 }}>
      <div>
        {formatDelta(delta, format)}
        {arrow ? <span style={{ marginLeft: 4, fontSize: 11 }}>{arrow}</span> : null}
      </div>
    </div>
  );
}

function Spanned({
  label,
  tone,
}: {
  label: string;
  tone?: 'warn';
}): React.JSX.Element {
  // Spans across all 5 numeric columns (cols 2–6). Used for categorical and
  // no-data-in-scope rows so the table layout stays predictable.
  const color = tone === 'warn' ? '#9a4a08' : '#a8b3bf';
  return (
    <div
      style={{
        gridColumn: '2 / span 5',
        textAlign: 'right',
        color,
        fontSize: 12,
        fontStyle: tone === 'warn' ? 'normal' : 'italic',
      }}
    >
      {label}
    </div>
  );
}

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

function collectValues(values: Map<string, number>, dbns: Set<string>): number[] {
  const out: number[] = [];
  for (const dbn of dbns) {
    const v = values.get(dbn);
    if (v != null) out.push(v);
  }
  return out;
}

/** Each indicator's own latest year — the Scorecard pins per-indicator. For
 *  community indicators this is the calendar year; values lookups always use
 *  the year string straight from `years[]` (no slider remap, since the
 *  Scorecard has no slider). */
function latestYear(ind: IndicatorPublic): string | null {
  const y = ind.years;
  return y.length > 0 ? (y[y.length - 1] ?? null) : null;
}
