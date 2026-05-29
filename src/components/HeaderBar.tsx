'use client';

import { useMemo, useState } from 'react';
import FilterDropdown, { type DropdownOption } from './FilterDropdown';
import GeoFilterDialog from './GeoFilterDialog';
import {
  GEO_FILTER_LAYERS,
  type GeographiesResponse,
  type GeoFilterLayerId,
  type SchoolMaster,
} from '../contract/types';
import { useHubStore, type SchoolType } from '../store/useHubStore';
import type { FilteredUniverse } from '../store/derived';

interface Props {
  geographies: GeographiesResponse | null;
  schoolsMaster: SchoolMaster[];
  universe: FilteredUniverse;
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
export default function HeaderBar({ geographies, schoolsMaster, universe }: Props): React.JSX.Element {
  const geoFilters = useHubStore((s) => s.geoFilters);
  const setGeoFilters = useHubStore((s) => s.setGeoFilters);
  const clearGeoFilters = useHubStore((s) => s.clearGeoFilters);
  const schoolType = useHubStore((s) => s.schoolType);
  const setSchoolType = useHubStore((s) => s.setSchoolType);
  const cohort = useHubStore((s) => s.cohort);
  const setCohort = useHubStore((s) => s.setCohort);
  const selectedSchoolDbn = useHubStore((s) => s.selectedSchoolDbn);
  const setSelectedSchool = useHubStore((s) => s.setSelectedSchool);

  const [geoOpen, setGeoOpen] = useState(false);

  /* -------------------- Geo summary -------------------- */
  const geoSummary = useMemo(() => {
    let total = 0;
    for (const l of GEO_FILTER_LAYERS) total += geoFilters[l.id]?.length ?? 0;
    return total === 0 ? 'All' : `${total} selected`;
  }, [geoFilters]);

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
      {/* Geo */}
      <button
        type="button"
        onClick={() => setGeoOpen(true)}
        style={{
          padding: '4px 10px',
          background: geoSummary === 'All' ? '#ffffff' : '#027BC0',
          color: geoSummary === 'All' ? '#002040' : 'white',
          border: '1px solid #c5cdd6',
          borderRadius: 4,
          fontSize: 12,
          cursor: 'pointer',
          fontWeight: 500,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ opacity: 0.7, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Geo
        </span>
        <span>{geoSummary}</span>
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
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: '1px solid #c5cdd6',
            color: '#467c9d',
            borderRadius: 4,
            padding: '4px 10px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          ↺ Reset all
        </button>
      ) : null}

      <GeoFilterDialog
        open={geoOpen}
        geographies={geographies}
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
