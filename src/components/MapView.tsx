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
  buildAnchorStarSdf,
  buildHealingDiamondSdf,
  colorBinsFor,
  colorExpression,
  iconSizeExpression,
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
   *  Shell clears after MapView consumes it so subsequent pan/zoom isn't
   *  snapped back. */
  flyToBbox: [number, number, number, number] | null;
  /** Latest camera observed by `idle` — Shell holds a ref for capture/restore.
   *  Fires once on init and on every settle. */
  onViewChange?: (view: { center: [number, number]; zoom: number }) => void;
  /** Click on any school dot (PWC or non-PWC, indicator or baseline) — fires
   *  with the school's DBN. Shell wires this to `setSelectedSchool`, which
   *  is the same path the School filter + ranked list use. */
  onSchoolClick?: (dbn: string) => void;
  /** Currently-selected school's coords + DBN — drives the pulsing marker.
   *  Null when no school is selected or the selected one is unplottable. */
  selectedSchool?: { dbn: string; coords: [number, number] } | null;
  /** Phase 3 polish — polygons of the currently-selected Geo filter areas.
   *  Drawn as a line-only outline above tracts, below the school layers. */
  geoSelection: GeoSelectionResponse | null;
}

/** NTA-level zoom — frames the surrounding neighborhood. Used by both the
 *  School filter pick and the School Detail Panel open path so the framing
 *  stays consistent. */
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

/* School-point layer stack — non-PWC paints first (bottom), then pwc_other
 * circles, then symbol layers (diamond, star) on top so PWC schools dominate
 * dense clusters. Splitting by category via per-layer filters is more
 * reliable than `circle-sort-key`, which only orders inside a single layer.
 * The backdrop sits below everything to add a soft shadow under circles. */
const LAYER_SCHOOLS_BACKDROP = 'schools-backdrop';
const LAYER_SCHOOLS_NONPWC = 'schools-circles-nonpwc';
const LAYER_SCHOOLS_PWC_OTHER = 'schools-circles-pwc-other';
const LAYER_SCHOOLS_HEALING = 'schools-symbol-healing';
const LAYER_SCHOOLS_ANCHOR = 'schools-symbol-anchor';

const ICON_STAR = 'pwc-star';
const ICON_DIAMOND = 'pwc-diamond';

/* PWC brand colors — kept in lockstep with the Legend component. Healing
 * Arts now uses PWC green (#A0B000) instead of the previous orange — the
 * orange remains the community-family theming, not a PWC group color. */
const PWC_MAGENTA = '#903090'; // Anchor (includes both-category)
const PWC_GREEN = '#A0B000';   // Healing Arts only (pure HA, no anchor overlap)
const PWC_BLUE = '#027BC0';    // pwc_other (program-active, not anchor/arts)
const TRANSPARENT = 'rgba(0,0,0,0)';

/** Muted slate-blue for non-PWC schools in baseline mode — clearly blue
 *  but soft enough to recede behind the colored PWC dots. Paired with
 *  `BASELINE_NONPWC_OPACITY` below for the final on-map look. */
const BASELINE_FILL = '#7BA7C9';
const BASELINE_NONPWC_OPACITY = 0.4;

/** Stroke for "no data" schools (indicator mode) — medium neutral grey on a
 *  transparent fill, so the absence-of-fill is the only "no data" cue. Same
 *  grey appears in the legend's NoDataRow. Circles WITH data keep the white
 *  stroke that reads cleanly against any indicator color. */
const NO_DATA_STROKE = '#7a8896';

/** Drop shadow behind every visible school dot — bumped from the prior
 *  0.22 alpha to make the shadow legible against light basemap tiles.
 *  Paired with circle-blur 0.7 + a +2 px radius offset below. */
