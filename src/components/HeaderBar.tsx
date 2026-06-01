'use client';

import { useMemo, useState } from 'react';
import FilterDropdown, { type DropdownOption } from './FilterDropdown';
import GeoFilterDialog from './GeoFilterDialog';
import TimeSlider from './TimeSlider';
import {
  GEO_FILTER_LAYERS,
  type GeographiesResponse,
  type GeoFilterLayerId,
  type IndicatorPublic,
  type PwcHistoryResponse,
  type PwcMember,
  type SchoolMaster,
} from '../contract/types';
import { useHubStore, type SchoolType } from '../store/useHubStore';
import type { FilteredUniverse } from '../store/derived';

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
  const selectedSchoolDbn = useHubStore((s) => s.selectedSchoolDbn);
  const setSelectedSchool = useHubStore((s) => s.setSelectedSchool);
  const latestPerLayer = useHubStore((s) => s.latestPerLayer);
  const setLatestPerLayer = useHubStore((s) => s.setLatestPerLayer);

  const [geoOpen, setGeoOpen] = useState(false);

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

  return (
    <div
      role="toolbar"
      aria-label="Filters"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid #e5e9ee',
        background: '#ffffff',
        flexWrap: 'wrap',
      }}
    >
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

      {/* School Type */}
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

      {/* Cohort */}
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

      {/* School */}
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

      {/* Reset button sits BEFORE the time slider so its appearance doesn't
       *  shift the slider's horizontal anchor. Icon-only, bright-yellow chip
       *  so it's discoverable without taking up a label's worth of space. */}
      {(Object.keys(geoFilters) as GeoFilterLayerId[]).some((k) => (geoFilters[k]?.length ?? 0) > 0) ||
      schoolType !== 'all' ||
      cohort != null ||
      selectedSchoolDbn != null ? (
        <button
          type="button"
          onClick={() => {
            clearGeoFilters();
            setSchoolType('all');
            setCohort(null);
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

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
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
