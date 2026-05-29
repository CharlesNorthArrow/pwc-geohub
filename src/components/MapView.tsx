'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type StyleSpecification,
} from 'maplibre-gl';

import type {
  CommunityResponse,
  GeoSelectionResponse,
  IndicatorPublic,
  SchoolsResponse,
} from '../contract/types';
import {
  colorBinsFor,
  colorExpression,
  radiusExpression,
} from '../map/encoding';
import type { SchoolType } from '../store/useHubStore';

// One-shot stylesheet import — MapLibre fails silently without these styles.
import 'maplibre-gl/dist/maplibre-gl.css';

interface Props {
  schoolIndicator: IndicatorPublic | null;
  /** Already enriched with PWC flags by `<Shell/>` (Phase 2). */
  schoolPoints: SchoolsResponse | null;
  communityIndicator: IndicatorPublic | null;
  communityValues: CommunityResponse | null;
  tractGeoJsonUrl: string | null;
  /** PWC layer toggle (spec §6.2). Header dropdown writes; map reads. */
  schoolType: SchoolType;
  /** Phase 3 — DBNs that pass Geo + School Type + Cohort cascade. The map's
   *  school-layer filter is intersected with the PWC filter via 'all'. */
  filteredSchoolDbns: Set<string>;
  /** Phase 3 — when set, flyTo these coordinates (school filter pick). */
  flyToCoords: number[] | null;
  /** Phase 3 polish — polygons of the currently-selected Geo filter areas.
   *  Drawn as a line-only outline above tracts, below the school layers. */
  geoSelection: GeoSelectionResponse | null;
}

const NYC_BOUNDS: [number, number, number, number] = [-74.27, 40.49, -73.68, 40.92];

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };

const SOURCE_SCHOOLS = 'schools';
const SOURCE_TRACTS = 'tracts';
const SOURCE_GEO_SELECTION = 'geo-selection';
const LAYER_TRACTS_FILL = 'tracts-fill';
const LAYER_TRACTS_LINE = 'tracts-line';
const LAYER_GEO_SELECTION_FILL = 'geo-selection-fill';
const LAYER_GEO_SELECTION_LINE = 'geo-selection-line';

/* School-point layer stack — non-PWC paints first (bottom), then PWC halos
 * and dots on top so PWC schools are visually unobscured in dense clusters.
 * Splitting by is_pwc via per-layer filters is more reliable than
 * `circle-sort-key`, which only orders features INSIDE a single layer. */
const LAYER_SCHOOLS_NONPWC = 'schools-circles-nonpwc';
const LAYER_HALO_OUTER = 'schools-halo-outer'; // Healing Arts (or both)
const LAYER_HALO_INNER = 'schools-halo-inner'; // Anchor (or both) / pwc_other
const LAYER_SCHOOLS_PWC = 'schools-circles-pwc';

/* PWC halo colors — pulled from the brand palette in CLAUDE.md. */
const PWC_MAGENTA = '#903090'; // Anchor
const PWC_ORANGE = '#F0901F'; // Healing Arts
const PWC_BLUE = '#027BC0';   // pwc_other (program-active, not anchor/arts)
const TRANSPARENT = 'rgba(0,0,0,0)';

/** Mid-blue from the brand palette — used for the baseline (no indicator
 *  selected) unicolor circle fill. Same hue as the legend's enrollment
 *  size key, so the two read as one visual system. */
const BASELINE_FILL = '#467c9d';

/**
 * PWC fill-color expression for baseline (no indicator) mode. Anchor (incl.
 * both-category, since both-category has is_anchor=true) renders magenta;
 * Healing-Arts-only renders orange; pwc_other renders blue. Non-PWC
 * features can't reach this layer (per-layer filter), but we keep a
 * fallthrough fill just in case.
 */
const PWC_BASELINE_FILL_EXPR: unknown = [
  'case',
  ['==', ['get', 'is_anchor'], true], PWC_MAGENTA,
  ['==', ['get', 'is_arts'], true], PWC_ORANGE,
  ['==', ['get', 'pwc_other'], true], PWC_BLUE,
  BASELINE_FILL,
];

/**
 * In baseline mode we replace halos with a single solid stroke around the
 * PWC dot. Both-category schools (anchor + healing-arts) read as a magenta
 * fill with orange stroke; anchor-only / pwc_other get a faint white stroke
 * to keep them readable on dense backgrounds.
 */