const BACKDROP_FILL = 'rgba(0, 32, 64, 0.45)';

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
  flyToView,
  flyToBbox,
  onViewChange,
  onSchoolClick,
  selectedSchool,
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
      // Register SDF icons for the Anchor star + Healing-Arts diamond. Built
      // once on canvas — see src/map/encoding.ts for the SDF generator. Must
      // be added BEFORE the symbol layers that reference them by name.
      if (!map.hasImage(ICON_STAR)) {
        map.addImage(ICON_STAR, buildAnchorStarSdf(), { sdf: true });
      }
      if (!map.hasImage(ICON_DIAMOND)) {
        map.addImage(ICON_DIAMOND, buildHealingDiamondSdf(), { sdf: true });
      }

      // Empty sources/layers up-front; populated by the effects below.
      map.addSource(SOURCE_SCHOOLS, { type: 'geojson', data: EMPTY_FC });

      // Selected-geographies overlay — drawn ABOVE tracts (so users can read
      // boundaries against the choropleth) but BELOW school points.
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
      //   0. backdrop       (soft dark shadow behind every CIRCLE-rendered dot)
      //   1. non-PWC dots
      //   2. pwc_other dots (blue halo via stroke)
      //   3. Healing-Arts diamond symbol (SDF)
      //   4. Anchor star symbol           (SDF) — on top so Anchor reads first
      map.addLayer({
        id: LAYER_SCHOOLS_BACKDROP,
        type: 'circle',
        source: SOURCE_SCHOOLS,
        // Backdrop only paints under circle-rendered schools — symbol icons
        // (anchor/HA) cover the center themselves and the dark circle peeks
        // through their tips/corners otherwise.
        filter: ['all', ['!=', ['get', 'is_anchor'], true], ['!=', ['get', 'is_arts'], true]],
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
        id: LAYER_SCHOOLS_PWC_OTHER,
        type: 'circle',
        source: SOURCE_SCHOOLS,
        // pwc_other: PWC-affiliated but neither core_school nor arts_program.
        // Stays a circle (no special shape) but keeps a blue stroke so users
        // can still spot it as part of the PWC network on the map.
        filter: ['==', ['get', 'pwc_other'], true],
        paint: {
          'circle-color': PWC_BLUE,
          'circle-radius': 4,
          'circle-stroke-color': PWC_BLUE,
          'circle-stroke-width': 2,
          'circle-opacity': 0.95,
        },
      });
      map.addLayer({
        id: LAYER_SCHOOLS_HEALING,
        type: 'symbol',
        source: SOURCE_SCHOOLS,
        // is_arts is now disjoint from is_anchor (Shell sets is_arts only when
        // pure healing-arts), so the filter doesn't need an `!is_anchor` guard.
        filter: ['==', ['get', 'is_arts'], true],
        layout: {
          'icon-image': ICON_DIAMOND,
          'icon-size': 1,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': PWC_GREEN,
          'icon-halo-color': '#ffffff',
          'icon-halo-width': 2,
        },
      });
      map.addLayer({
        id: LAYER_SCHOOLS_ANCHOR,
        type: 'symbol',
        source: SOURCE_SCHOOLS,
        filter: ['==', ['get', 'is_anchor'], true],
        layout: {
          'icon-image': ICON_STAR,
          'icon-size': 1,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': PWC_MAGENTA,
          'icon-halo-color': '#ffffff',
          'icon-halo-width': 2,
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
            // Categorical indicators with `intensities` (racial_predominance)
            // set a per-feature opacity in [0.3, 0.85]; sequential indicators
            // leave it unset and fall back to the default 0.65.
            'fill-opacity': [
              'case',
              ['==', ['feature-state', 'v'], null], 0,
              ['coalesce', ['feature-state', 'opacity'], 0.65],
            ],
          },
        },
        LAYER_SCHOOLS_BACKDROP, // beneath every school layer (incl. backdrop)
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
        // Reset paint when there are no features — avoids stale expressions
        // showing through when a fresh dataset arrives later.
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-color', '#cccccc');
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-radius', 4);
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-stroke-color', '#ffffff');
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-stroke-width', 1);
        map.setPaintProperty(LAYER_SCHOOLS_PWC_OTHER, 'circle-color', PWC_BLUE);
        map.setPaintProperty(LAYER_SCHOOLS_PWC_OTHER, 'circle-radius', 4);
        map.setPaintProperty(LAYER_SCHOOLS_PWC_OTHER, 'circle-stroke-color', PWC_BLUE);
        map.setPaintProperty(LAYER_SCHOOLS_PWC_OTHER, 'circle-stroke-width', 2);
        map.setPaintProperty(LAYER_SCHOOLS_BACKDROP, 'circle-opacity', 0);
        return;
      }
      source.setData(schoolPoints);
      const dataRadius = radiusExpression() as unknown;
      const iconSize = iconSizeExpression() as unknown;

      // Symbol icon-size mirrors the circle radius curve so star/diamond
      // schools size with enrollment + zoom just like circles do.
      map.setLayoutProperty(LAYER_SCHOOLS_ANCHOR, 'icon-size', iconSize as never);
      map.setLayoutProperty(LAYER_SCHOOLS_HEALING, 'icon-size', iconSize as never);

      // Backdrop radius is 2 px wider than the data dot so a soft drop
      // shadow peeks out from behind the circle. Backdrop layer is filtered
      // to circle-rendered features only (symbols don't need a shadow).
      map.setPaintProperty(
        LAYER_SCHOOLS_BACKDROP,
        'circle-radius',
        backdropRadiusExpression() as never,
      );

      if (!schoolIndicator) {
        /* -------------------- BASELINE mode (no indicator) --------------------
         * Non-PWC: faded slate-blue circle, white stroke
         * pwc_other: PWC blue circle, blue stroke (per user — keeps blue halo)
         * Anchor: solid magenta star with white border (SDF halo)
         * Healing Arts: solid green diamond with white border (SDF halo) */
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-color', BASELINE_FILL);
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-radius', dataRadius as never);
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-stroke-color', '#ffffff');
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-stroke-width', 1);
        map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-opacity', BASELINE_NONPWC_OPACITY);

        map.setPaintProperty(LAYER_SCHOOLS_PWC_OTHER, 'circle-color', PWC_BLUE);
        map.setPaintProperty(LAYER_SCHOOLS_PWC_OTHER, 'circle-radius', dataRadius as never);
        map.setPaintProperty(LAYER_SCHOOLS_PWC_OTHER, 'circle-stroke-color', PWC_BLUE);
        map.setPaintProperty(LAYER_SCHOOLS_PWC_OTHER, 'circle-stroke-width', 2);
        map.setPaintProperty(LAYER_SCHOOLS_PWC_OTHER, 'circle-opacity', 0.95);

        map.setPaintProperty(LAYER_SCHOOLS_ANCHOR, 'icon-color', PWC_MAGENTA);
        map.setPaintProperty(LAYER_SCHOOLS_ANCHOR, 'icon-halo-color', '#ffffff');
        map.setPaintProperty(LAYER_SCHOOLS_ANCHOR, 'icon-halo-width', 2);

        map.setPaintProperty(LAYER_SCHOOLS_HEALING, 'icon-color', PWC_GREEN);
        map.setPaintProperty(LAYER_SCHOOLS_HEALING, 'icon-halo-color', '#ffffff');
        map.setPaintProperty(LAYER_SCHOOLS_HEALING, 'icon-halo-width', 2);

        map.setPaintProperty(LAYER_SCHOOLS_BACKDROP, 'circle-opacity', 1);
        return;
      }

      /* -------------------- INDICATOR mode --------------------
       * All four layers share the same indicator-color expression so values
       * are comparable across families. Schools with `value_num == null` use
       * a hollow style (transparent fill, group-colored outline) so they
       * read as "PWC school, no data" rather than "lowest-bin color."
       *   - Non-PWC circle: indicator color + white stroke (or grey for no-data)
       *   - pwc_other circle: indicator color + BLUE stroke (keeps PWC cue)
       *   - Anchor star: indicator color icon + magenta halo (= original border)
       *   - HA diamond:  indicator color icon + green halo */
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
      map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-radius', dataRadius as never);
      map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-stroke-color', nonPwcStrokeColor as never);
      map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-stroke-width', nonPwcStrokeWidth as never);
      map.setPaintProperty(LAYER_SCHOOLS_NONPWC, 'circle-opacity', 0.85);

      // pwc_other always shows the blue halo, even in no-data state, so users
      // can spot PWC-affiliated schools in the indicator view.
      map.setPaintProperty(LAYER_SCHOOLS_PWC_OTHER, 'circle-color', colorExpr as never);
      map.setPaintProperty(LAYER_SCHOOLS_PWC_OTHER, 'circle-radius', dataRadius as never);
      map.setPaintProperty(LAYER_SCHOOLS_PWC_OTHER, 'circle-stroke-color', PWC_BLUE);
      map.setPaintProperty(LAYER_SCHOOLS_PWC_OTHER, 'circle-stroke-width', 2);
      map.setPaintProperty(LAYER_SCHOOLS_PWC_OTHER, 'circle-opacity', 0.95);

      // Symbol layers: icon-color = indicator color (or transparent for
      // no-data, leaving just the halo to read as a hollow outline).
      map.setPaintProperty(LAYER_SCHOOLS_ANCHOR, 'icon-color', colorExpr as never);
      map.setPaintProperty(LAYER_SCHOOLS_ANCHOR, 'icon-halo-color', PWC_MAGENTA);
      map.setPaintProperty(LAYER_SCHOOLS_ANCHOR, 'icon-halo-width', 2);

      map.setPaintProperty(LAYER_SCHOOLS_HEALING, 'icon-color', colorExpr as never);
      map.setPaintProperty(LAYER_SCHOOLS_HEALING, 'icon-halo-color', PWC_GREEN);
      map.setPaintProperty(LAYER_SCHOOLS_HEALING, 'icon-halo-width', 2);

      // Backdrop hidden for hollow no-data circles (otherwise the dark
      // shadow shows THROUGH the hollow center).
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
        ? true
        : ['in', ['get', 'dbn'], ['literal', [...dbns]]];
      const cascade = ['all', filterFor(schoolType), inUniverse];
      // Each layer KEEPS its category predicate so the four buckets paint
      // separately. Intersect cascade with that predicate.
      const nonPwcFilter = ['all', cascade, ['!=', ['get', 'is_pwc'], true]];
      const pwcOtherFilter = ['all', cascade, ['==', ['get', 'pwc_other'], true]];
      const anchorFilter = ['all', cascade, ['==', ['get', 'is_anchor'], true]];
      const healingFilter = ['all', cascade, ['==', ['get', 'is_arts'], true]];
      // Backdrop matches circles only (non-PWC + pwc_other) — symbol layers
      // don't need a drop shadow.
      const backdropFilter = ['all', cascade,
        ['!=', ['get', 'is_anchor'], true],
        ['!=', ['get', 'is_arts'], true],
      ];
      if (map.getLayer(LAYER_SCHOOLS_BACKDROP)) {
        map.setFilter(LAYER_SCHOOLS_BACKDROP, backdropFilter as never);
      }
      if (map.getLayer(LAYER_SCHOOLS_NONPWC)) {
        map.setFilter(LAYER_SCHOOLS_NONPWC, nonPwcFilter as never);
      }
      if (map.getLayer(LAYER_SCHOOLS_PWC_OTHER)) {
        map.setFilter(LAYER_SCHOOLS_PWC_OTHER, pwcOtherFilter as never);
      }
      if (map.getLayer(LAYER_SCHOOLS_ANCHOR)) {
        map.setFilter(LAYER_SCHOOLS_ANCHOR, anchorFilter as never);
      }
      if (map.getLayer(LAYER_SCHOOLS_HEALING)) {
        map.setFilter(LAYER_SCHOOLS_HEALING, healingFilter as never);
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
  // SELECTION_ZOOM = 13 (NTA level) for both the School filter pick AND the
  // Detail Panel open path — same framing for both selection surfaces.
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
  // All four school dot layers (non-PWC circle, pwc_other circle, healing
  // diamond symbol, anchor star symbol) carry the same `dbn` property.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onSchoolClick) return;
    const SCHOOL_HIT_LAYERS = [
      LAYER_SCHOOLS_NONPWC,
      LAYER_SCHOOLS_PWC_OTHER,
      LAYER_SCHOOLS_HEALING,
      LAYER_SCHOOLS_ANCHOR,
    ];
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
          // Map [25, 100] → [0.3, 0.85]. With 4 categories the predominant
          // share is mathematically ≥ 25%, so this anchors weak majorities
          // near the floor and strong majorities near the ceiling.
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
 * school feature (`is_pwc`, `is_anchor`, `is_arts`). With the anchor-wins
 * rule both-category schools carry is_anchor=true and is_arts=false, so
 * the Healing Arts filter is a disjoint subset of PWC schools.
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
