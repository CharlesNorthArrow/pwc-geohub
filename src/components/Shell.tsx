'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import HeaderBar from './HeaderBar';
import LeftPanel from './LeftPanel';
import MapView from './MapView';
import PwcCounter from './PwcCounter';
import RightPanel from './RightPanel';
import SchoolDetailPanel from './SchoolDetailPanel';
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
  fetchTractNtaMap,
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
import { resolveActiveLayers } from '../store/activeLayers';
import {
  fromCommunityYear,
  isSliderYear,
  SLIDER_YEARS,
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
  const [tractNtaMap, setTractNtaMap] = useState<Record<string, { nta_id: string; nta_name: string }> | null>(null);
  const [schoolData, setSchoolData] = useState<SchoolsResponse | null>(null);
  const [communityData, setCommunityData] = useState<CommunityResponse | null>(null);
  const [pwcMembers, setPwcMembers] = useState<PwcMember[] | null>(null);
  const [schoolsMaster, setSchoolsMaster] = useState<SchoolMaster[] | null>(null);
  const [geographies, setGeographies] = useState<GeographiesResponse | null>(null);
  const [geoSelection, setGeoSelection] = useState<GeoSelectionResponse | null>(null);
  // Two independent analytics series — one per family. When BOTH a school and
  // a community indicator are active, both fetch in parallel so the Detail
  // Panel can render its two stacked percentile strips simultaneously.
  const [schoolSeries, setSchoolSeries] = useState<AnalyticsSeriesResponse | null>(null);
  const [communitySeries, setCommunitySeries] = useState<AnalyticsSeriesResponse | null>(null);
  const [pwcHistory, setPwcHistory] = useState<PwcHistoryResponse | null>(null);

  const schoolId = useHubStore((s) => s.activeSchoolIndicator);
  const communityId = useHubStore((s) => s.activeCommunityIndicator);
  const year = useHubStore((s) => s.year);
  const schoolType = useHubStore((s) => s.schoolType);
  const geoFilters = useHubStore((s) => s.geoFilters);
  const cohort = useHubStore((s) => s.cohort);
  const programs = useHubStore((s) => s.programs);
  const grades = useHubStore((s) => s.grades);
  const selectedSchoolDbn = useHubStore((s) => s.selectedSchoolDbn);
  const setYear = useHubStore((s) => s.setYear);
  const setSelectedSchool = useHubStore((s) => s.setSelectedSchool);
  const aggregationArea = useHubStore((s) => s.aggregationArea);
  const rightPanelCollapsed = useHubStore((s) => s.rightPanelCollapsed);
  const setRightPanelCollapsed = useHubStore((s) => s.setRightPanelCollapsed);
  const analyticsFamilyPref = useHubStore((s) => s.analyticsFamily);
  const schoolsHidden = useHubStore((s) => s.schoolsHidden);
  const communityHidden = useHubStore((s) => s.communityHidden);
  const pwcHalosVisible = useHubStore((s) => s.pwcHalosVisible);
  const latestPerLayer = useHubStore((s) => s.latestPerLayer);

  // One-shot fetches.
  useEffect(() => {
    fetchIndicators()
      .then((r) => setIndicators(r.indicators))
      .catch((err) => console.warn('[Shell] indicators fetch failed', err));
    fetchTractGeoJsonUrl()
      .then(setTractUrl)
      .catch((err) => console.warn('[Shell] tract URL fetch failed', err));
    fetchTractNtaMap()
      .then((r) => setTractNtaMap(r.tracts))
      .catch((err) => console.warn('[Shell] tract-NTA fetch failed', err));
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

  const schoolIndicatorPick = indicators.find((i) => i.id === schoolId) ?? null;
  const communityIndicatorPick = indicators.find((i) => i.id === communityId) ?? null;

  /**
   * Single source for "what's active + what year is each layer showing + is
   * each layer in the missing-year branch?" — see `store/activeLayers.ts`.
   * Per-layer independence is the §6.6 acceptance test #3 contract.
   */
  const layers = useMemo(
    () =>
      resolveActiveLayers({
        schoolIndicator: schoolIndicatorPick,
        communityIndicator: communityIndicatorPick,
        sliderYear: year,
        analyticsFamilyPref,
        schoolFeatureCount: schoolData ? schoolData.features.length : null,
        communityValueCount: communityData ? Object.keys(communityData.values).length : null,
        latestPerLayer,
      }),
    [
      schoolIndicatorPick,
      communityIndicatorPick,
      year,
      analyticsFamilyPref,
      schoolData,
      communityData,
      latestPerLayer,
    ],
  );

  const schoolIndicator = layers.school?.indicator ?? null;
  const communityIndicator = layers.community?.indicator ?? null;
  const schoolYear = layers.school?.displayYear ?? null;
  const communityYear = layers.community?.displayYear ?? null;

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
      // Anchor-wins: both-category schools render as Anchor only (purple star).
      // Pure Healing-Arts schools render as a green diamond. The contract still
      // emits 'both' as a category, but the visual buckets are disjoint here.
      const isAnchor = m.category === 'anchor' || m.category === 'both';
      const isArts = m.category === 'healing_arts';
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
      const isArts = m?.category === 'healing_arts';
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
      state: { geoFilters, schoolType, cohort, programs, grades },
      schoolsMaster: schoolsMaster ?? [],
      pwcMembers: pwcMembers ?? [],
      allCohorts,
    });
  }, [geoFilters, schoolType, cohort, programs, grades, schoolsMaster, pwcMembers, allCohorts]);

  /* -------------------- Phase 5 analytics series -------------------- */
  // `layers.analytics` already encodes the family-preference fallback when
  // only one family is active. `layers.bothFamiliesActive` drives the toggle.
  const bothFamiliesActive = layers.bothFamiliesActive;
  const effectiveAnalyticsFamily: 'school' | 'community' | null = layers.analytics?.family ?? null;
  const analyticsIndicator: IndicatorPublic | null = layers.analytics?.indicator ?? null;

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

  // Independent per-family fetches. The school series doesn't depend on
  // `aggregationArea`; the community one does (the District ↔ NTA toggle
  // chooses which crosswalk drives the per-school aggregation upstream).
  useEffect(() => {
    if (!schoolIndicator) {
      setSchoolSeries(null);
      return;
    }
    let abandoned = false;
    fetchAnalyticsSeries(schoolIndicator.id, null)
      .then((r) => !abandoned && setSchoolSeries(r))
      .catch((err) => {
        if (!abandoned) {
          console.warn('[Shell] school analytics series fetch failed', err);
          setSchoolSeries(null);
        }
      });
    return () => {
      abandoned = true;
    };
  }, [schoolIndicator]);

  useEffect(() => {
    if (!communityIndicator) {
      setCommunitySeries(null);
      return;
    }
    let abandoned = false;
    fetchAnalyticsSeries(communityIndicator.id, aggregationArea)
      .then((r) => !abandoned && setCommunitySeries(r))
      .catch((err) => {
        if (!abandoned) {
          console.warn('[Shell] community analytics series fetch failed', err);
          setCommunitySeries(null);
        }
      });
    return () => {
      abandoned = true;
    };
  }, [communityIndicator, aggregationArea]);

  /**
   * Community series rows speak calendar year ("2024"); the slider and
   * `deriveAnalytics` speak school_year ("2024-25"). Remap upfront so the
   * derivation stays family-agnostic. Rows whose calendar year falls outside
   * the slider window (e.g. "2020" → "2019-20") get dropped — those slider
   * positions don't exist anyway.
   */
  const schoolNormalizedSeries: AnalyticsSeriesRow[] | null = useMemo(
    () => schoolSeries?.series ?? null,
    [schoolSeries],
  );
  const communityNormalizedSeries: AnalyticsSeriesRow[] | null = useMemo(() => {
    if (!communitySeries) return null;
    const out: AnalyticsSeriesRow[] = [];
    for (const r of communitySeries.series) {
      const sy = fromCommunityYear(r.year);
      if (!sy) continue;
      out.push({ ...r, year: sy });
    }
    return out;
  }, [communitySeries]);

  /** Numeric analytics aren't computable for categorical indicators (the
   *  server averages NULL value_num). RightPanel shows a notice instead. */
  const analyticsUnavailable =
    analyticsIndicator?.scale.type === 'categorical';

  // Pick the series matching the right panel's focused family.
  const focusedNormalizedSeries: AnalyticsSeriesRow[] | null =
    effectiveAnalyticsFamily === 'school'
      ? schoolNormalizedSeries
      : effectiveAnalyticsFamily === 'community'
        ? communityNormalizedSeries
        : null;

  /**
   * Year the analytics panel computes its KPIs / timeline marker / ranked
   * list AT. In normal mode this is the slider year; in Latest mode it's
   * the focused family's OWN latest registry year (so toggling Latest on
   * makes the right panel snap each indicator to its freshest year, not
   * just the map). Falls back to the slider year when no family is active.
   */
  const focusedLayerState =
    effectiveAnalyticsFamily === 'school'
      ? layers.school
      : effectiveAnalyticsFamily === 'community'
        ? layers.community
        : null;
  const analyticsYear: SliderYear = focusedLayerState?.cohortYear ?? year;

  const analytics: Analytics | null = useMemo(() => {
    if (
      !analyticsIndicator ||
      !focusedNormalizedSeries ||
      !pwcHistory ||
      !schoolsMaster ||
      analyticsUnavailable
    )
      return null;
    return deriveAnalytics({
      indicator: analyticsIndicator,
      year: analyticsYear,
      series: focusedNormalizedSeries,
      pwcByYear: pwcHistory.byYear,
      universe,
      timelineYears: SLIDER_YEARS,
      // Membership stays anchored to the slider year — that's the year
      // `universe` (and `pwcMembers`) was built from. In Latest-mode the
      // KPI lookup year (`analyticsYear`) can drift to the focused family's
      // own latest, but the PWC roll-up must keep using the slider-year
      // roster or "PWC schools" diverges from "All in view" under Only-PWC.
      pwcMembershipYear: year,
    });
  }, [
    analyticsIndicator,
    focusedNormalizedSeries,
    pwcHistory,
    schoolsMaster,
    analyticsYear,
    universe,
    analyticsUnavailable,
    year,
  ]);

  /* -------------------- Selected school + flyTo -------------------- */
  // Prefer coords from schoolsMaster so the Detail Panel opens reliably even
  // when no school indicator is active (and `enrichedSchoolData` is null).
  // Falls back to the rendered feature when present. Returns null for
  // unplottable schools — Detail Panel then skips the zoom and shows the
  // "not shown on map" note.
  const selectedSchoolCoords = useMemo<[number, number] | null>(() => {
    if (!selectedSchoolDbn) return null;
    const s = schoolsMaster?.find((x) => x.dbn === selectedSchoolDbn);
    if (s && s.longitude != null && s.latitude != null) {
      return [s.longitude, s.latitude];
    }
    if (enrichedSchoolData) {
      const f = enrichedSchoolData.features.find((x) => x.properties.dbn === selectedSchoolDbn);
      if (f) return [f.geometry.coordinates[0], f.geometry.coordinates[1]];
    }
    return null;
  }, [selectedSchoolDbn, schoolsMaster, enrichedSchoolData]);

  // Capture/restore map state across the Detail Panel lifecycle.
  // `lastMapViewRef` tracks the latest camera reported by MapView's idle
  // listener. `priorMapStateRef` snapshots {view, rightPanelCollapsed} at
  // the moment the panel opens; restored on close.
  const lastMapViewRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const priorMapStateRef = useRef<{
    view: { center: [number, number]; zoom: number } | null;
    rightPanelCollapsed: boolean;
  } | null>(null);
  const [flyToView, setFlyToView] = useState<{ center: [number, number]; zoom: number } | null>(null);

  /* -------------------- Cohort selection → fitBounds -------------------- */
  // When the user picks a cohort, fit the map to the bbox of the cohort's
  // schools so they're framed in view. Triggers on the cohort transition
  // (null → cohort or cohortA → cohortB); clearing back to null leaves the
  // current camera untouched. Bbox is computed against the filtered universe
  // (which already encodes Geo + School Type + Cohort), so e.g. picking
  // "Brownsville" while School Type is "Anchor" zooms to Anchor schools in
  // Brownsville rather than every cohort school.
  const [flyToBbox, setFlyToBbox] = useState<[number, number, number, number] | null>(null);
  const prevCohortRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevCohortRef.current;
    prevCohortRef.current = cohort;
    if (!cohort || cohort === prev) return;
    if (!schoolsMaster) return;
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    let touched = false;
    for (const sm of schoolsMaster) {
      if (!universe.schoolDbns.has(sm.dbn)) continue;
      if (sm.longitude == null || sm.latitude == null) continue;
      if (sm.longitude < w) w = sm.longitude;
      if (sm.longitude > e) e = sm.longitude;
      if (sm.latitude < s) s = sm.latitude;
      if (sm.latitude > n) n = sm.latitude;
      touched = true;
    }
    if (touched) setFlyToBbox([w, s, e, n]);
  }, [cohort, schoolsMaster, universe.schoolDbns]);

  // One-shot — clear after MapView consumes it so pan/zoom isn't sticky.
  useEffect(() => {
    if (!flyToBbox) return;
    const id = window.setTimeout(() => setFlyToBbox(null), 100);
    return () => window.clearTimeout(id);
  }, [flyToBbox]);

  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSelectedRef.current;
    if (!prev && selectedSchoolDbn) {
      // OPEN edge: snapshot what was on screen before the panel takes over.
      priorMapStateRef.current = {
        view: lastMapViewRef.current,
        rightPanelCollapsed,
      };
      // Force the right column open so the Detail Panel is visible.
      if (rightPanelCollapsed) setRightPanelCollapsed(false);
    }
    prevSelectedRef.current = selectedSchoolDbn;
  }, [selectedSchoolDbn, rightPanelCollapsed, setRightPanelCollapsed]);

  const handleDetailClose = useCallback((): void => {
    const prior = priorMapStateRef.current;
    if (prior) {
      if (prior.view) setFlyToView(prior.view);
      setRightPanelCollapsed(prior.rightPanelCollapsed);
      priorMapStateRef.current = null;
    }
    setSelectedSchool(null);
  }, [setRightPanelCollapsed, setSelectedSchool]);

  // Clear the one-shot flyToView after MapView consumes it so subsequent
  // pan/zooms don't keep snapping the user back to the captured view.
  useEffect(() => {
    if (!flyToView) return;
    const id = window.setTimeout(() => setFlyToView(null), 100);
    return () => window.clearTimeout(id);
  }, [flyToView]);

  /* -------------------- Value lists for quantile binning --------------------
   * Both the Legend and MapView call into `colorBinsFor` — quantile-flagged
   * indicators need the full distribution to compute percentile edges, so we
   * derive the lists once at this level and pass to both. Keeping them in sync
   * is the §11.4 anti-debt rule (legend can never disagree with the map).
   */
  const schoolValueList = useMemo<number[]>(() => {
    const out: number[] = [];
    if (!schoolData) return out;
    for (const f of schoolData.features) {
      const v = f.properties.value_num;
      if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    }
    return out;
  }, [schoolData]);
  const communityValueList = useMemo<number[]>(() => {
    const out: number[] = [];
    if (!communityData) return out;
    for (const raw of Object.values(communityData.values)) {
      if (typeof raw === 'number' && Number.isFinite(raw)) out.push(raw);
    }
    return out;
  }, [communityData]);

  /* -------------------- No-data flags (per-layer, independent) --------------------
   * `resolveActiveLayers` already merged the registry-coverage check with the
   * fetched-and-empty check. Each layer fires its 🗓️ branch independently —
   * §6.6 acceptance test #3. School-side no-data is now handled inside the
   * merge above (no-coverage years simply produce an FC where every school
   * has `value_num: null`, which the paint expressions render as hollow rings).
   */
  const communityNoData = layers.community?.noData ?? false;

  /**
   * Merged school-points FC. Always contains every plottable in-view school
   * (sourced from `baselineSchoolData`) with indicator values folded in where
   * available (from `enrichedSchoolData`). No-data schools fall through with
   * `value_num: null` so MapView's hollow-ring branch can render them. The
   * old "schoolNoData → null" triage is now folded in for free — a no-data
   * year just produces an FC where every feature has `value_num: null`.
   */
  const mergedSchoolData: SchoolsResponse | null = useMemo(() => {
    if (!schoolIndicator) return baselineSchoolData;
    if (!baselineSchoolData) return null;
    if (!enrichedSchoolData || enrichedSchoolData.features.length === 0) {
      // Indicator selected but the slider year has zero coverage. Render
      // every school as no-value; downstream paint handles the hollow-ring
      // branch uniformly.
      return {
        type: 'FeatureCollection',
        indicator_id: schoolIndicator.id,
        year: enrichedSchoolData?.year ?? baselineSchoolData.year,
        domain: null,
        features: baselineSchoolData.features,
      };
    }
    const valuesByDbn = new Map(
      enrichedSchoolData.features.map((f) => [f.properties.dbn, f.properties]),
    );
    const features: SchoolFeature[] = baselineSchoolData.features.map((f) => {
      const v = valuesByDbn.get(f.properties.dbn);
      if (!v) return f;
      return {
        ...f,
        properties: {
          ...f.properties,
          value_num: v.value_num,
          value_text: v.value_text,
          label: v.label,
        },
      };
    });
    return {
      type: 'FeatureCollection',
      indicator_id: enrichedSchoolData.indicator_id,
      year: enrichedSchoolData.year,
      domain: enrichedSchoolData.domain,
      features,
    };
  }, [schoolIndicator, baselineSchoolData, enrichedSchoolData]);

  /**
   * The school-points feature collection MapView paints. Mostly equals
   * `mergedSchoolData`; the only override is `schoolsHidden`, where we either
   * suppress everything or — if a school is currently selected — keep a
   * one-feature FC so the pulse marker still has its target.
   */
  const schoolPointsToRender: SchoolsResponse | null = useMemo(() => {
    const fullSet = mergedSchoolData;
    if (!schoolsHidden) return fullSet;
    if (!selectedSchoolDbn || !fullSet) return null;
    const feature = fullSet.features.find((f) => f.properties.dbn === selectedSchoolDbn);
    if (!feature) return null;
    return { ...fullSet, features: [feature] };
  }, [schoolsHidden, selectedSchoolDbn, mergedSchoolData]);

  return (
    <div
      style={{
        display: 'grid',
        // Detail Panel takes priority over the collapsed state — when a school
        // is selected the right column is always shown at full width.
        gridTemplateColumns: selectedSchoolDbn
          ? '300px 1fr minmax(224px, 28%)'
          : rightPanelCollapsed
            ? '300px 1fr 28px'
            : '300px 1fr minmax(224px, 28%)',
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
        schoolValues={schoolValueList}
        communityIndicator={communityIndicator}
        communityYear={communityYear}
        communityDomain={communityData?.domain ?? null}
        communityValues={communityValueList}
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
          schoolIndicator={schoolIndicator}
          communityIndicator={communityIndicator}
        />
        <div style={{ position: 'relative', minHeight: 0 }}>
          <PwcCounter
            universeDbns={universe.schoolDbns}
            pwcMembers={pwcMembers ?? []}
            schoolLayer={layers.school}
            schoolData={schoolData}
            communityLayer={layers.community}
            communitySeries={communityNormalizedSeries}
          />
          <MapView
            schoolIndicator={schoolIndicator}
            schoolPoints={schoolPointsToRender}
            communityIndicator={communityIndicator}
            communityValues={
              communityHidden ? null : communityNoData ? null : communityData
            }
            tractGeoJsonUrl={tractUrl}
            tractNtaMap={tractNtaMap}
            schoolType={schoolType}
            filteredSchoolDbns={universe.schoolDbns}
            flyToCoords={selectedSchoolCoords}
            flyToView={flyToView}
            flyToBbox={flyToBbox}
            onViewChange={(v) => {
              lastMapViewRef.current = v;
            }}
            onSchoolClick={setSelectedSchool}
            selectedSchool={
              selectedSchoolDbn && selectedSchoolCoords
                ? { dbn: selectedSchoolDbn, coords: selectedSchoolCoords }
                : null
            }
            geoSelection={geoSelection}
            pwcHalosVisible={pwcHalosVisible}
          />
        </div>
      </main>

      {selectedSchoolDbn ? (
        <SchoolDetailPanel
          dbn={selectedSchoolDbn}
          year={year}
          schoolsMaster={schoolsMaster ?? []}
          schoolLayer={layers.school}
          communityLayer={layers.community}
          schoolSeries={schoolNormalizedSeries}
          communitySeries={communityNormalizedSeries}
          universeDbns={universe.schoolDbns}
          aggregationArea={aggregationArea}
          onClose={handleDetailClose}
        />
      ) : (
        <RightPanel
          indicator={analyticsIndicator}
          analytics={analytics}
          analyticsUnavailable={analyticsUnavailable}
          schoolsMaster={schoolsMaster ?? []}
          // `analyticsYear` honors the Latest-Year toggle — when on, each
          // family's panel snaps to its OWN latest registry year. Falls back
          // to the slider year otherwise.
          year={analyticsYear}
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
      )}
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