const PWC_BASELINE_STROKE_COLOR_EXPR: unknown = [
  'case',
  // anchor AND arts (both): magenta dot, orange ring
  ['all', ['==', ['get', 'is_anchor'], true], ['==', ['get', 'is_arts'], true]],
  PWC_ORANGE,
  '#ffffff',
];
const PWC_BASELINE_STROKE_WIDTH_EXPR: unknown = [
  'case',
  ['all', ['==', ['get', 'is_anchor'], true], ['==', ['get', 'is_arts'], true]], 2,
  1,
];

/**
 * MapLibre style — light CARTO Voyager. Public, no key required. We avoid
 * MapTiler / Mapbox tiles in Phase 1 so the build works without third-party
 * keys; swap to a styled-vector basemap during Phase 6 polish if needed.
 */
const BASE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#f5f7fa' } },
    { id: 'carto', type: 'raster', source: 'carto' },
  ],
};

export default function MapView({
  schoolIndicator,
  schoolPoints,
  communityIndicator,
  communityValues,
  tractGeoJsonUrl,
  schoolType,
  filteredSchoolDbns,
  flyToCoords,
  geoSelection,
}: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const styleReadyRef = useRef(false);

  // --- Initialize once ----------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      bounds: NYC_BOUNDS,
      fitBoundsOptions: { padding: 32 },
      attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      // Empty sources/layers up-front; populated by the effects below.
      map.addSource(SOURCE_SCHOOLS, { type: 'geojson', data: EMPTY_FC });

      // Selected-geographies overlay — drawn ABOVE tracts (so users can read
      // boundaries against the choropleth) but BELOW school points. Fill is
      // nearly transparent so the choropleth stays legible; the line carries
      // the real signal.
      map.addSource(SOURCE_GEO_SELECTION, { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: LAYER_GEO_SELECTION_FILL,
        type: 'fill',
        source: SOURCE_GEO_SELECTION,
        paint: {
          'fill-color': '#002040',
          'fill-opacity': 0.04,
        },
      });
      map.addLayer({
        id: LAYER_GEO_SELECTION_LINE,
        type: 'line',
        source: SOURCE_GEO_SELECTION,
        paint: {
          'line-color': '#002040',
          'line-width': 2,
          'line-opacity': 0.85,
        },
      });

      // Stack order (bottom → top):
      //   1. non-PWC dots
      //   2. PWC dots
      //   3. PWC inner hoop  (sticks to PWC dot circumference)
      //   4. PWC outer hoop  (only offset when both-category, otherwise hugs)
      // Hoops paint AFTER the PWC dot so the dot's white stroke doesn't
      // eat into the hoop's visible width.
      map.addLayer({
        id: LAYER_SCHOOLS_NONPWC,
        type: 'circle',
        source: SOURCE_SCHOOLS,
        filter: ['!=', ['get', 'is_pwc'], true],
        paint: {
          'circle-color': '#cccccc',
          'circle-radius': 4,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
          'circle-opacity': 0.85,
        },
      });
      map.addLayer({
        id: LAYER_SCHOOLS_PWC,
        type: 'circle',
        source: SOURCE_SCHOOLS,
        filter: ['==', ['get', 'is_pwc'], true],
        paint: {
          'circle-color': '#cccccc',
          'circle-radius': 4,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
          'circle-opacity': 0.85,
        },
      });
      map.addLayer({
        id: LAYER_HALO_INNER,
        type: 'circle',
        source: SOURCE_SCHOOLS,
        filter: ['==', ['get', 'is_pwc'], true],
        paint: {
          'circle-color': TRANSPARENT,
          'circle-radius': 4,
          'circle-stroke-color': TRANSPARENT,
          'circle-stroke-width': 0,
          'circle-stroke-opacity': 1,
        },
      });
      map.addLayer({
        id: LAYER_HALO_OUTER,
        type: 'circle',
        source: SOURCE_SCHOOLS,
        filter: ['==', ['get', 'is_pwc'], true],
        paint: {
          'circle-color': TRANSPARENT,
          'circle-radius': 4,
          'circle-stroke-color': TRANSPARENT,
          'circle-stroke-width': 0,
          'circle-stroke-opacity': 1,
        },
      });
      styleReadyRef.current = true;
      // Force a re-eval of the data effects after style readiness.
      map.fire('phase1-style-ready');
    });

    return () => {
      map.remove();
      mapRef.current = null;
      styleReadyRef.current = false;
    };
  }, []);

  // --- Tract polygons: add source + layers once URL is known --------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tractGeoJsonUrl) return;

    const mountTractSource = (): void => {
      if (map.getSource(SOURCE_TRACTS)) return;
      map.addSource(SOURCE_TRACTS, {
        type: 'geojson',
        data: tractGeoJsonUrl,
        promoteId: 'GEOID',
      });
      map.addLayer(
        {
          id: LAYER_TRACTS_FILL,
          type: 'fill',
          source: SOURCE_TRACTS,
          paint: {
            'fill-color': [
              'case',
              ['==', ['feature-state', 'v'], null], 'rgba(0,0,0,0)',
              ['coalesce', ['feature-state', 'color'], 'rgba(0,0,0,0)'],
            ],
            'fill-opacity': 0.65,
          },
        },
        LAYER_SCHOOLS_NONPWC, // beneath every school layer
      );
      map.addLayer(
        {
          id: LAYER_TRACTS_LINE,
          type: 'line',
          source: SOURCE_TRACTS,
          paint: { 'line-color': 'rgba(0,0,0,0.15)', 'line-width': 0.3 },
        },
        LAYER_SCHOOLS_NONPWC,
      );
    };

    if (styleReadyRef.current) {
      mountTractSource();
    } else {
      map.once('phase1-style-ready', mountTractSource);
    }
  }, [tractGeoJsonUrl]);

  // --- School points: update data + paint -------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): void => {
      const source = map.getSource(SOURCE_SCHOOLS) as GeoJSONSource | undefined;
      if (!source) return;
      if (!schoolPoints || schoolPoints.features.length === 0) {
        source.setData(EMPTY_FC);
        for (const id of [LAYER_SCHOOLS_NONPWC, LAYER_SCHOOLS_PWC]) {
          map.setPaintProperty(id, 'circle-color', '#cccccc');
          map.setPaintProperty(id, 'circle-radius', 4);
          map.setPaintProperty(id, 'circle-stroke-color', '#ffffff');
          map.setPaintProperty(id, 'circle-stroke-width', 1);
        }
        // Hide halos when no points.
        map.setPaintProperty(LAYER_HALO_INNER, 'circle-stroke-width', 0);
        map.setPaintProperty(LAYER_HALO_OUTER, 'circle-stroke-width', 0);
        return;
      }
      source.setData(schoolPoints);
      const dataRadius = radiusExpression() as unknown;

      // Radius is the same for both school-dot layers — keeps PWC and
      // non-PWC dots visually comparable.
      for (const id of [LAYER_SCHOOLS_NONPWC, LAYER_SCHOOLS_PWC]) {
        map.setPaintProperty(id, 'circle-radius', dataRadius as never);
      }

      if (!schoolIndicator) {
        // BASELINE mode: non-PWC = unicolor brand blue, PWC = category color
        // with a slim ring (orange ring on both-category schools), and NO
        // halos. The single colored fill is the entire PWC affordance.
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-color', BASELINE_FILL);
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-stroke-color', '#ffffff');
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-stroke-width', 1);

        map.setPaintProperty(LAYER_SCHOOLS_PWC, 'circle-color', PWC_BASELINE_FILL_EXPR as never);
        map.setPaintProperty(
          LAYER_SCHOOLS_PWC,
          'circle-stroke-color',
          PWC_BASELINE_STROKE_COLOR_EXPR as never,
        );
        map.setPaintProperty(
          LAYER_SCHOOLS_PWC,
          'circle-stroke-width',
          PWC_BASELINE_STROKE_WIDTH_EXPR as never,
        );

        // Halos OFF in baseline mode.
        map.setPaintProperty(LAYER_HALO_INNER, 'circle-stroke-width', 0);
        map.setPaintProperty(LAYER_HALO_OUTER, 'circle-stroke-width', 0);
        return;
      }

      // INDICATOR mode: both PWC and non-PWC dots share the gradient so
      // values are comparable; PWC schools are flagged by halos sitting
      // above the non-PWC layer.
      const bins = colorBinsFor(schoolIndicator, schoolPoints.domain);
      const colorExpr = colorExpression(
        bins,
        schoolIndicator.scale.type === 'categorical'
          ? ['get', 'value_text']
          : ['get', 'value_num'],
      );
      for (const id of [LAYER_SCHOOLS_NONPWC, LAYER_SCHOOLS_PWC]) {
        map.setPaintProperty(id, 'circle-color', colorExpr as never);
        map.setPaintProperty(id, 'circle-stroke-color', '#ffffff');
        map.setPaintProperty(id, 'circle-stroke-width', 1);
      }

      // Hoops sit on the circle circumference (no floating halo offset):
      //   inner hoop  → radius = R  (stroke draws outward from R)
      //   outer hoop  → radius = R + inner-stroke-width (only offset when
      //                 BOTH categories apply, so an arts-only school's
      //                 hoop still hugs the dot directly).
      const innerStrokeWidth: unknown = [
        'case',
        ['==', ['get', 'is_anchor'], true], 2,
        ['==', ['get', 'pwc_other'], true], 1.5,
        0,
      ];
      map.setPaintProperty(LAYER_HALO_INNER, 'circle-radius', dataRadius as never);
      map.setPaintProperty(
        LAYER_HALO_OUTER,
        'circle-radius',
        [
          '+',
          dataRadius,
          // 2 only when this school is BOTH (anchor & arts); otherwise 0 so
          // arts-only hoops hug the dot directly.
          [
            'case',
            ['all', ['==', ['get', 'is_anchor'], true], ['==', ['get', 'is_arts'], true]],
            2,
            0,
          ],
        ] as never,
      );

      // Inner hoop stroke: Anchor / Both = magenta 2px; pwc_other = blue 1.5px.
      map.setPaintProperty(
        LAYER_HALO_INNER,
        'circle-stroke-color',
        [
          'case',
          ['==', ['get', 'is_anchor'], true], PWC_MAGENTA,
          ['==', ['get', 'pwc_other'], true], PWC_BLUE,
          TRANSPARENT,
        ] as never,
      );
      map.setPaintProperty(LAYER_HALO_INNER, 'circle-stroke-width', innerStrokeWidth as never);

      // Outer hoop stroke: Healing Arts / Both = orange 2px.
      map.setPaintProperty(
        LAYER_HALO_OUTER,
        'circle-stroke-color',
        [
          'case',
          ['==', ['get', 'is_arts'], true], PWC_ORANGE,
          TRANSPARENT,
        ] as never,
      );
      map.setPaintProperty(
        LAYER_HALO_OUTER,
        'circle-stroke-width',
        [
          'case',
          ['==', ['get', 'is_arts'], true], 2,
          0,
        ] as never,
      );
    };
    if (styleReadyRef.current) apply();
    else map.once('phase1-style-ready', apply);
  }, [schoolIndicator, schoolPoints]);

  // --- Combined filter (Phase 2 PWC + Phase 3 cascade) applied to school layers
  //
  // The Phase 3 `applyFilters` selector already encodes School Type, so its
  // output is the FINAL universe of DBNs. We could drop the `schoolType`
  // expression entirely — but keeping it makes the map's behavior obvious
  // from the filter expression alone, and it's cheap (constant-size). We
  // intersect via MapLibre 'all': both predicates must pass.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): void => {
      const dbns = filteredSchoolDbns;
      const inUniverse: unknown = dbns.size === 0
        ? true // empty universe = no filter applied (Phase 1 default behaviour)
        : ['in', ['get', 'dbn'], ['literal', [...dbns]]];
      const cascade = ['all', filterFor(schoolType), inUniverse];
      // Each layer must KEEP its PWC predicate (so non-PWC and PWC stay on
      // their respective Z-stacks). Intersect cascade with that predicate.
      const nonPwcFilter = ['all', cascade, ['!=', ['get', 'is_pwc'], true]];
      const pwcFilter = ['all', cascade, ['==', ['get', 'is_pwc'], true]];
      if (map.getLayer(LAYER_SCHOOLS_NONPWC)) {
        map.setFilter(LAYER_SCHOOLS_NONPWC, nonPwcFilter as never);
      }
      for (const id of [LAYER_HALO_OUTER, LAYER_HALO_INNER, LAYER_SCHOOLS_PWC]) {
        if (map.getLayer(id)) map.setFilter(id, pwcFilter as never);
      }
    };
    if (styleReadyRef.current) apply();
    else map.once('phase1-style-ready', apply);
  }, [schoolType, filteredSchoolDbns]);

  // --- Selected-geographies overlay: update source data + zoom + tract filter
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): void => {
      const src = map.getSource(SOURCE_GEO_SELECTION) as GeoJSONSource | undefined;
      if (src) src.setData(geoSelection ?? EMPTY_FC);

      // Filter the community tract layers to the intersection set. Empty
      // selection → no filter (full NYC choropleth, as before).
      const tracts = geoSelection?.intersectingTractGeoids ?? [];
      const tractFilter: unknown = tracts.length === 0
        ? true
        : ['in', ['get', 'GEOID'], ['literal', tracts]];
      for (const id of [LAYER_TRACTS_FILL, LAYER_TRACTS_LINE]) {
        if (map.getLayer(id)) map.setFilter(id, tractFilter as never);
      }

      // Fit the viewport to the union of selected polygons. We only zoom IN
      // when there is a selection — clearing filters preserves current view.
      const bbox = geoSelection ? boundsOf(geoSelection) : null;
      if (bbox) {
        map.fitBounds(
          [
            [bbox[0], bbox[1]],
            [bbox[2], bbox[3]],
          ],
          { padding: 80, maxZoom: 13, duration: 500 },
        );
      }
    };
    if (styleReadyRef.current) apply();
    else map.once('phase1-style-ready', apply);
  }, [geoSelection]);

  // --- flyTo when the user picks a school (spec §6.4) -------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToCoords) return;
    map.flyTo({
      center: [flyToCoords[0]!, flyToCoords[1]!],
      zoom: 15,
      essential: true,
    });
  }, [flyToCoords]);

  // --- Community values: paint via feature-state, no source reload --------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = (): void => {
      if (!map.getSource(SOURCE_TRACTS)) return;
      // Clear any prior coloring (cheap: 2.3K entries).
      // MapLibre's removeFeatureState resets all states for the source.
      map.removeFeatureState({ source: SOURCE_TRACTS });
      if (!communityIndicator || !communityValues) return;
      const bins = colorBinsFor(communityIndicator, communityValues.domain);

      for (const [geoid, raw] of Object.entries(communityValues.values)) {
        const color = colorFor(bins, raw);
        if (color == null) continue;
        map.setFeatureState({ source: SOURCE_TRACTS, id: geoid }, { v: raw, color });
      }
    };

    if (styleReadyRef.current) apply();
    else map.once('phase1-style-ready', apply);
  }, [communityIndicator, communityValues]);

  /* -------------------- PWC schools-in-view counter --------------------
   * Counts the PWC features actually rendered in the current viewport,
   * AFTER every filter (Geo cascade, School Type, etc.). Updated on
   * `idle` so it only fires once panning/zooming settles, and on the
   * filter-effect deps via a `tick` bump so cascade changes refresh too.
   */
  const [pwcCounts, setPwcCounts] = useState<PwcInViewCounts>(EMPTY_COUNTS);
  const recomputePwcCounts = useCallback((): void => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.getLayer(LAYER_SCHOOLS_PWC)) {
      setPwcCounts(EMPTY_COUNTS);
      return;
    }
    const feats = map.queryRenderedFeatures(undefined, {
      layers: [LAYER_SCHOOLS_PWC],
    });
    // Dedupe by DBN — the same feature can appear multiple times in
    // queryRenderedFeatures when a viewport spans tile boundaries.
    const seen = new Set<string>();
    let anchor = 0;
    let arts = 0;
    let both = 0;
    let other = 0;
    for (const f of feats) {
      const dbn = (f.properties?.dbn as string | undefined) ?? null;
      if (!dbn || seen.has(dbn)) continue;
      seen.add(dbn);
      const isAnchor = f.properties?.is_anchor === true;
      const isArts = f.properties?.is_arts === true;
      const pwcOther = f.properties?.pwc_other === true;
      if (isAnchor && isArts) both += 1;
      else if (isAnchor) anchor += 1;
      else if (isArts) arts += 1;
      else if (pwcOther) other += 1;
    }
    setPwcCounts({ anchor, arts, both, other, total: seen.size });
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onIdle = (): void => recomputePwcCounts();
    map.on('idle', onIdle);
    return () => {
      map.off('idle', onIdle);
    };
  }, [recomputePwcCounts]);

  // Also recompute whenever the underlying data or filters change — the
  // `idle` listener catches viewport changes, but a cascade-only change
  // (no pan/zoom) wouldn't fire `idle` reliably.
  useEffect(() => {
    // Defer one frame so MapLibre has applied the new filter/data before
    // queryRenderedFeatures is asked.
    const id = requestAnimationFrame(recomputePwcCounts);
    return () => cancelAnimationFrame(id);
  }, [schoolPoints, schoolType, filteredSchoolDbns, recomputePwcCounts]);

  return (
    <div
      style={{ position: 'absolute', inset: 0, background: '#f5f7fa' }}
      aria-label="Map of NYC"
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <PwcInViewBadge counts={pwcCounts} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* PWC-in-view overlay                                                        */
/* -------------------------------------------------------------------------- */

interface PwcInViewCounts {
  anchor: number;
  arts: number;
  both: number;
  other: number;
  total: number;
}

const EMPTY_COUNTS: PwcInViewCounts = {
  anchor: 0,
  arts: 0,
  both: 0,
  other: 0,
  total: 0,
};

/**
 * Floating top-left badge — counts PWC schools currently rendered in the
 * viewport plus a 2-row breakdown by category. Both-category schools count
 * in BOTH Anchor and Healing Arts (spec §12 Q1 "both-rule").
 */
function PwcInViewBadge({ counts }: { counts: PwcInViewCounts }): React.JSX.Element | null {
  // Hide entirely when there are no PWC schools in view — nothing useful
  // to surface, and one less floating element in the way of the map.
  if (counts.total === 0) return null;
  // Both-category schools appear in both buckets (spec "both-rule").
  const anchorTotal = counts.anchor + counts.both;
  const artsTotal = counts.arts + counts.both;
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
        minWidth: 168,
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
      <PwcCountRow color={PWC_MAGENTA} label="Anchor" count={anchorTotal} />
      <PwcCountRow color={PWC_ORANGE} label="Healing Arts" count={artsTotal} />
      {counts.both > 0 ? (
        <div
          style={{
            marginTop: 4,
            fontSize: 9,
            color: '#a8b3bf',
            fontStyle: 'italic',
          }}
        >
          {counts.both} counted in both
        </div>
      ) : null}
    </div>
  );
}

