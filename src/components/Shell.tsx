'use client';

import { useEffect, useMemo, useState } from 'react';

import HeaderBar from './HeaderBar';
import LeftPanel from './LeftPanel';
import Logo from './Logo';
import MapView from './MapView';
import SchoolDetailsStub from './SchoolDetailsStub';
import {
  fetchCommunityValues,
  fetchGeographies,
  fetchGeoSelection,
  fetchIndicators,
  fetchPwcMembership,
  fetchSchoolFeatures,
  fetchSchoolsMaster,
  fetchTractGeoJsonUrl,
} from '../contract/client';
import type {
  CommunityResponse,
  GeographiesResponse,
  GeoSelectionResponse,
  IndicatorPublic,
  PwcMember,
  SchoolFeature,
  SchoolMaster,
  SchoolsResponse,
} from '../contract/types';
import { useHubStore } from '../store/useHubStore';
import { applyFilters, type FilteredUniverse } from '../store/derived';
import { isSliderYear, toCommunityYear, type SliderYear } from '../contract/year';

interface InitialProps {
  initialIndicators: IndicatorPublic[];
}

const KNOWN_COHORTS = ['Brownsville', 'East Harlem', 'Fort Greene', 'Morrisania'] as const;

/**
 * App shell. Layout:
 *   ┌───────────┬───────────────────────────────┐
 *   │  LEFT     │  HEADER (Phase 3)             │
 *   │  PANEL    ├───────────────────────────────┤
 *   │           │  MAP                          │
 *   └───────────┴───────────────────────────────┘
 *
 * Right panel (KPI / list / timeline) ships in Phase 5; until then the map
 * fills the remaining width of the right column.
 */
