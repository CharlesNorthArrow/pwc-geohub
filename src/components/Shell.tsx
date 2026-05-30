'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import HeaderBar from './HeaderBar';
import LeftPanel from './LeftPanel';
import MapView from './MapView';
import RightPanel from './RightPanel';
import SchoolDetailsStub from './SchoolDetailsStub';
import {
  fetchAnalyticsSeries,
  fetchCommunityValues,
  fetchGeographies,
  fetchGeoSelection,
  fetchIndicators,
  fetchPwcHistory,
  fetchPwcMembership,
  fetchSchoolFeatures,
  fetchSchoolsMaster,
  fetchTractGeoJsonUrl,
} from '../contract/client';
import type {
  AnalyticsSeriesResponse,
  AnalyticsSeriesRow,
  CommunityResponse,
  GeographiesResponse,
  GeoSelectionResponse,
  IndicatorPublic,
  PwcHistoryResponse,
  PwcMember,
  SchoolFeature,
  SchoolMaster,
  SchoolsResponse,
} from '../contract/types';
import { useHubStore } from '../store/useHubStore';
import { applyFilters, type FilteredUniverse } from '../store/derived';
import { deriveAnalytics, type Analytics } from '../store/analytics';
import {
  fromCommunityYear,
  isSliderYear,
  SLIDER_YEARS,
  toCommunityYear,
  type SliderYear,
} from '../contract/year';

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
  const [analyticsSeries, setAnalyticsSeries] = useState<AnalyticsSeriesResponse | null>(null);
  const [pwcHistory, setPwcHistory] = useState<PwcHistoryResponse | null>(null);

  const schoolId = useHubStore((s) => s.activeSchoolIndicator);
  const communityId = useHubStore((s) => s.activeCommunityIndicator);
  const year = useHubStore((s) => s.year);
  const schoolType = useHubStore((s) => s.schoolType);
  const geoFilters = useHubStore((s) => s.geoFilters);
  const cohort = useHubStore((s) => s.cohort);
  const selectedSchoolDbn = useHubStore((s) => s.selectedSchoolDbn);
  const setYear = useHubStore((s) => s.setYear);
  const setSelectedSchool = useHubStore((s) => s.setSelectedSchool);
  const aggregationArea = useHubStore((s) => s.aggregationArea);
  const rightPanelCollapsed = useHubStore((s) => s.rightPanelCollapsed);
  const setRightPanelCollapsed = useHubStore((s) => s.setRightPanelCollapsed);
  const analyticsFamilyPref = useHubStore((s) => s.analyticsFamily);
  const schoolsHidden = useHubStore((s) => s.schoolsHidden);
  const communityHidden = useHubStore((s) => s.communityHidden);

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
    fetchPwcHistory()
      .then(setPwcHistory)
      .catch((err) => console.warn('[Shell] pwc history fetch failed', err));
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

  // PWC membership follows the slider year — independent of whether a school
  // indicator is active. This lets the baseline (no-indicator) view still
  // surface PWC halos.
  useEffect(() => {
    let abandoned = false;
    fetchPwcMembership(year)
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
  }, [year]);

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

  /**
   * Baseline FC: every plottable NYC school as a unicolor point sized by
   * enrollment, with PWC halos. Used when no school indicator is selected
   * so the map is never empty — spec §6.6 + UX request "default = unicolor
   * circles of all schools, with halos".
   */
  const baselineSchoolData: SchoolsResponse | null = useMemo(() => {
    if (!schoolsMaster) return null;
    const byDbn = new Map(
      (pwcMembers ?? []).map((m) => [m.dbn, m] as const),
    );
    const features: SchoolFeature[] = schoolsMaster.map((s) => {
      const m = byDbn.get(s.dbn);
      const isAnchor = m?.category === 'anchor' || m?.category === 'both';
      const isArts = m?.category === 'healing_arts' || m?.category === 'both';
      const pwcOther = m?.category === 'pwc_other';
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.longitude, s.latitude] },
        properties: {
          dbn: s.dbn,
          school_name: s.school_name,
          total_enrollment: s.total_enrollment,
          value_num: null,
          value_text: null,
          label: null,
          is_pwc: Boolean(m),
          is_anchor: isAnchor,
          is_arts: isArts,
          pwc_other: pwcOther,
          pwc_category: m?.category ?? null,
          pwc_cohort: m?.cohort ?? null,
        },
      };
    });
    return {
      type: 'FeatureCollection',
      indicator_id: '',
      year,
      domain: null,
      features,
    };
  }, [schoolsMaster, pwcMembers, year]);

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

  /* -------------------- Phase 5 analytics series -------------------- */
  // Fetch when (active indicator, family, aggArea) changes. For community
  // indicators we re-fetch when the District ↔ NTA toggle moves.
  // When BOTH families are active, honor the user's analytics preference;
  // otherwise force the family that's actually present so the panel never
  // ends up "focused" on a family that has no indicator.
  const bothFamiliesActive = !!schoolIndicator && !!communityIndicator;
  const effectiveAnalyticsFamily: 'school' | 'community' | null = bothFamiliesActive
    ? analyticsFamilyPref
    : schoolIndicator
      ? 'school'
      : communityIndicator
        ? 'community'
        : null;
  const analyticsIndicator: IndicatorPublic | null =
    effectiveAnalyticsFamily === 'school'
      ? schoolIndicator
      : effectiveAnalyticsFamily === 'community'
        ? communityIndicator
        : null;

  // Auto-collapse the analytics panel when there's nothing to show, and
  // auto-expand it when an indicator first gets picked. Only acts on the
  // truthy↔null edges of `analyticsIndicator`, so swapping between two
  // indicators (truthy→truthy) preserves the user's manual chevron state.
  const prevAnalyticsIndicator = useRef<IndicatorPublic | null>(null);
  useEffect(() => {
    const prev = prevAnalyticsIndicator.current;
    if (!prev && analyticsIndicator) setRightPanelCollapsed(false);
    else if (prev && !analyticsIndicator) setRightPanelCollapsed(true);
    prevAnalyticsIndicator.current = analyticsIndicator;
  }, [analyticsIndicator, setRightPanelCollapsed]);

  const analyticsAggArea = analyticsIndicator?.family === 'community' ? aggregationArea : null;
  useEffect(() => {
    if (!analyticsIndicator) {
      setAnalyticsSeries(null);
      return;
    }
    let abandoned = false;
    fetchAnalyticsSeries(analyticsIndicator.id, analyticsAggArea)
      .then((r) => !abandoned && setAnalyticsSeries(r))
      .catch((err) => {
        if (!abandoned) {
          console.warn('[Shell] analytics series fetch failed', err);
          setAnalyticsSeries(null);
        }
      });
    return () => {
      abandoned = true;
    };
  }, [analyticsIndicator, analyticsAggArea]);

  /**
   * Community series rows speak calendar year ("2024"); the slider and
   * `deriveAnalytics` speak school_year ("2024-25"). Remap upfront so the
   * derivation stays family-agnostic. Rows whose calendar year falls outside
   * the slider window (e.g. "2020" → "2019-20") get dropped — those slider
   * positions don't exist anyway.
   */
  const normalizedAnalyticsSeries: AnalyticsSeriesRow[] | null = useMemo(() => {
    if (!analyticsSeries || !analyticsIndicator) return null;
    if (analyticsIndicator.family === 'school') return analyticsSeries.series;
    const out: AnalyticsSeriesRow[] = [];
    for (const r of analyticsSeries.series) {
      const sy = fromCommunityYear(r.year);
      if (!sy) continue;
      out.push({ ...r, year: sy });
    }
    return out;
  }, [analyticsSeries, analyticsIndicator]);

  /** Numeric analytics aren't computable for categorical indicators (the
   *  server averages NULL value_num). RightPanel shows a notice instead. */
  const analyticsUnavailable =
    analyticsIndicator?.scale.type === 'categorical';

  const analytics: Analytics | null = useMemo(() => {
    if (
      !analyticsIndicator ||
      !normalizedAnalyticsSeries ||
      !pwcHistory ||
      !schoolsMaster ||
      analyticsUnavailable
    )
      return null;
    return deriveAnalytics({
      indicator: analyticsIndicator,
      year,
      series: normalizedAnalyticsSeries,
      pwcByYear: pwcHistory.byYear,
      universe,
      timelineYears: SLIDER_YEARS,
    });
  }, [
    analyticsIndicator,
    normalizedAnalyticsSeries,
    pwcHistory,
    schoolsMaster,
    year,
    universe,
    analyticsUnavailable,
  ]);

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
        gridTemplateColumns: rightPanelCollapsed ? '300px 1fr 28px' : '300px 1fr minmax(224px, 28%)',
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
          pwcHistory={pwcHistory}
        />
        <div style={{ position: 'relative', minHeight: 0 }}>
          <MapView
            schoolIndicator={schoolIndicator}
            schoolPoints={
              schoolsHidden
                ? null
                : schoolIndicator
                  ? schoolNoData
                    ? null
                    : enrichedSchoolData
                  : baselineSchoolData
            }
            communityIndicator={communityIndicator}
            communityValues={
              communityHidden ? null : communityNoData ? null : communityData
            }
            tractGeoJsonUrl={tractUrl}
            schoolType={schoolType}
            filteredSchoolDbns={universe.schoolDbns}
            flyToCoords={selectedSchoolCoords}
            geoSelection={geoSelection}
          />
        </div>
      </main>

      <RightPanel
        indicator={analyticsIndicator}
        analytics={analytics}
        analyticsUnavailable={analyticsUnavailable}
        schoolsMaster={schoolsMaster ?? []}
        year={year}
        showAggregationToggle={analyticsIndicator?.family === 'community'}
        showFamilyToggle={bothFamiliesActive}
        familyToggleValue={effectiveAnalyticsFamily ?? 'school'}
        schoolIndicatorLabel={
          schoolIndicator ? (schoolIndicator.short_label ?? schoolIndicator.label) : null
        }
        communityIndicatorLabel={
          communityIndicator
            ? (communityIndicator.short_label ?? communityIndicator.label)
            : null
        }
      />

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