function PwcCountRow({
  color,
  label,
  count,
}: {
  color: string;
  label: string;
  count: number;
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 0',
      }}
    >
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
      <span style={{ flex: 1, color: '#002040' }}>{label}</span>
      <span style={{ fontWeight: 700, color: '#002040' }}>{count}</span>
    </div>
  );
}

/** Walk every coordinate in a selection FC and return [w, s, e, n], or null
 *  when the collection is empty. */
function boundsOf(fc: GeoSelectionResponse): [number, number, number, number] | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  let touched = false;
  for (const f of fc.features) {
    for (const poly of f.geometry.coordinates) {
      for (const ring of poly) {
        for (const pt of ring) {
          const x = pt[0];
          const y = pt[1];
          if (typeof x !== 'number' || typeof y !== 'number') continue;
          if (x < w) w = x;
          if (x > e) e = x;
          if (y < s) s = y;
          if (y > n) n = y;
          touched = true;
        }
      }
    }
  }
  return touched ? [w, s, e, n] : null;
}

/**
 * MapLibre filter expression keyed off the PWC flags merged onto every
 * school feature (`is_pwc`, `is_anchor`, `is_arts`). Both-category schools
 * carry is_anchor=true AND is_arts=true, so they pass either group filter
 * (the agreed both-rule from §12 Q1).
 */
function filterFor(t: SchoolType): unknown {
  switch (t) {
    case 'pwc':
      return ['==', ['get', 'is_pwc'], true];
    case 'anchor':
      return ['==', ['get', 'is_anchor'], true];
    case 'healing_arts':
      return ['==', ['get', 'is_arts'], true];
    case 'all':
    default:
      // MapLibre treats `true` as "no filter".
      return true;
  }
}

/** Resolve a single value→color outside MapLibre paint expressions. */
function colorFor(
  bins: ReturnType<typeof colorBinsFor>,
  raw: number | string | null,
): string | null {
  if (bins.type === 'none' || raw == null) return null;
  if (bins.type === 'categorical') {
    return typeof raw === 'string' ? bins.colorFor(raw) : null;
  }
  if (typeof raw !== 'number') return null;
  const { ramp, edges } = bins;
  if (raw < edges[0]) return ramp[0] ?? null;
  if (raw < edges[1]) return ramp[1] ?? null;
  if (raw < edges[2]) return ramp[2] ?? null;
  if (raw < edges[3]) return ramp[3] ?? null;
  return ramp[4] ?? null;
}
