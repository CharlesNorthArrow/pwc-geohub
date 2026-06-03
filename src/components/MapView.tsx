'use client';

import { useEffect, useRef } from 'react';
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
  backdropRadiusExpression,
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
  /** Phase 3 — when set, flyTo these coordinates (school filter pick / detail
   *  panel open). The zoom level is fixed at `SELECTION_ZOOM` (NTA-level)
   *  for both surfaces so the framing stays consistent. */
  flyToCoords: number[] | null;
  /** School Detail Panel close — when set, flyTo({center, zoom}) restores the
   *  exact camera state captured on open. Set to null afterward. */
  flyToView: { center: [number, number]; zoom: number } | null;
  /** Cohort pick — when set, fitBounds to the cohort's schools. One-shot;
   *  Shell clears after MapView consumes it. */
  flyToBbox: [number, number, number, number] | null;
  /** Latest camera observed by `idle` — Shell holds a ref for capture/restore. */
  onViewChange?: (view: { center: [number, number]; zoom: number }) => void;
  /** Click on any school dot — fires with the school's DBN. */
  onSchoolClick?: (dbn: string) => void;
  /** Currently-selected school's coords + DBN — drives the pulsing marker. */
  selectedSchool?: { dbn: string; coords: [number, number] } | null;
  /** Polygons of the currently-selected Geo filter areas. */
  geoSelection: GeoSelectionResponse | null;
  /** When false, drop the colored stroke/halo around PWC schools so they
   *  blend with non-PWC dots. Fills stay PWC-colored in baseline mode so
   *  schools remain identifiable; in indicator mode they read identically
   *  to non-PWC. Default = true. */
  pwcHalosVisible: boolean;
}

/** NTA-level zoom — frames the surrounding neighborhood. */
const SELECTION_ZOOM = 13;

const NYC_BOUNDS: [number, number, number, number] = [-74.27, 40.49, -73.68, 40.92];

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };

const SOURCE_SCHOOLS = 'schools';
const SOURCE_TRACTS = 'tracts';
const SOURCE_GEO_SELECTION = 'geo-selection';
const LAYER_TRACTS_FILL = 'tracts-fill';
const LAYER_TRACTS_LINE = 'tracts-line';
const LAYER_GEO_SELECTION_FILL = 'geo-selection-fill';
const LAYER_GEO_SELECTION_LINE = 'geo-selection-line';

/* School-point layer stack — non-PWC paints first (bottom), then PWC
 * circles on top so PWC schools dominate in dense clusters. Both PWC and
 * non-PWC share the same circle-radius (= enrollment) so visual comparison
 * is meaningful. Backdrop sits under everything as a soft shadow. */
const LAYER_SCHOOLS_BACKDROP = 'schools-backdrop';
const LAYER_SCHOOLS_NONPWC = 'schools-circles-nonpwc';
const LAYER_SCHOOLS_PWC = 'schools-circles-pwc';

/* PWC brand colors — Anchor magenta, Healing Arts green, pwc_other blue. */
const PWC_MAGENTA = '#903090'; // Anchor (includes both-category)
const PWC_GREEN = '#A0B000';   // Healing Arts (pure HA only — anchor-wins)
const PWC_BLUE = '#027BC0';    // pwc_other (program-active, not anchor/arts)
const TRANSPARENT = 'rgba(0,0,0,0)';

/** Border width for PWC circle strokes (baseline + indicator mode).
 *  Doubled from 1.5 → 3 to make the PWC halo more legible against the
 *  larger circle radii. */
const PWC_BORDER_WIDTH = 3;

/** Muted slate-blue for non-PWC schools in baseline mode. */
const BASELINE_FILL = '#7BA7C9';
const BASELINE_NONPWC_OPACITY = 0.4;

/** Stroke for "no data" schools (indicator mode) — medium neutral grey. */
const NO_DATA_STROKE = '#7a8896';

/** Drop shadow alpha + blur — see backdrop layer. */
const BACKDROP_FILL = 'rgba(0, 32, 64, 0.45)';

/**
 * Per-category fill in baseline mode (no indicator). Anchor magenta,
 * Healing-Arts green, pwc_other blue. Anchor-wins: a school with both
 * is_anchor and is_arts paints magenta because is_anchor is tested first.
 */
const PWC_BASELINE_FILL_EXPR: unknown = [
  'case',
  ['==', ['get', 'is_anchor'], true], PWC_MAGENTA,
  ['==', ['get', 'is_arts'], true], PWC_GREEN,
  ['==', ['get', 'pwc_other'], true], PWC_BLUE,
  BASELINE_FILL,
];

/**
 * Per-category stroke color in indicator mode — the school's original PWC
 * color becomes the border while the fill takes the indicator's color.
 */
