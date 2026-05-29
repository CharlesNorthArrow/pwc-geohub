'use client';

import { useEffect, useRef } from 'react';
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type StyleSpecification,
} from 'maplibre-gl';

import type {
  CommunityResponse,
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
}

const NYC_BOUNDS: [number, number, number, number] = [-74.27, 40.49, -73.68, 40.92];

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };

const SOURCE_SCHOOLS = 'schools';
const SOURCE_TRACTS = 'tracts';
const LAYER_TRACTS_FILL = 'tracts-fill';
const LAYER_TRACTS_LINE = 'tracts-line';
const LAYER_HALO_OUTER = 'schools-halo-outer'; // Healing Arts (or both)
const LAYER_HALO_INNER = 'schools-halo-inner'; // Anchor (or both) / pwc_other
const LAYER_SCHOOLS = 'schools-circles';

/* PWC halo colors — pulled from the brand palette in CLAUDE.md. */
const PWC_MAGENTA = '#903090'; // Anchor
const PWC_ORANGE = '#F0901F'; // Healing Arts
const PWC_BLUE = '#027BC0';   // pwc_other (program-active, not anchor/arts)
const TRANSPARENT = 'rgba(0,0,0,0)';

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

      // Halo (outer) — Healing Arts or Both. Drawn first so it sits BELOW
      // the inner halo + data point. Radius = data radius + 7px.
      map.addLayer({
        id: LAYER_HALO_OUTER,
        type: 'circle',
        source: SOURCE_SCHOOLS,
        paint: {
          'circle-color': TRANSPARENT,
          'circle-radius': 4,
          'circle-stroke-color': TRANSPARENT,
          'circle-stroke-width': 0,
          'circle-stroke-opacity': 0.9,
        },
      });
      // Halo (inner) — Anchor or Both (magenta), or pwc_other (thin blue).
      // Radius = data radius + 3px.
      map.addLayer({
        id: LAYER_HALO_INNER,
        type: 'circle',
        source: SOURCE_SCHOOLS,
        paint: {
          'circle-color': TRANSPARENT,
          'circle-radius': 4,
          'circle-stroke-color': TRANSPARENT,
          'circle-stroke-width': 0,
          'circle-stroke-opacity': 0.9,
        },
      });
      // Phase 1 data point — sits on top of both halos.
      map.addLayer({
        id: LAYER_SCHOOLS,
        type: 'circle',
        source: SOURCE_SCHOOLS,
        paint: {
          'circle-color': '#cccccc',
          'circle-radius': 4,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
          'circle-opacity': 0.85,
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
        LAYER_SCHOOLS, // beneath the points
      );
      map.addLayer(
        {
          id: LAYER_TRACTS_LINE,
          type: 'line',
          source: SOURCE_TRACTS,
          paint: { 'line-color': 'rgba(0,0,0,0.15)', 'line-width': 0.3 },
        },
        LAYER_SCHOOLS,
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
      if (!schoolIndicator || !schoolPoints || schoolPoints.features.length === 0) {
        source.setData(EMPTY_FC);
        map.setPaintProperty(LAYER_SCHOOLS, 'circle-color', '#cccccc');
        map.setPaintProperty(LAYER_SCHOOLS, 'circle-radius', 4);
        // Hide halos when no points.
        map.setPaintProperty(LAYER_HALO_INNER, 'circle-stroke-width', 0);
        map.setPaintProperty(LAYER_HALO_OUTER, 'circle-stroke-width', 0);
        return;
      }
      source.setData(schoolPoints);
      const bins = colorBinsFor(schoolIndicator, schoolPoints.domain);
      map.setPaintProperty(
        LAYER_SCHOOLS,
        'circle-color',
        colorExpression(
          bins,
          schoolIndicator.scale.type === 'categorical'
            ? ['get', 'value_text']
            : ['get', 'value_num'],
        ) as never,
      );
      const dataRadius = radiusExpression() as unknown;
      map.setPaintProperty(LAYER_SCHOOLS, 'circle-radius', dataRadius as never);

      // Halo radii = data radius + offset, so size stays comparable.
      map.setPaintProperty(
        LAYER_HALO_INNER,
        'circle-radius',
        ['+', dataRadius, 3] as never,
      );
      map.setPaintProperty(
        LAYER_HALO_OUTER,
        'circle-radius',
        ['+', dataRadius, 7] as never,
      );

      // Inner halo: Anchor / Both = magenta 2px; pwc_other = blue 1.5px.
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
      map.setPaintProperty(
        LAYER_HALO_INNER,
        'circle-stroke-width',
        [
          'case',
          ['==', ['get', 'is_anchor'], true], 2,
          ['==', ['get', 'pwc_other'], true], 1.5,
          0,
        ] as never,
      );

      // Outer halo: Healing Arts / Both = orange 2px.
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
      const combined = ['all', filterFor(schoolType), inUniverse];
      for (const id of [LAYER_HALO_OUTER, LAYER_HALO_INNER, LAYER_SCHOOLS]) {
        if (map.getLayer(id)) map.setFilter(id, combined as never);
      }
    };
    if (styleReadyRef.current) apply();
    else map.once('phase1-style-ready', apply);
  }, [schoolType, filteredSchoolDbns]);

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

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, background: '#f5f7fa' }}
      aria-label="Map of NYC"
    />
  );
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
