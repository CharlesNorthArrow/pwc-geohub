'use client';

import { useEffect, useState } from 'react';

import StripPlot from './StripPlot';
import {
  fetchPwcProgram,
  fetchSchoolArtsEd,
  fetchSchoolProfile,
} from '../contract/client';
import type {
  AggregationArea,
  AnalyticsSeriesRow,
  PwcProgram,
  SchoolArtsEd,
  SchoolMaster,
  SchoolProfile,
} from '../contract/types';
import type { Format } from '../registry/types';
import type { LayerState } from '../store/activeLayers';
import { computePercentile, type PercentileResult } from '../store/percentile';

interface Props {
  dbn: string;
  /** Slider year (school_year format). Drives §1.a + §1.c. */
  year: string;
  schoolsMaster: SchoolMaster[];
  /** Active-layer resolution from `resolveActiveLayers` — drives the §1.a
   *  per-family rendering, including the 🗓️ missing-year branch. */
  schoolLayer: LayerState | null;
  communityLayer: LayerState | null;
  /** Per-family analytics series. Already normalized into school_year format
   *  by Shell; community series rows are the per-school District/NTA-aggregated
   *  values (§11.9 — no point-in-polygon at request time). */
  schoolSeries: AnalyticsSeriesRow[] | null;
  communitySeries: AnalyticsSeriesRow[] | null;
  /** Filtered-universe DBN set (§6.6 cascade). The §1.a percentile is taken
   *  over this set; the selected school is always included (see selector). */
  universeDbns: Set<string>;
  /** Current District ↔ NTA toggle — surfaced in the §1.a community label. */
  aggregationArea: AggregationArea;
  onClose: () => void;
}

const SCHOOL_ACCENT = '#027BC0';
const COMMUNITY_ACCENT = '#F0901F';

/**
 * Spec §10 "School Details View" — opens over the right column when the user
 * selects a school via map click / School filter / ranked list. Three sections:
 *   §1.a Performance on active indicators (follows slider, percentile strip)
 *   §1.b School profile (latest-year demographics; slider-independent)
 *   §1.c PWC program detail (PWC schools only; follows slider)
 *
 * Year pills on each section header so the year scope is obvious — 1.a and
 * 1.c track the slider, 1.b shows its own latest available year.
 */