const PWC_INDICATOR_STROKE_EXPR: unknown = [
  'case',
  ['==', ['get', 'is_anchor'], true], PWC_MAGENTA,
  ['==', ['get', 'is_arts'], true], PWC_GREEN,
  ['==', ['get', 'pwc_other'], true], PWC_BLUE,
  NO_DATA_STROKE,
];

/**
 * MapLibre style — light CARTO Voyager basemap. Public, no key required.
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
  flyToView,
  flyToBbox,
  onViewChange,
  onSchoolClick,
  selectedSchool,
  geoSelection,
  pwcHalosVisible,
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
      map.addSource(SOURCE_SCHOOLS, { type: 'geojson', data: EMPTY_FC });

      // Selected-geographies overlay — drawn ABOVE tracts but BELOW schools.
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
      //   0. backdrop      (soft dark shadow behind every visible dot)
      //   1. non-PWC dots
      //   2. PWC dots      (anchor, healing-arts, pwc_other — split by stroke)
      map.addLayer({
        id: LAYER_SCHOOLS_BACKDROP,
        type: 'circle',
        source: SOURCE_SCHOOLS,
        paint: {
          'circle-color': BACKDROP_FILL,
          'circle-radius': 6,
          'circle-blur': 0.7,
          'circle-stroke-width': 0,
          'circle-opacity': 1,
        },
      });
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
          'circle-stroke-width': PWC_BORDER_WIDTH,
          'circle-opacity': 0.95,
        },
      });

      styleReadyRef.current = true;
      map.fire('phase1-style-ready');
    });

    return () => {
      map.remove();
      mapRef.current = null;
      styleReadyRef.current = false;
    };
  }, []);

  // --- Tract polygons -----------------------------------------------------
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
            'fill-opacity': [
              'case',
              ['==', ['feature-state', 'v'], null], 0,
              ['coalesce', ['feature-state', 'opacity'], 0.65],
            ],
          },
        },
        LAYER_SCHOOLS_BACKDROP,
      );
      map.addLayer(
        {
          id: LAYER_TRACTS_LINE,
          type: 'line',
          source: SOURCE_TRACTS,
          paint: { 'line-color': 'rgba(0,0,0,0.15)', 'line-width': 0.3 },
        },
        LAYER_SCHOOLS_BACKDROP,
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
        map.setPaintProperty(LAYER_SCHOOLS_BACKDROP, 'circle-opacity', 0);
        return;
      }
      source.setData(schoolPoints);
      const dataRadius = radiusExpression() as unknown;

      for (const id of [LAYER_SCHOOLS_NONPWC, LAYER_SCHOOLS_PWC]) {
        map.setPaintProperty(id, 'circle-radius', dataRadius as never);
      }

      // Backdrop radius is 2 px wider than the data dot so a soft drop shadow
      // peeks out from behind each circle.
      map.setPaintProperty(
        LAYER_SCHOOLS_BACKDROP,
        'circle-radius',
        backdropRadiusExpression() as never,
      );

      if (!schoolIndicator) {
        // BASELINE mode: non-PWC = faded slate-blue circle, PWC = category color
        // with a thin border (white for anchor/HA, blue for pwc_other).
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-color', BASELINE_FILL);
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-stroke-color', '#ffffff');
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-stroke-width', 1);
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-opacity', BASELINE_NONPWC_OPACITY);

        // Baseline view: PWC identity lives in the fill color, so no halo is
        // needed — just a thin white edge for separation, same as non-PWC
        // dots. The `pwcHalosVisible` toggle only matters in indicator mode
        // (where the colored stroke is the only PWC cue once fills become
        // indicator-color).
        map.setPaintProperty(LAYER_SCHOOLS_PWC, 'circle-color', PWC_BASELINE_FILL_EXPR as never);
        map.setPaintProperty(LAYER_SCHOOLS_PWC, 'circle-stroke-color', '#ffffff');
        map.setPaintProperty(LAYER_SCHOOLS_PWC, 'circle-stroke-width', 1);
        map.setPaintProperty(LAYER_SCHOOLS_PWC, 'circle-opacity', 0.95);

        map.setPaintProperty(LAYER_SCHOOLS_BACKDROP, 'circle-opacity', 1);
        return;
      }

      // INDICATOR mode: both PWC and non-PWC dots share the gradient fill so
      // values are comparable; PWC schools are flagged by a category-colored
      // border (magenta/green/blue). Schools with `value_num == null` render
      // as a hollow ring — for non-PWC the stroke is grey, for PWC the
      // stroke keeps its category color so "no data PWC" is still spotable.
      const schoolValueList: number[] = [];
      for (const f of schoolPoints.features) {
        const v = f.properties.value_num;
        if (typeof v === 'number' && Number.isFinite(v)) schoolValueList.push(v);
      }
      const bins = colorBinsFor(schoolIndicator, schoolPoints.domain, schoolValueList);
      const baseColorExpr = colorExpression(
        bins,
        schoolIndicator.scale.type === 'categorical'
          ? ['get', 'value_text']
          : ['get', 'value_num'],
      );
      const colorExpr: unknown = [
        'case',
        ['==', ['get', 'value_num'], null], TRANSPARENT,
        baseColorExpr,
      ];
      // Non-PWC stroke: grey for no-data, white for data.
      const nonPwcStrokeColor: unknown = [
        'case',
        ['==', ['get', 'value_num'], null], NO_DATA_STROKE,
        '#ffffff',
      ];
      const nonPwcStrokeWidth: unknown = [
        'case',
        ['==', ['get', 'value_num'], null], 1.5,
        1,
      ];

      map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-color', colorExpr as never);
      map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-stroke-color', nonPwcStrokeColor as never);
      map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-stroke-width', nonPwcStrokeWidth as never);
      // Indicator-mode fills are fully opaque so the new bolder ramp lands at
      // full saturation; the prior 0.85 alpha was washing out the mid-bins.
      map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-opacity', 1);

      // PWC: indicator-color fill, category-color stroke (always — even when
      // value is null, so the school stays visible as a colored ring).
      // When halos are toggled OFF, swap the category stroke for the same
      // grey/white stroke non-PWC dots use — PWC schools then read identically
      // to non-PWC at a glance.
      map.setPaintProperty(LAYER_SCHOOLS_PWC, 'circle-color', colorExpr as never);
      map.setPaintProperty(
        LAYER_SCHOOLS_PWC,
        'circle-stroke-color',
        (pwcHalosVisible ? PWC_INDICATOR_STROKE_EXPR : nonPwcStrokeColor) as never,
      );
      map.setPaintProperty(
        LAYER_SCHOOLS_PWC,
        'circle-stroke-width',
        (pwcHalosVisible ? PWC_BORDER_WIDTH : nonPwcStrokeWidth) as never,
      );
      map.setPaintProperty(LAYER_SCHOOLS_PWC, 'circle-opacity', 1);

      // Backdrop hidden for hollow no-data circles.
      map.setPaintProperty(
        LAYER_SCHOOLS_BACKDROP,
        'circle-opacity',
        [
          'case',
          ['==', ['get', 'value_num'], null], 0,
          1,
        ] as never,
      );
    };
    if (styleReadyRef.current) apply();
    else map.once('phase1-style-ready', apply);
  }, [schoolIndicator, schoolPoints, pwcHalosVisible]);

  // --- Combined filter (PWC + Phase 3 cascade) ---------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): void => {
      const dbns = filteredSchoolDbns;
      const inUniverse: unknown = dbns.size === 0
        ? true
        : ['in', ['get', 'dbn'], ['literal', [...dbns]]];
      const cascade = ['all', filterFor(schoolType), inUniverse];
      const nonPwcFilter = ['all', cascade, ['!=', ['get', 'is_pwc'], true]];
      const pwcFilter = ['all', cascade, ['==', ['get', 'is_pwc'], true]];
      if (map.getLayer(LAYER_SCHOOLS_BACKDROP)) {
        map.setFilter(LAYER_SCHOOLS_BACKDROP, cascade as never);
      }
      if (map.getLayer(LAYER_SCHOOLS_NONPWC)) {
        map.setFilter(LAYER_SCHOOLS_NONPWC, nonPwcFilter as never);
      }
      if (map.getLayer(LAYER_SCHOOLS_PWC)) {
        map.setFilter(LAYER_SCHOOLS_PWC, pwcFilter as never);
      }
    };
    if (styleReadyRef.current) apply();
    else map.once('phase1-style-ready', apply);
  }, [schoolType, filteredSchoolDbns]);

  // --- Selected-geographies overlay --------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): void => {
      const src = map.getSource(SOURCE_GEO_SELECTION) as GeoJSONSource | undefined;
      if (src) src.setData(geoSelection ?? EMPTY_FC);

      const tracts = geoSelection?.intersectingTractGeoids ?? [];
      const tractFilter: unknown = tracts.length === 0
        ? true
        : ['in', ['get', 'GEOID'], ['literal', tracts]];
      for (const id of [LAYER_TRACTS_FILL, LAYER_TRACTS_LINE]) {
        if (map.getLayer(id)) map.setFilter(id, tractFilter as never);
      }

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

  // --- flyTo when the user picks a school -------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToCoords) return;
    map.flyTo({
      center: [flyToCoords[0]!, flyToCoords[1]!],
      zoom: SELECTION_ZOOM,
      essential: true,
    });
  }, [flyToCoords]);

  // --- flyToView: restore a captured camera (Detail Panel X) ------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToView) return;
    map.flyTo({
      center: flyToView.center,
      zoom: flyToView.zoom,
      essential: true,
    });
  }, [flyToView]);

  // --- flyToBbox: fit cohort schools when the user picks a cohort -------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToBbox) return;
    map.fitBounds(
      [
        [flyToBbox[0], flyToBbox[1]],
        [flyToBbox[2], flyToBbox[3]],
      ],
      { padding: 80, maxZoom: 12, duration: 500 },
    );
  }, [flyToBbox]);

  // --- Report camera up on idle + once after init ----------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onViewChange) return;
    const report = (): void => {
      const c = map.getCenter();
      onViewChange({ center: [c.lng, c.lat], zoom: map.getZoom() });
    };
    const onIdle = (): void => report();
    map.on('idle', onIdle);
    if (styleReadyRef.current) report();
    else map.once('phase1-style-ready', report);
    return () => {
      map.off('idle', onIdle);
    };
  }, [onViewChange]);

  // --- Click handlers on school dots → open the Detail Panel ------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onSchoolClick) return;
    const SCHOOL_HIT_LAYERS = [LAYER_SCHOOLS_NONPWC, LAYER_SCHOOLS_PWC];
    const onClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }): void => {
      const f = e.features?.[0];
      const dbn = (f?.properties?.dbn as string | undefined) ?? null;
      if (dbn) onSchoolClick(dbn);
    };
    const onEnter = (): void => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const onLeave = (): void => {
      map.getCanvas().style.cursor = '';
    };
    const bind = (): void => {
      for (const id of SCHOOL_HIT_LAYERS) {
        if (!map.getLayer(id)) continue;
        map.on('click', id, onClick);
        map.on('mouseenter', id, onEnter);
        map.on('mouseleave', id, onLeave);
      }
    };
    if (styleReadyRef.current) bind();
    else map.once('phase1-style-ready', bind);
    return () => {
      for (const id of SCHOOL_HIT_LAYERS) {
        map.off('click', id, onClick);
        map.off('mouseenter', id, onEnter);
        map.off('mouseleave', id, onLeave);
      }
    };
  }, [onSchoolClick]);

  // --- Pulsing marker for the selected school ---------------------------
  const pulseMarkerRef = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (pulseMarkerRef.current) {
      pulseMarkerRef.current.remove();
      pulseMarkerRef.current = null;
    }
    if (!selectedSchool) return;
    const el = document.createElement('div');
    el.className = 'pwc-pulse';
    el.setAttribute('aria-hidden', 'true');
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(selectedSchool.coords)
      .addTo(map);
    pulseMarkerRef.current = marker;
    return () => {
      marker.remove();
      if (pulseMarkerRef.current === marker) pulseMarkerRef.current = null;
    };
  }, [selectedSchool]);

  // --- Community values: paint via feature-state, no source reload --------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = (): void => {
      if (!map.getSource(SOURCE_TRACTS)) return;
      map.removeFeatureState({ source: SOURCE_TRACTS });
      if (!communityIndicator || !communityValues) return;
      const communityValueList: number[] = [];
      for (const raw of Object.values(communityValues.values)) {
        if (typeof raw === 'number' && Number.isFinite(raw)) communityValueList.push(raw);
      }
      const bins = colorBinsFor(communityIndicator, communityValues.domain, communityValueList);
      const intensities = communityValues.intensities;

      for (const [geoid, raw] of Object.entries(communityValues.values)) {
        const color = colorFor(bins, raw);
        if (color == null) continue;
        const state: { v: number | string | null; color: string; opacity?: number } = {
          v: raw,
          color,
        };
        const intensity = intensities?.[geoid];
        if (typeof intensity === 'number' && Number.isFinite(intensity)) {
          const clamped = Math.max(25, Math.min(100, intensity));
          state.opacity = 0.3 + ((clamped - 25) / 75) * 0.55;
        }
        map.setFeatureState({ source: SOURCE_TRACTS, id: geoid }, state);
      }
    };

    if (styleReadyRef.current) apply();
    else map.once('phase1-style-ready', apply);
  }, [communityIndicator, communityValues]);

  return (
    <div
      style={{ position: 'absolute', inset: 0, background: '#f5f7fa' }}
      aria-label="Map of NYC"
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  );
}

/** Walk every coordinate in a selection FC and return [w, s, e, n]. */
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
 * MapLibre filter expression keyed off PWC flags. With the anchor-wins rule
 * both-category schools carry is_anchor=true and is_arts=false, so the
 * Healing Arts filter is a disjoint subset of PWC schools.
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