export default function Shell({ initialIndicators }: InitialProps): React.JSX.Element {
  const [indicators, setIndicators] = useState<IndicatorPublic[]>(initialIndicators);
  const [tractUrl, setTractUrl] = useState<string | null>(null);
  const [schoolData, setSchoolData] = useState<SchoolsResponse | null>(null);
  const [communityData, setCommunityData] = useState<CommunityResponse | null>(null);
  const [pwcMembers, setPwcMembers] = useState<PwcMember[] | null>(null);
  const [schoolsMaster, setSchoolsMaster] = useState<SchoolMaster[] | null>(null);
  const [geographies, setGeographies] = useState<GeographiesResponse | null>(null);
  const [geoSelection, setGeoSelection] = useState<GeoSelectionResponse | null>(null);

  const schoolId = useHubStore((s) => s.activeSchoolIndicator);
  const communityId = useHubStore((s) => s.activeCommunityIndicator);
  const year = useHubStore((s) => s.year);
  const schoolType = useHubStore((s) => s.schoolType);
  const geoFilters = useHubStore((s) => s.geoFilters);
  const cohort = useHubStore((s) => s.cohort);
  const selectedSchoolDbn = useHubStore((s) => s.selectedSchoolDbn);
  const setYear = useHubStore((s) => s.setYear);
  const setSelectedSchool = useHubStore((s) => s.setSelectedSchool);

  // One-shot fetches.
  useEffect(() => {
    fetchIndicators()
      .then((r) => setIndicators(r.indicators))
      .catch((err) => console.warn('[Shell] indicators fetch failed', err));
    fetchTractGeoJsonUrl()
      .then(setTractUrl)
      .catch((err) => console.warn('[Shell] tract URL fetch failed', err));
    fetchSchoolsMaster()
      .then((r) => setSchoolsMaster(r.schools))
      .catch((err) => console.warn('[Shell] schools-master fetch failed', err));
    fetchGeographies()
      .then(setGeographies)
      .catch((err) => console.warn('[Shell] geographies fetch failed', err));
  }, []);

  // Hydrate ?year= from URL once on mount. Preserves shareable links and the
  // Phase 1 missing-year acceptance test (?year=2019-20 forces a 🗓️ branch
  // — though now only inside the slider's valid range).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const y = params.get('year');
    if (y && isSliderYear(y)) setYear(y as SliderYear);
  }, [setYear]);

  const schoolIndicator = indicators.find((i) => i.id === schoolId) ?? null;
  const communityIndicator = indicators.find((i) => i.id === communityId) ?? null;

  // Independent per-layer year resolution (acceptance test #3): each layer
  // either has data for the chosen year or shows 🗓️ — without breaking the
  // other layer.
  const schoolYear = schoolIndicator && schoolIndicator.years.includes(year) ? year : null;
  const communityCalYear = toCommunityYear(year);
  const communityYear =
    communityIndicator && communityCalYear && communityIndicator.years.includes(communityCalYear)
      ? communityCalYear
      : null;

  // School + PWC + Community fetches (unchanged from Phase 2).
  useEffect(() => {
    if (!schoolIndicator || !schoolYear) {
      setSchoolData(null);
      return;
    }
    let abandoned = false;
    fetchSchoolFeatures(schoolIndicator.id, schoolYear)
      .then((r) => !abandoned && setSchoolData(r))
      .catch((err) => {
        if (!abandoned) {
          console.warn('[Shell] school fetch failed', err);
          setSchoolData(null);
        }
      });
    return () => {
      abandoned = true;
    };
  }, [schoolIndicator, schoolYear]);

  useEffect(() => {
    if (!schoolYear) {
      setPwcMembers(null);
      return;
    }
    let abandoned = false;
    fetchPwcMembership(schoolYear)
      .then((r) => !abandoned && setPwcMembers(r.members))
      .catch((err) => {
        if (!abandoned) {
          console.warn('[Shell] pwc fetch failed', err);
          setPwcMembers(null);
        }
      });
    return () => {
      abandoned = true;
    };
  }, [schoolYear]);

  useEffect(() => {
    if (!communityIndicator || !communityYear) {
      setCommunityData(null);
      return;
    }
    let abandoned = false;
    fetchCommunityValues(communityIndicator.id, communityYear)
      .then((r) => !abandoned && setCommunityData(r))
      .catch((err) => {
        if (!abandoned) {
          console.warn('[Shell] community fetch failed', err);
          setCommunityData(null);
        }
      });
    return () => {
      abandoned = true;
    };
  }, [communityIndicator, communityYear]);

  // Fetch the polygons of the currently-selected Geo filters so MapView can
  // outline them. Empty selection → resolve immediately to an empty FC and
  // skip the server round-trip (handled inside fetchGeoSelection).
  useEffect(() => {
    let abandoned = false;
    fetchGeoSelection(geoFilters)
      .then((r) => !abandoned && setGeoSelection(r))
      .catch((err) => {
        if (!abandoned) {
          console.warn('[Shell] geo selection fetch failed', err);
          setGeoSelection(null);
        }
      });
    return () => {
      abandoned = true;
    };
  }, [geoFilters]);

  // Merge PWC flags into school features (unchanged from Phase 2).
  const enrichedSchoolData: SchoolsResponse | null = useMemo(() => {
    if (!schoolData) return null;
    if (!pwcMembers || pwcMembers.length === 0) {
      return { ...schoolData, features: schoolData.features.map(stripPwcFlags) };
    }
    const byDbn = new Map(pwcMembers.map((m) => [m.dbn, m]));
    const features: SchoolFeature[] = schoolData.features.map((f) => {
      const m = byDbn.get(f.properties.dbn);
      if (!m) return stripPwcFlags(f);
      const isAnchor = m.category === 'anchor' || m.category === 'both';
      const isArts = m.category === 'healing_arts' || m.category === 'both';
      const pwcOther = m.category === 'pwc_other';
      return {
        ...f,
        properties: {
          ...f.properties,
          is_pwc: true,
          is_anchor: isAnchor,
          is_arts: isArts,
          pwc_other: pwcOther,
          pwc_category: m.category,
          pwc_cohort: m.cohort,
        },
      };
    });
    return { ...schoolData, features };
  }, [schoolData, pwcMembers]);

  /* -------------------- Filtered universe (Phase 3) -------------------- */
  // Discovered cohorts: union of `KNOWN_COHORTS` and whatever appears in the
  // current PWC membership snapshot. Drives the cohort dropdown options.
  const allCohorts = useMemo(() => {
    const set = new Set<string>(KNOWN_COHORTS);
    for (const m of pwcMembers ?? []) if (m.cohort) set.add(m.cohort);
    return [...set].sort();
  }, [pwcMembers]);

  const universe: FilteredUniverse = useMemo(() => {
    return applyFilters({
      state: { geoFilters, schoolType, cohort },
      schoolsMaster: schoolsMaster ?? [],
      pwcMembers: pwcMembers ?? [],
      allCohorts,
    });
  }, [geoFilters, schoolType, cohort, schoolsMaster, pwcMembers, allCohorts]);

  /* -------------------- Selected school + flyTo -------------------- */
  const selectedSchoolCoords = useMemo(() => {
    if (!selectedSchoolDbn || !enrichedSchoolData) return null;
    const f = enrichedSchoolData.features.find((x) => x.properties.dbn === selectedSchoolDbn);
    return f ? f.geometry.coordinates : null;
  }, [selectedSchoolDbn, enrichedSchoolData]);

  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    if (selectedSchoolDbn) setDetailsOpen(true);
  }, [selectedSchoolDbn]);

  const selectedSchoolName = useMemo(() => {
    if (!selectedSchoolDbn || !schoolsMaster) return null;
    return schoolsMaster.find((s) => s.dbn === selectedSchoolDbn)?.school_name ?? null;
  }, [selectedSchoolDbn, schoolsMaster]);

  /* -------------------- No-data flags (per-layer, independent) --------------------
   * Each layer fires the 🗓️ branch ONLY when:
   *  (a) its indicator is active, and
   *  (b) the selected slider year doesn't map to a year the indicator has,
   *      OR the API returned zero features for that year.
   * The independence is what keeps the OTHER layer rendering — acceptance test #3.
   */
  const schoolNoData = Boolean(
    schoolIndicator &&
      (schoolYear == null || (schoolData ? schoolData.features.length === 0 : false)),
  );
  const communityNoData = Boolean(
    communityIndicator &&
      (communityYear == null || (communityData ? Object.keys(communityData.values).length === 0 : false)),
  );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '260px 1fr',
        height: '100dvh',
        width: '100vw',
        background: '#fff',
      }}
    >
      <LeftPanel
        indicators={indicators}
        sliderYear={year}
        schoolIndicator={schoolIndicator}
        schoolYear={schoolYear}
        schoolDomain={schoolData?.domain ?? null}
        schoolNoData={schoolNoData}
        communityIndicator={communityIndicator}
        communityYear={communityYear}
        communityDomain={communityData?.domain ?? null}
        communityNoData={communityNoData}
      />
      <main
        style={{
          display: 'grid',
          gridTemplateRows: 'auto 1fr',
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <HeaderBar
          geographies={geographies}
          schoolsMaster={schoolsMaster ?? []}
          universe={universe}
        />
        <div style={{ position: 'relative', minHeight: 0 }}>
          <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 2 }}>
            <Logo />
          </div>
          <MapView
            schoolIndicator={schoolIndicator}
            schoolPoints={schoolNoData ? null : enrichedSchoolData}
            communityIndicator={communityIndicator}
            communityValues={communityNoData ? null : communityData}
            tractGeoJsonUrl={tractUrl}
            schoolType={schoolType}
            filteredSchoolDbns={universe.schoolDbns}
            flyToCoords={selectedSchoolCoords}
            geoSelection={geoSelection}
          />
        </div>
      </main>

      <SchoolDetailsStub
        open={detailsOpen && selectedSchoolDbn != null}
        dbn={selectedSchoolDbn}
        schoolName={selectedSchoolName}
        onClose={() => {
          setDetailsOpen(false);
          setSelectedSchool(null);
        }}
      />
    </div>
  );
}

function stripPwcFlags(f: SchoolFeature): SchoolFeature {
  return {
    ...f,
    properties: {
      ...f.properties,
      is_pwc: false,
      is_anchor: false,
      is_arts: false,
      pwc_other: false,
      pwc_category: null,
      pwc_cohort: null,
    },
  };
}