export default function SchoolDetailPanel({
  dbn,
  year,
  schoolsMaster,
  schoolLayer,
  communityLayer,
  schoolSeries,
  communitySeries,
  universeDbns,
  aggregationArea,
  onClose,
}: Props): React.JSX.Element {
  const [profile, setProfile] = useState<SchoolProfile | null>(null);
  // `programLoaded` distinguishes "loading" from "not a PWC school". The
  // API returns `program: null` for the latter and §1.c renders nothing.
  const [program, setProgram] = useState<PwcProgram | null>(null);
  const [programLoaded, setProgramLoaded] = useState(false);
  // Arts education enrichment (between §1.b and §1.c). Slider-independent —
  // pinned to the school's latest arts_ed vintage with non-null disciplines.
  // `null` = in-flight; loaded state always has `artsEd` set (year/disciplines
  // may be null/empty, which the section renders as "not available").
  const [artsEd, setArtsEd] = useState<SchoolArtsEd | null>(null);

  // Section 1.b: latest-year profile (slider-independent — fetch once per dbn).
  useEffect(() => {
    let abandoned = false;
    setProfile(null);
    fetchSchoolProfile(dbn)
      .then((r) => !abandoned && setProfile(r.profile))
      .catch((err) => {
        if (!abandoned) {
          console.warn('[SchoolDetailPanel] profile fetch failed', err);
          setProfile(null);
        }
      });
    return () => {
      abandoned = true;
    };
  }, [dbn]);

  // Arts education: slider-independent — fetch once per dbn, same pattern as
  // §1.b ProfileSection.
  useEffect(() => {
    let abandoned = false;
    setArtsEd(null);
    fetchSchoolArtsEd(dbn)
      .then((r) => !abandoned && setArtsEd(r.artsEd))
      .catch((err) => {
        if (!abandoned) {
          console.warn('[SchoolDetailPanel] arts-ed fetch failed', err);
          // Fall through to the loaded-but-empty state so the section still
          // renders its "not available" copy instead of an infinite spinner.
          setArtsEd({ dbn, year: null, disciplines: [] });
        }
      });
    return () => {
      abandoned = true;
    };
  }, [dbn]);

  // Section 1.c: follows the slider — refetch per (dbn, year).
  useEffect(() => {
    let abandoned = false;
    setProgramLoaded(false);
    fetchPwcProgram(dbn, year)
      .then((r) => {
        if (abandoned) return;
        setProgram(r.program);
        setProgramLoaded(true);
      })
      .catch((err) => {
        if (!abandoned) {
          console.warn('[SchoolDetailPanel] pwc program fetch failed', err);
          setProgram(null);
          setProgramLoaded(true);
        }
      });
    return () => {
      abandoned = true;
    };
  }, [dbn, year]);

  // Identity — prefer the (richer) profile; fall back to schoolsMaster.
  const masterRow = schoolsMaster.find((s) => s.dbn === dbn) ?? null;
  const schoolName = profile?.school_name ?? masterRow?.school_name ?? dbn;
  // "Not shown on map" = the master query filtered this school out as
  // unplottable. The profile endpoint surfaces the flag directly when present.
  const isUnplottable = profile?.is_unplottable ?? !masterRow;

  return (
    <aside
      style={{
        borderLeft: '1px solid #e5e9ee',
        background: '#f7f9fb',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
      aria-label={`School details: ${schoolName}`}
    >
      {/* PWC-blue brand header — three lines (label, name, dbn/borough/grades)
       *  on white text, with the close X on the right. */}
      <header
        style={{
          background: '#027BC0',
          color: 'white',
          padding: '12px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.85)',
            }}
          >
            School details
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'white',
            }}
            title={`${schoolName} · ${dbn}`}
          >
            {schoolName}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.85)',
              marginTop: 2,
            }}
          >
            {dbn}
            {profile?.borough ? <> · Borough {profile.borough}</> : null}
            {profile?.grades ? <> · Grades {profile.grades}</> : null}
          </div>
          {isUnplottable ? (
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: 'white',
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.4)',
                borderRadius: 4,
                padding: '3px 8px',
                display: 'inline-block',
              }}
              title="No coordinates on file — appears in lists but not on the map."
            >
              Not shown on map
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close school details"
          title="Close"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'white',
            fontSize: 20,
            padding: 2,
            lineHeight: 1,
            opacity: 0.85,
          }}
        >
          ×
        </button>
      </header>

      {/* Three sections separated by a hairline + a subtle background-tone
       *  shift so each one reads as its own block. */}
      <div style={{ background: '#ffffff', padding: 12, borderBottom: '1px solid #e5e9ee' }}>
        <PerformanceSection
          dbn={dbn}
          schoolLayer={schoolLayer}
          communityLayer={communityLayer}
          schoolSeries={schoolSeries}
          communitySeries={communitySeries}
          universeDbns={universeDbns}
          aggregationArea={aggregationArea}
        />
      </div>

      <div style={{ background: '#f7f9fb', padding: 12, borderBottom: '1px solid #e5e9ee' }}>
        <ProfileSection profile={profile} />
      </div>

      <div style={{ background: '#ffffff', padding: 12, borderBottom: '1px solid #e5e9ee' }}>
        <ArtsEdSection artsEd={artsEd} />
      </div>

      {programLoaded ? (
        <div style={{ background: '#f7f9fb', padding: 12 }}>
          <ProgramSection program={program} sliderYear={year} />
        </div>
      ) : null}
    </aside>
  );
}

/* ========================================================================== */
/* §1.a Performance                                                           */
/* ========================================================================== */

function PerformanceSection({
  dbn,
  schoolLayer,
  communityLayer,
  schoolSeries,
  communitySeries,
  universeDbns,
  aggregationArea,
}: {
  dbn: string;
  schoolLayer: LayerState | null;
  communityLayer: LayerState | null;
  schoolSeries: AnalyticsSeriesRow[] | null;
  communitySeries: AnalyticsSeriesRow[] | null;
  universeDbns: Set<string>;
  aggregationArea: AggregationArea;
}): React.JSX.Element | null {
  if (!schoolLayer && !communityLayer) {
    return (
      <Section header="Indicators" sub="No active indicator">
        <div style={{ fontSize: 11, color: '#a8b3bf' }}>
          Pick a school or community indicator to see how this school compares.
        </div>
      </Section>
    );
  }
  // No section-level year pill — each block carries its own so latest-mode
  // (where school and community may sit at different years) reads correctly.
  return (
    <Section header="Indicators">
      {schoolLayer ? (
        <PercentileBlock
          family="school"
          dbn={dbn}
          layer={schoolLayer}
          series={schoolSeries}
          universeDbns={universeDbns}
          aggregationArea={null}
        />
      ) : null}
      {communityLayer ? (
        <PercentileBlock
          family="community"
          dbn={dbn}
          layer={communityLayer}
          series={communitySeries}
          universeDbns={universeDbns}
          aggregationArea={aggregationArea}
        />
      ) : null}
    </Section>
  );
}

