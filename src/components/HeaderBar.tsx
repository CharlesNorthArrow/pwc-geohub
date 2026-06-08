'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import FilterDropdown, { type DropdownOption } from './FilterDropdown';
import GeoFilterDialog from './GeoFilterDialog';
import TimeSlider from './TimeSlider';
import {
  GEO_FILTER_LAYERS,
  PROGRAM_FLAGS,
  type GeographiesResponse,
  type GeoFilterLayerId,
  type IndicatorPublic,
  type ProgramFlag,
  type PwcHistoryResponse,
  type PwcMember,
  type SchoolMaster,
} from '../contract/types';
import { useHubStore, type SchoolType } from '../store/useHubStore';
import type { FilteredUniverse } from '../store/derived';
import { CANONICAL_GRADES } from '../lib/grades';

interface Props {
  geographies: GeographiesResponse | null;
  schoolsMaster: SchoolMaster[];
  universe: FilteredUniverse;
  pwcHistory: PwcHistoryResponse | null;
  /** Active indicators — forwarded to TimeSlider for the availability dot
   *  rows above each tick. */
  schoolIndicator: IndicatorPublic | null;
  communityIndicator: IndicatorPublic | null;
}

const SCHOOL_TYPE_OPTIONS: ReadonlyArray<{ value: SchoolType; label: string }> = [
  { value: 'all', label: 'All NYC' },
  { value: 'pwc', label: 'Only PWC' },
  { value: 'anchor', label: 'Only PWC Anchor' },
  { value: 'healing_arts', label: 'Only PWC Healing Arts' },
];

/**
 * The cascade row that sits between the panels (spec §2). Filters cascade
 * Geo → School Type → Cohort → School; every dropdown reads its options
 * from the same `applyFilters` selector so the pre-filter notes stay honest.
 */
export default function HeaderBar({
  geographies,
  schoolsMaster,
  universe,
  pwcHistory,
  schoolIndicator,
  communityIndicator,
}: Props): React.JSX.Element {
  const geoFilters = useHubStore((s) => s.geoFilters);
  const setGeoFilters = useHubStore((s) => s.setGeoFilters);
  const clearGeoFilters = useHubStore((s) => s.clearGeoFilters);
  const schoolType = useHubStore((s) => s.schoolType);
  const setSchoolType = useHubStore((s) => s.setSchoolType);
  const cohort = useHubStore((s) => s.cohort);
  const setCohort = useHubStore((s) => s.setCohort);
  const programs = useHubStore((s) => s.programs);
  const setPrograms = useHubStore((s) => s.setPrograms);
  const grades = useHubStore((s) => s.grades);
  const setGrades = useHubStore((s) => s.setGrades);
  const selectedSchoolDbn = useHubStore((s) => s.selectedSchoolDbn);
  const setSelectedSchool = useHubStore((s) => s.setSelectedSchool);
  const latestPerLayer = useHubStore((s) => s.latestPerLayer);
  const setLatestPerLayer = useHubStore((s) => s.setLatestPerLayer);

  const [geoOpen, setGeoOpen] = useState(false);

  /* -------------------- Compact mode --------------------
   * When the filter cluster gets too narrow to hold every chip side-by-side,
   * collapse the whole set into a single "Filters" popover button. Beats a
   * horizontal scroll (chips disappearing off-edge wasn't discoverable).
   * Threshold = the natural inline width of the six chips + reset; tuned by
   * eye and easy to revisit. ResizeObserver watches the cluster wrapper so
   * the switch follows left/right panel resizing too, not just window width. */
  const clusterRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = clusterRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCompact(w < 660);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* -------------------- Latest-year PWC membership -------------------- */
  // The Geo dialog shows a "Matched PWC schools (latest year)" column. Per
  // CLAUDE.md the PWC panel runs through 2025-26 (one year past public data),
  // so we pick the lexicographically max key from the history snapshot —
  // robust to whatever vintages have been ingested.
  const latestPwc: PwcMember[] = useMemo(() => {
    if (!pwcHistory) return [];
    const years = Object.keys(pwcHistory.byYear);
    if (years.length === 0) return [];
    years.sort();
    const latest = years[years.length - 1];
    return latest ? pwcHistory.byYear[latest] ?? [] : [];
  }, [pwcHistory]);
  const latestPwcYear: string | null = useMemo(() => {
    if (!pwcHistory) return null;
    const years = Object.keys(pwcHistory.byYear);
    if (years.length === 0) return null;
    years.sort();
    return years[years.length - 1] ?? null;
  }, [pwcHistory]);

  /* -------------------- Geo summary -------------------- */
  // Total pick count across all layers — drives the count badge on the Geo
  // pill (label + badge only — never a long inline summary that pushes the
  // time slider sideways).
  const geoCount = useMemo(() => {
    let total = 0;
    for (const l of GEO_FILTER_LAYERS) total += geoFilters[l.id]?.length ?? 0;
    return total;
  }, [geoFilters]);
  const geoTooltip = useMemo(() => {
    if (geoCount === 0) return 'Geographic filter';
    const parts: string[] = [];
    for (const l of GEO_FILTER_LAYERS) {
      const n = geoFilters[l.id]?.length ?? 0;
      if (n > 0) parts.push(`${l.label}: ${n}`);
    }
    return parts.join(' · ');
  }, [geoFilters, geoCount]);

  /* -------------------- School Type options ---------- */
  // Counts per option = how many schools in the Geo-filtered universe match
  // each school-type bucket. Using `afterGeo` so the counts respect upper
  // filters but reflect what the user would see if they picked this option.
  const schoolTypeOptions: DropdownOption[] = SCHOOL_TYPE_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
  }));
  const schoolTypeLabel =
    SCHOOL_TYPE_OPTIONS.find((o) => o.value === schoolType)?.label ?? 'All NYC';

  /* -------------------- Cohort options ---------------- */
  const cohortOptions: DropdownOption[] = universe.cohortOptions.map((c) => ({
    value: c.cohort,
    label: c.cohort,
    count: c.count,
  }));
  const cohortLabel = cohort ?? 'All';

  /* -------------------- Program options --------------- */
  // Counts = number of in-view schools (Geo + School Type + Cohort applied)
  // that carry each program flag for the current year's PWC snapshot.
  // Driven from `afterCohort` so the dropdown reflects what's pickable now.
  const programOptions: DropdownOption[] = useMemo(() => {
    const counts = new Map<ProgramFlag, number>();
    for (const p of PROGRAM_FLAGS) counts.set(p.id, 0);
    if (pwcHistory) {
      // Use the latest PWC year snapshot as the option-count basis. Filtering
      // itself uses the slider-year membership (via `pwcMembers` upstream),
      // so the count is a "what's typically there" rather than a per-tick
      // moving target.
      const byDbn = new Map(latestPwc.map((m) => [m.dbn, m]));
      for (const dbn of universe.afterCohort) {
        const m = byDbn.get(dbn);
        if (!m) continue;
        for (const p of PROGRAM_FLAGS) {
          if (m[p.id]) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
        }
      }
    }
    return PROGRAM_FLAGS.map((p) => ({
      value: p.id,
      label: p.label,
      count: counts.get(p.id) ?? 0,
    }));
  }, [universe.afterCohort, latestPwc, pwcHistory]);
  const programLabel =
    programs.length === 0
      ? 'All'
      : programs.length === 1
        ? (PROGRAM_FLAGS.find((p) => p.id === programs[0])?.label ?? programs[0]!)
        : `${programs.length} selected`;
  const togglePicked = <T extends string>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  /* -------------------- Grade options ----------------- */
  // Counts = in-view schools (Geo + School Type + Cohort + Program applied)
  // that serve each canonical grade. Driven from `afterProgram` so the count
  // tracks the cascade up to the Grade step.
  const gradeOptions: DropdownOption[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of CANONICAL_GRADES) counts.set(g, 0);
    const byDbn = new Map(schoolsMaster.map((s) => [s.dbn, s]));
    for (const dbn of universe.afterProgram) {
      const s = byDbn.get(dbn);
      if (!s) continue;
      for (const g of s.grades_canonical) {
        if (counts.has(g)) counts.set(g, (counts.get(g) ?? 0) + 1);
      }
    }
    return CANONICAL_GRADES.map((g) => ({
      value: g,
      label: g,
      count: counts.get(g) ?? 0,
    }));
  }, [universe.afterProgram, schoolsMaster]);
  const gradeLabel = grades.length === 0 ? 'All' : grades.join(', ');

  /* -------------------- School options ---------------- */
  // School filter: searchable, narrowed to the final filtered universe.
  // With ~1,779 schools this can be heavy — the FilterDropdown's search
  // narrows visually; we cap the option list to a sane number for perf and
  // rely on search for finding specific schools.
  const schoolOptions: DropdownOption[] = useMemo(() => {
    const out: DropdownOption[] = [];
    for (const s of schoolsMaster) {
      if (!universe.schoolDbns.has(s.dbn)) continue;
      out.push({ value: s.dbn, label: `${s.school_name ?? '(no name)'} · ${s.dbn}` });
      if (out.length >= 500) break; // soft cap; search reveals the rest
    }
    return out;
  }, [schoolsMaster, universe.schoolDbns]);
  const selectedSchoolLabel =
    selectedSchoolDbn
      ? schoolsMaster.find((s) => s.dbn === selectedSchoolDbn)?.school_name ?? selectedSchoolDbn
      : 'Any';

  /* -------------------- Active-filter count (compact badge) --------------- */
  const totalActiveFilters = useMemo(() => {
    let n = 0;
    for (const l of GEO_FILTER_LAYERS) n += geoFilters[l.id]?.length ?? 0;
    if (schoolType !== 'all') n += 1;
    if (cohort != null) n += 1;
    n += programs.length;
    n += grades.length;
    if (selectedSchoolDbn != null) n += 1;
    return n;
  }, [geoFilters, schoolType, cohort, programs, grades, selectedSchoolDbn]);

  const anyFilterActive = totalActiveFilters > 0;

  /* -------------------- Chip set (rendered inline OR inside popover) ------ */
  const chips = (
    <>
      {/* Geo — label + count badge only (no inline summary). */}
      <button
        type="button"
        onClick={() => setGeoOpen(true)}
        title={geoTooltip}
        aria-label={geoTooltip}
        style={{
          padding: '4px 10px',
          background: geoCount === 0 ? '#ffffff' : '#027BC0',
          color: geoCount === 0 ? '#002040' : 'white',
          border: '1px solid #c5cdd6',
          borderRadius: 4,
          fontSize: 12,
          cursor: 'pointer',
          fontWeight: 500,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Geo
        </span>
        {geoCount > 0 ? (
          <span
            style={{
              background: 'white',
              color: '#027BC0',
              borderRadius: 999,
              padding: '0 6px',
              fontSize: 10,
              fontWeight: 700,
              minWidth: 16,
              textAlign: 'center',
              lineHeight: '14px',
            }}
          >
            {geoCount}
          </span>
        ) : null}
        <span aria-hidden style={{ opacity: 0.6 }}>▾</span>
      </button>

      <FilterDropdown
        triggerLabel="School Type"
        selectedLabel={schoolTypeLabel}
        options={schoolTypeOptions}
        searchable={false}
        prefilterNote={universe.prefilterSummary.forSchoolType}
        isAtDefault={schoolType === 'all'}
        onReset={() => setSchoolType('all')}
        onPick={(v) => setSchoolType(v as SchoolType)}
      />

      <FilterDropdown
        triggerLabel="Cohort"
        selectedLabel={cohortLabel}
        options={cohortOptions}
        searchable
        prefilterNote={universe.prefilterSummary.forCohort}
        isAtDefault={cohort == null}
        onReset={() => setCohort(null)}
        onPick={(v) => setCohort(v)}
      />

      <FilterDropdown
        triggerLabel="Program"
        selectedLabel={programLabel}
        options={programOptions}
        searchable
        prefilterNote={universe.prefilterSummary.forProgram}
        isAtDefault={programs.length === 0}
        activeCount={programs.length}
        multiSelect
        selectedValues={programs}
        onReset={() => setPrograms([])}
        onPick={(v) => setPrograms(togglePicked(programs, v as ProgramFlag))}
      />

      <FilterDropdown
        triggerLabel="Grade"
        selectedLabel={gradeLabel}
        options={gradeOptions}
        searchable
        prefilterNote={universe.prefilterSummary.forGrade}
        isAtDefault={grades.length === 0}
        activeCount={grades.length}
        multiSelect
        selectedValues={grades}
        onReset={() => setGrades([])}
        onPick={(v) => setGrades(togglePicked(grades, v))}
      />

      <FilterDropdown
        triggerLabel="School"
        selectedLabel={selectedSchoolLabel}
        options={schoolOptions}
        searchable
        prefilterNote={universe.prefilterSummary.forSchool}
        isAtDefault={selectedSchoolDbn == null}
        onReset={() => setSelectedSchool(null)}
        onPick={(v) => setSelectedSchool(v)}
      />

      {anyFilterActive ? (
        <button
          type="button"
          onClick={() => {
            clearGeoFilters();
            setSchoolType('all');
            setCohort(null);
            setPrograms([]);
            setGrades([]);
            setSelectedSchool(null);
          }}
          title="Reset all filters"
          aria-label="Reset all filters"
          style={{
            background: '#f5c400',
            border: '1px solid #d9b000',
            color: 'white',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 13,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            minWidth: 28,
            height: 26,
            fontWeight: 700,
          }}
        >
          ↺
        </button>
      ) : null}
    </>
  );

  return (
    <div
      role="toolbar"
      aria-label="Filters"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 12px',
        // Fixed height — the header never grows with the filter row. When
        // filter chips overflow horizontally the inner scroller below
        // catches them instead of stacking onto a second line.
        height: 64,
        borderBottom: '3px solid #F0901F',
        boxShadow: '0 1px 2px rgba(0, 32, 64, 0.12)',
        background: '#ffffff',
        flexWrap: 'nowrap',
        overflow: 'hidden',
      }}
    >
      {/* Filter cluster. When narrow enough that the chips wouldn't fit
       *  side-by-side, we collapse into a single "Filters" popover button
       *  (see CompactFiltersPopover below) instead of horizontal scroll. The
       *  ResizeObserver on this wrapper drives the switch. */}
      <div
        ref={clusterRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flex: '1 1 auto',
          minWidth: 0,
        }}
      >
        {compact ? (
          <CompactFiltersPopover activeCount={totalActiveFilters}>{chips}</CompactFiltersPopover>
        ) : (
          chips
        )}
      </div>

      {/* Vertical partition between the filter cluster and the time-slider
       *  block. Subtle slate-grey line, ~half the toolbar height, with a
       *  margin so it doesn't visually touch either neighbor. */}
      <div
        aria-hidden
        style={{
          width: 1,
          height: 32,
          background: '#c5cdd6',
          flex: 'none',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        {/* "Latest" pill — when on, each layer ignores the slider and shows
         *  its own latest available year. The slider stays visible but
         *  visually dimmed so the relationship is obvious. */}
        <button
          type="button"
          onClick={() => setLatestPerLayer(!latestPerLayer)}
          aria-pressed={latestPerLayer}
          title={
            latestPerLayer
              ? 'Latest mode ON — each layer shows its own latest year'
              : 'Latest mode OFF — slider drives the year'
          }
          style={{
            padding: '4px 10px',
            background: latestPerLayer ? '#027BC0' : '#ffffff',
            color: latestPerLayer ? 'white' : '#002040',
            border: '1px solid #c5cdd6',
            borderRadius: 4,
            fontSize: 12,
            cursor: 'pointer',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {latestPerLayer ? '✓ Latest' : 'Latest'}
        </button>
        <div style={{ opacity: latestPerLayer ? 0.4 : 1, transition: 'opacity 120ms' }}>
          <TimeSlider schoolIndicator={schoolIndicator} communityIndicator={communityIndicator} />
        </div>
      </div>

      <GeoFilterDialog
        open={geoOpen}
        geographies={geographies}
        schoolsMaster={schoolsMaster}
        pwcMembers={latestPwc}
        pwcYear={latestPwcYear}
        initial={geoFilters}
        onCancel={() => setGeoOpen(false)}
        onApply={(next) => {
          setGeoFilters(next);
          setGeoOpen(false);
        }}
      />
    </div>
  );
}

/**
 * Single trigger that opens a popover containing every filter chip stacked
 * vertically — used when the toolbar is too narrow to lay chips out inline.
 *
 * Dismissal is explicit (× button or ESC). We don't close on outside-click
 * because each FilterDropdown's own panel portals to document.body, and an
 * outside-click handler that fires for clicks inside those portaled panels
 * would close the parent popover the moment the user picked anything.
 */
function CompactFiltersPopover({
  activeCount,
  children,
}: {
  activeCount: number;
  children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const update = (): void => {
      const r = rootRef.current?.getBoundingClientRect();
      if (r) setTriggerRect(r);
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const active = activeCount > 0;
  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Filters"
        aria-label="Filters"
        aria-expanded={open}
        style={{
          padding: '4px 10px',
          background: active ? '#027BC0' : '#ffffff',
          color: active ? 'white' : '#002040',
          border: '1px solid #c5cdd6',
          borderRadius: 4,
          fontSize: 12,
          cursor: 'pointer',
          fontWeight: 500,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Filters
        </span>
        {active ? (
          <span
            style={{
              background: 'white',
              color: '#027BC0',
              borderRadius: 999,
              padding: '0 6px',
              fontSize: 10,
              fontWeight: 700,
              minWidth: 16,
              textAlign: 'center',
              lineHeight: '14px',
            }}
          >
            {activeCount}
          </span>
        ) : null}
        <span aria-hidden style={{ opacity: 0.6 }}>▾</span>
      </button>

      {open && triggerRect && typeof document !== 'undefined'
        ? createPortal(
            <div
              style={{
                position: 'fixed',
                top: triggerRect.bottom + 4,
                left: triggerRect.left,
                zIndex: 1000,
                minWidth: 240,
                maxWidth: 320,
                background: 'white',
                border: '1px solid #c5cdd6',
                borderRadius: 6,
                boxShadow: '0 6px 24px rgba(0,32,64,0.15)',
                padding: 10,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                  paddingBottom: 6,
                  borderBottom: '1px solid #eef0f3',
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#002040',
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                  }}
                >
                  Filters
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close filters"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#467c9d',
                    fontSize: 16,
                    lineHeight: 1,
                    padding: 2,
                  }}
                >
                  ×
                </button>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  alignItems: 'flex-start',
                }}
              >
                {children}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