function PercentileBlock({
  family,
  dbn,
  layer,
  series,
  universeDbns,
  aggregationArea,
}: {
  family: 'school' | 'community';
  dbn: string;
  layer: LayerState;
  series: AnalyticsSeriesRow[] | null;
  universeDbns: Set<string>;
  aggregationArea: AggregationArea | null;
}): React.JSX.Element {
  const accent = family === 'school' ? SCHOOL_ACCENT : COMMUNITY_ACCENT;
  const indicator = layer.indicator;
  const familyTag = family === 'school' ? 'School' : 'Community';
  const areaLabel =
    family === 'community'
      ? aggregationArea === 'school_district'
        ? '· District avg'
        : '· NTA avg'
      : '';

  if (layer.noData) {
    return (
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 10, color: '#467c9d', letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 600 }}>
          {familyTag} · {indicator.short_label ?? indicator.label} {areaLabel}
        </div>
        <div
          style={{
            marginTop: 4,
            padding: 8,
            border: '1px solid #f3c89a',
            background: '#fff1e3',
            color: '#9a4a08',
            borderRadius: 4,
            fontSize: 11,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span aria-hidden>🗓️</span>
          <span>No data for the selected year.</span>
        </div>
      </div>
    );
  }

  const result: PercentileResult | null = series && layer.cohortYear
    ? computePercentile({
        series,
        year: layer.cohortYear,
        universeDbns,
        selectedDbn: dbn,
        goodDirection: indicator.scale.good_direction,
      })
    : null;

  const fmt = formatterFor(indicator.format);

  return (
    <div style={{ marginTop: 6 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 10, color: '#467c9d', letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 600 }}>
          {familyTag} · {indicator.short_label ?? indicator.label}
          {areaLabel ? <span style={{ color: '#a8b3bf' }}> {areaLabel}</span> : null}
        </span>
        {layer.displayYear ? <YearPill year={layer.displayYear} tone="analytics" /> : null}
      </div>
      {/* Self-value headline */}
      <div style={{ fontSize: 18, fontWeight: 700, color: '#002040', lineHeight: 1.1, marginTop: 2 }}>
        {result?.selfValue != null ? fmt(result.selfValue) : '—'}
      </div>
      {result ? (
        <StripPlot result={result} accent={accent} format={fmt} />
      ) : (
        <div style={{ fontSize: 11, color: '#a8b3bf', padding: '6px 0' }}>Loading…</div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* §1.b Profile (slider-independent, latest year per the profile endpoint)    */
/* ========================================================================== */

function ProfileSection({ profile }: { profile: SchoolProfile | null }): React.JSX.Element {
  if (!profile) {
    return (
      <Section header="School profile">
        <div style={{ fontSize: 11, color: '#a8b3bf' }}>Loading…</div>
      </Section>
    );
  }
  if (profile.profile_year == null) {
    return (
      <Section header="School profile" sub="No demographic data on file">
        <div style={{ fontSize: 11, color: '#a8b3bf' }}>
          The schools_master CSV doesn't carry demographics for this DBN.
        </div>
      </Section>
    );
  }
  return (
    <Section header="School profile" yearPill={profile.profile_year} pillTone="profile">
      {/* 4 metrics on one row — enrollment + the three need indicators.
       *  ENI was redundant with % poverty for at-a-glance reading. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
        }}
      >
        <MetricCell label="Enrollment" value={profile.total_enrollment} format="integer" />
        <MetricCell label="% Poverty" value={profile.pct_poverty} format="percent" />
        <MetricCell
          label="% ELL"
          value={profile.pct_english_language_learners}
          format="percent"
        />
        <MetricCell
          label="% Disabled"
          value={profile.pct_students_with_disabilities}
          format="percent"
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <SubHeader>Race / ethnicity</SubHeader>
        <RaceBar profile={profile} />
      </div>
    </Section>
  );
}

function RaceBar({ profile }: { profile: SchoolProfile }): React.JSX.Element {
  const slices: Array<{ label: string; pct: number | null; color: string }> = [
    { label: 'Hispanic', pct: profile.pct_hispanic, color: '#f0901f' },
    { label: 'Black', pct: profile.pct_black, color: '#467c9d' },
    { label: 'Asian', pct: profile.pct_asian, color: '#a0b000' },
    { label: 'White', pct: profile.pct_white, color: '#903090' },
    { label: 'Multi-racial', pct: profile.pct_multi_racial, color: '#00a0b0' },
  ];
  const total = slices.reduce((s, x) => s + (x.pct ?? 0), 0);
  // Some rows can report >100 (rounding) or <100 (suppressed); we normalize
  // visually so the bar always fills exactly. Real values stay in the labels.
  const norm = total > 0 ? 100 / total : 0;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          height: 14,
          borderRadius: 3,
          overflow: 'hidden',
          border: '1px solid #dde4ea',
          background: '#eef2f6',
        }}
      >
        {slices.map((s) =>
          s.pct == null ? null : (
            <div
              key={s.label}
              title={`${s.label}: ${s.pct.toFixed(1)}%`}
              style={{
                width: `${(s.pct ?? 0) * norm}%`,
                background: s.color,
              }}
            />
          ),
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
        {slices.map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
            <span
              aria-hidden
              style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }}
            />
            <span style={{ color: '#002040' }}>{s.label}</span>
            <span style={{ color: '#a8b3bf' }}>
              {s.pct == null ? '—' : `${s.pct.toFixed(1)}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Arts Education (between §1.b and §1.c — applies to ALL schools)            */
/* ========================================================================== */

function ArtsEdSection({ artsEd }: { artsEd: SchoolArtsEd | null }): React.JSX.Element {
  if (artsEd == null) {
    return (
      <Section header="Arts education">
        <div style={{ fontSize: 11, color: '#a8b3bf' }}>Loading…</div>
      </Section>
    );
  }
  if (artsEd.year == null || artsEd.disciplines.length === 0) {
    return (
      <Section header="Arts education" sub="No arts education data on file">
        <div style={{ fontSize: 11, color: '#a8b3bf' }}>
          The DOE Arts in Schools report doesn't list disciplines for this school.
        </div>
      </Section>
    );
  }
  return (
    <Section header="Arts education" yearPill={artsEd.year} pillTone="profile">
      <SubHeader>Disciplines taught</SubHeader>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {artsEd.disciplines.map((d) => (
          <DisciplineChip key={d} label={d} />
        ))}
      </div>
    </Section>
  );
}

function DisciplineChip({ label }: { label: string }): React.JSX.Element {
  return (
    <span
      style={{
        fontSize: 11,
        padding: '3px 8px',
        borderRadius: 999,
        background: '#eef4f8',
        color: '#1a4a73',
        border: '1px solid #cbd9e3',
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

/* ========================================================================== */
/* §1.c PWC program detail (PWC schools only)                                 */
/* ========================================================================== */

function ProgramSection({
  program,
  sliderYear,
}: {
  program: PwcProgram | null;
  sliderYear: string;
}): React.JSX.Element | null {
  // Spec rule: hide §1.c entirely for non-PWC schools.
  if (!program) return null;

  if (!program.active) {
    return (
      <Section header="PWC programs" yearPill={sliderYear} pillTone="program">
        <div style={{ fontSize: 11, color: '#a8b3bf' }}>
          No active PWC programs in {sliderYear}.
        </div>
      </Section>
    );
  }

  return (
    <Section header="PWC programs" yearPill={program.year} pillTone="program">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <CategoryBadge category={program.category} cohort={program.cohort} />

        {/* All three program-detail rows always render so the user sees the
         *  full dimension set; an em-dash means "no detail recorded for this
         *  school×year in pwc_schools.csv". */}
        <Row label="Community school" value={emptyToDash(program.community_school_program_status)} />
        <Row label="Arts program" value={emptyToDash(program.arts_program_type)} />
        <Row label="OST program" value={emptyToDash(program.ost_program_type)} />

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          <BooleanChip label="Food pantry" on={program.food_pantry} />
          <BooleanChip label="Laundry" on={program.laundry} />
        </div>
      </div>
    </Section>
  );
}

function emptyToDash(v: string | null): string {
  if (v == null) return '—';
  const t = v.trim();
  return t.length === 0 ? '—' : t;
}

function CategoryBadge({
  category,
  cohort,
}: {
  category: PwcProgram['category'];
  cohort: string | null;
}): React.JSX.Element {
  // Anchor-wins: both-category schools render as Anchor (purple star on the
  // map, "Anchor" label here). The both → Anchor fold matches the symbology.
  const groupLabel =
    category === 'anchor' || category === 'both'
      ? 'Anchor'
      : category === 'healing_arts'
        ? 'Healing Arts'
        : category === 'pwc_other'
          ? 'PWC (other program)'
          : '—';
  const accent =
    category === 'anchor' || category === 'both'
      ? '#903090' // magenta
      : category === 'healing_arts'
        ? '#A0B000' // PWC green (Healing Arts)
        : '#027BC0'; // PWC blue (other program)
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        background: 'white',
        border: `1px solid ${accent}`,
        borderRadius: 4,
        padding: '6px 10px',
        gap: 1,
        alignSelf: 'flex-start',
      }}
    >
      <span style={{ fontSize: 10, color: accent, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        PWC group
      </span>
      <span style={{ fontSize: 13, color: '#002040', fontWeight: 600 }}>{groupLabel}</span>
      {cohort ? (
        <span style={{ fontSize: 11, color: '#467c9d' }}>Cohort · {cohort}</span>
      ) : null}
    </div>
  );
}

function BooleanChip({ label, on }: { label: string; on: boolean | null }): React.JSX.Element {
  const active = on === true;
  return (
    <span
      style={{
        fontSize: 11,
        padding: '3px 8px',
        borderRadius: 999,
        background: active ? '#eef4f8' : '#f5f7fa',
        color: active ? '#1a4a73' : '#a8b3bf',
        border: `1px solid ${active ? '#cbd9e3' : '#dde4ea'}`,
        fontWeight: active ? 600 : 400,
      }}
    >
      {active ? '✓ ' : '○ '}
      {label}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, alignItems: 'baseline' }}>
      <span style={{ fontSize: 10, color: '#467c9d', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: 12, color: '#002040' }}>{value}</span>
    </div>
  );
}

/* ========================================================================== */
/* Layout primitives                                                          */
/* ========================================================================== */

function Section({
  header,
  yearPill,
  pillTone,
  sub,
  children,
}: {
  header: string;
  yearPill?: string;
  /** Visual tone of the pill — picks a hue that hints at "this is the slider"
   *  vs "this is latest-year" vs "this is the program panel year". */
  pillTone?: 'analytics' | 'profile' | 'program';
  sub?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            color: '#002040',
          }}
        >
          {header}
        </span>
        {yearPill ? <YearPill year={yearPill} tone={pillTone ?? 'analytics'} /> : null}
        {sub ? (
          <span style={{ fontSize: 10, color: '#a8b3bf', marginLeft: 'auto' }}>{sub}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function YearPill({
  year,
  tone,
}: {
  year: string;
  tone: 'analytics' | 'profile' | 'program';
}): React.JSX.Element {
  // analytics = blue (slider-driven); profile = grey (latest-year); program
  // = magenta (PWC tone). Different tones make the "may differ" rule obvious.
  const palette: Record<typeof tone, React.CSSProperties> = {
    analytics: { background: '#eef4f8', color: '#1a4a73', border: '1px solid #cbd9e3' },
    profile: { background: '#f5f7fa', color: '#467c9d', border: '1px solid #dde4ea' },
    program: { background: '#f6ecf6', color: '#702770', border: '1px solid #d9b7d9' },
  };
  const style: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    padding: '1px 6px',
    borderRadius: 999,
    ...palette[tone],
  };
  return <span style={style}>{year}</span>;
}

function SubHeader({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
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
      {children}
    </div>
  );
}

function MetricCell({
  label,
  value,
  format,
}: {
  label: string;
  value: number | null;
  format: Format;
}): React.JSX.Element {
  const fmt = formatterFor(format);
  return (
    <div>
      <div style={{ fontSize: 10, color: '#467c9d', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#002040' }}>
        {value == null ? '—' : fmt(value)}
      </div>
    </div>
  );
}

function formatterFor(format: Format): (v: number) => string {
  switch (format) {
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

