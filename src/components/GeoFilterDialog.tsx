'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  GEO_FILTER_LAYERS,
  type GeoArea,
  type GeoFilterLayerId,
  type GeographiesResponse,
  type PwcMember,
  type SchoolMaster,
} from '../contract/types';
import type { GeoFilterMap } from '../store/useHubStore';
import { NYC_GEO_DISTRICTS, type AllowListLayer } from '../config/nycGeoDistricts';

interface Props {
  open: boolean;
  geographies: GeographiesResponse | null;
  /** Schools universe — used to compute per-area NYC-school counts. */
  schoolsMaster: SchoolMaster[];
  /** PWC membership for the latest available year — drives the "Matched PWC
   *  schools" column. Empty array when no PWC snapshot is loaded yet. */
  pwcMembers: PwcMember[];
  /** Latest PWC school_year (e.g. "2025-26") for the column header tooltip. */
  pwcYear: string | null;
  /** Current store value — used to initialize local working state. */
  initial: GeoFilterMap;
  onCancel: () => void;
  onApply: (next: GeoFilterMap) => void;
}

/**
 * Spec §6.1 — the ONLY filter with a popup dialog (due to breadth: 6 layers,
 * ~370 areas total). Local working state; Apply commits to the store, Cancel
 * discards, Reset clears local. Per-tab count badge so picks on hidden tabs
 * stay discoverable.
 */
export default function GeoFilterDialog({
  open,
  geographies,
  schoolsMaster,
  pwcMembers,
  pwcYear,
  initial,
  onCancel,
  onApply,
}: Props): React.JSX.Element | null {
  const [working, setWorking] = useState<GeoFilterMap>(initial);
  const [activeLayer, setActiveLayer] = useState<GeoFilterLayerId>('council');
  const [q, setQ] = useState('');
  /**
   * Sort key — defaults to district number (numerical), with a click on a
   * count column header switching to count-descending. Per-tab
   * (`sortByLayer[activeLayer]`) so flipping between tabs preserves intent.
   * Counties have no district number; we fall back to alphabetical-natural
   * sort there regardless of the chosen mode.
   */
  const [sortByLayer, setSortByLayer] = useState<
    Partial<Record<GeoFilterLayerId, 'district' | 'count' | 'pwc'>>
  >({});
  const sortBy = sortByLayer[activeLayer] ?? 'district';

  // Per-(layer, area_id) → count of NYC schools in that area. Lets us sort
  // populated districts first + grey 0-count ones. The same crosswalk we use
  // for the §6.6 map filter; no extra round-trip.
  const countsByLayer = useMemo(() => {
    const out: Record<GeoFilterLayerId, Map<string, number>> = {
      county: new Map(),
      senate: new Map(),
      assembly: new Map(),
      congressional: new Map(),
      council: new Map(),
      school_district: new Map(),
      community_district: new Map(),
      nta_2020: new Map(),
    };
    for (const s of schoolsMaster) {
      for (const layer of GEO_FILTER_LAYERS) {
        const area = s.geos[layer.id];
        if (!area) continue;
        const m = out[layer.id];
        m.set(area, (m.get(area) ?? 0) + 1);
      }
    }
    return out;
  }, [schoolsMaster]);

  // Per-(layer, area_id) → count of PWC schools (latest available year).
  // Derived by re-using the school↔geo crosswalk but restricted to the DBN
  // set in the PWC membership snapshot. "PWC school" here = any active
  // category — anchor, healing_arts, both, or pwc_other.
  const pwcCountsByLayer = useMemo(() => {
    const out: Record<GeoFilterLayerId, Map<string, number>> = {
      county: new Map(),
      senate: new Map(),
      assembly: new Map(),
      congressional: new Map(),
      council: new Map(),
      school_district: new Map(),
      community_district: new Map(),
      nta_2020: new Map(),
    };
    if (pwcMembers.length === 0) return out;
    const pwcDbns = new Set(pwcMembers.map((m) => m.dbn));
    for (const s of schoolsMaster) {
      if (!pwcDbns.has(s.dbn)) continue;
      for (const layer of GEO_FILTER_LAYERS) {
        const area = s.geos[layer.id];
        if (!area) continue;
        const m = out[layer.id];
        m.set(area, (m.get(area) ?? 0) + 1);
      }
    }
    return out;
  }, [pwcMembers, schoolsMaster]);

  // Reset working state every time the dialog re-opens.
  useEffect(() => {
    if (open) {
      setWorking(initial);
      setQ('');
    }
  }, [open, initial]);

  // ESC to cancel.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  // Hooks must run on every render — `useMemo` cannot sit after the
  // `if (!open) return null` guard below (Rules of Hooks).
  const rawLayerOptions: GeoArea[] = geographies?.layers[activeLayer] ?? [];
  // Apply NYC allow-list for Congressional / NYS Senate / NYS Assembly. Other
  // layers pass through unchanged. Config is metadata-driven — edit
  // `src/config/nycGeoDistricts.json` to change which districts appear.
  const layerOptions: GeoArea[] = useMemo(() => {
    if (!isAllowListLayer(activeLayer)) return rawLayerOptions;
    const allowed = NYC_GEO_DISTRICTS[activeLayer];
    return rawLayerOptions.filter((opt) => {
      const num = districtNumberFor(activeLayer, opt);
      return num != null && allowed.has(num);
    });
  }, [rawLayerOptions, activeLayer]);
  const layerCounts = countsByLayer[activeLayer];
  const layerPwcCounts = pwcCountsByLayer[activeLayer];
  // Populated areas first (descending by count); within a tier, natural-numeric
  // sort so "Council 2" lands before "Council 10" instead of after. 0-count
  // options stay pickable at the bottom per the agreed UX.
  const naturalCollator = useMemo(
    () => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }),
    [],
  );
  // Build a display row per area: a primary label (sortable, the district
  // number on Congressional) and an optional secondary (rep name). Other
  // layers leave secondary null — primary stays as opt.label.
  const decoratedOptions = useMemo(() => {
    return layerOptions.map((opt) => {
      const display = displayFor(activeLayer, opt);
      return { opt, display };
    });
  }, [layerOptions, activeLayer]);
  const filteredOptions = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const list = ql
      ? decoratedOptions.filter((d) =>
          d.display.primary.toLowerCase().includes(ql) ||
          (d.display.secondary?.toLowerCase().includes(ql) ?? false),
        )
      : decoratedOptions.slice();
    list.sort((a, b) => {
      if (sortBy === 'count') {
        const ca = layerCounts.get(a.opt.area_id) ?? 0;
        const cb = layerCounts.get(b.opt.area_id) ?? 0;
        if (ca !== cb) return cb - ca;
        // count tie → fall through to district-number tiebreak
      } else if (sortBy === 'pwc') {
        const pa = layerPwcCounts.get(a.opt.area_id) ?? 0;
        const pb = layerPwcCounts.get(b.opt.area_id) ?? 0;
        if (pa !== pb) return pb - pa;
        // PWC tie → fall through to district-number tiebreak
      }
      // Default mode (or tie-break under count mode): district number first,
      // then natural string compare on the primary label.
      const da = a.display.districtNum;
      const db = b.display.districtNum;
      if (da != null && db != null && da !== db) return da - db;
      return naturalCollator.compare(a.display.primary, b.display.primary);
    });
    return list;
  }, [decoratedOptions, layerCounts, layerPwcCounts, naturalCollator, q, sortBy]);

  if (!open) return null;

  const layerPicks = working[activeLayer] ?? [];

  function toggleArea(areaId: string): void {
    setWorking((prev) => {
      const cur = prev[activeLayer] ?? [];
      const next = cur.includes(areaId)
        ? cur.filter((a) => a !== areaId)
        : [...cur, areaId];
      return { ...prev, [activeLayer]: next };
    });
  }

  /** Drop every pick in `layer` — used by the per-tab clear-X affordance. */
  function clearLayer(layer: GeoFilterLayerId): void {
    setWorking((prev) => {
      if (!prev[layer] || prev[layer]!.length === 0) return prev;
      const next = { ...prev };
      delete next[layer];
      return next;
    });
  }

  function totalSelected(): number {
    let n = 0;
    for (const k of Object.keys(working) as GeoFilterLayerId[]) n += working[k]?.length ?? 0;
    return n;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Geographic filters"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,32,64,0.45)',
        zIndex: 100,
        display: 'grid',
        placeItems: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: 'white',
          width: 720,
          maxWidth: '90vw',
          // Fixed visual size regardless of which tab is active. Counties has
          // 5 rows; NYS Assembly has ~65 — without a locked height the modal
          // popped between tab clicks, which read as a layout bug. The inner
          // list scrolls within this envelope.
          height: 'min(620px, 85vh)',
          display: 'grid',
          gridTemplateRows: 'auto 1fr auto',
          borderRadius: 8,
          boxShadow: '0 12px 40px rgba(0,32,64,0.3)',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            padding: '12px 16px 8px',
            borderBottom: '1px solid #eef0f3',
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            rowGap: 6,
          }}
        >
          <strong style={{ color: '#002040' }}>Geographies</strong>
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: 18,
              gridRow: '1 / span 2',
              alignSelf: 'start',
            }}
            aria-label="Close"
          >
            ×
          </button>
          {/* Legend caption — explains the row coloring used in the list. */}
          <div
            style={{
              gridColumn: 1,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              fontSize: 11,
              color: '#467c9d',
            }}
          >
            <LegendKeyDot color="#002040" label="Has NYC schools" />
            <LegendKeyDot color="#a8b3bf" label="No NYC schools (greyed)" />
            <LegendKeyDot color="#903090" label="Has PWC schools" />
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', minHeight: 0 }}>
          {/* Tabs */}
          <nav
            style={{
              borderRight: '1px solid #eef0f3',
              background: '#f7f9fb',
              padding: 8,
              overflowY: 'auto',
            }}
            aria-label="Layer tabs"
          >
            {GEO_FILTER_LAYERS.map((layer) => {
              const n = working[layer.id]?.length ?? 0;
              const active = activeLayer === layer.id;
              return (
                <div
                  key={layer.id}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: 2,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveLayer(layer.id);
                      setQ('');
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 8px',
                      paddingRight: n > 0 ? 48 : 8,
                      fontSize: 12,
                      border: '1px solid transparent',
                      borderRadius: 4,
                      background: active ? '#027BC0' : 'transparent',
                      color: active ? 'white' : '#002040',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>{layer.label}</span>
                    {n > 0 ? (
                      <span
                        style={{
                          background: active ? 'white' : '#027BC0',
                          color: active ? '#027BC0' : 'white',
                          borderRadius: 10,
                          padding: '0 6px',
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {n}
                      </span>
                    ) : null}
                  </button>
                  {n > 0 ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearLayer(layer.id);
                      }}
                      title={`Clear ${layer.label} filters`}
                      aria-label={`Clear ${layer.label} filters`}
                      style={{
                        position: 'absolute',
                        right: 4,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: active ? 'white' : '#467c9d',
                        fontSize: 14,
                        lineHeight: 1,
                        padding: '2px 4px',
                        borderRadius: 3,
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
          </nav>

          {/* List */}
          <section style={{ padding: 12, display: 'grid', gridTemplateRows: 'auto auto 1fr', minHeight: 0 }}>
            <input
              type="text"
              placeholder={`Search ${labelOf(activeLayer)}…`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{
                width: '100%',
                padding: '4px 6px',
                fontSize: 12,
                border: '1px solid #c5cdd6',
                borderRadius: 4,
                marginBottom: 8,
              }}
            />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                gap: 16,
                alignItems: 'baseline',
                padding: '0 4px 4px 4px',
                fontSize: 10,
                color: '#467c9d',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                fontWeight: 700,
                borderBottom: '1px solid #eef0f3',
                marginBottom: 4,
              }}
            >
              <SortHeader
                label={labelOf(activeLayer)}
                active={sortBy === 'district'}
                onClick={() =>
                  setSortByLayer((prev) => ({ ...prev, [activeLayer]: 'district' }))
                }
              />
              <SortHeader
                label="Matched Schools"
                active={sortBy === 'count'}
                onClick={() =>
                  setSortByLayer((prev) => ({ ...prev, [activeLayer]: 'count' }))
                }
              />
              <SortHeader
                label={pwcYear ? `PWC Schools (${pwcYear})` : 'PWC Schools'}
                active={sortBy === 'pwc'}
                onClick={() =>
                  setSortByLayer((prev) => ({ ...prev, [activeLayer]: 'pwc' }))
                }
              />
            </div>
            <div style={{ overflowY: 'auto', minHeight: 0 }}>
              {filteredOptions.length === 0 ? (
                <div style={{ fontSize: 11, color: '#999' }}>No matches.</div>
              ) : null}
              {filteredOptions.map(({ opt, display }) => {
                const picked = layerPicks.includes(opt.area_id);
                const count = layerCounts.get(opt.area_id) ?? 0;
                const pwcCount = layerPwcCounts.get(opt.area_id) ?? 0;
                const empty = count === 0;
                const titleParts = [
                  empty ? 'No NYC schools in this district' : `${count} NYC schools`,
                  pwcCount > 0
                    ? `${pwcCount} PWC school${pwcCount === 1 ? '' : 's'}${pwcYear ? ` (${pwcYear})` : ''}`
                    : null,
                ].filter(Boolean) as string[];
                return (
                  <label
                    key={opt.area_id}
                    title={titleParts.join(' · ')}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto auto',
                      gap: 8,
                      alignItems: 'center',
                      padding: '3px 4px',
                      fontSize: 12,
                      cursor: 'pointer',
                      borderRadius: 3,
                      background: picked ? '#eef4f8' : 'transparent',
                      color: empty ? '#a8b3bf' : '#002040',
                    }}
                  >
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={picked}
                        onChange={() => toggleArea(opt.area_id)}
                      />
                      <span>{display.primary}</span>
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: empty ? '#c5cdd6' : '#467c9d',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {display.secondary ?? ''}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: empty ? '#c5cdd6' : '#467c9d',
                        minWidth: 28,
                        textAlign: 'right',
                      }}
                    >
                      ({count})
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        // PWC count colored when non-zero, greyed when zero.
                        color: pwcCount > 0 ? '#903090' : '#c5cdd6',
                        fontWeight: pwcCount > 0 ? 600 : 400,
                        minWidth: 28,
                        textAlign: 'right',
                      }}
                    >
                      ({pwcCount})
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        </div>

        <footer
          style={{
            borderTop: '1px solid #eef0f3',
            padding: '10px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#f7f9fb',
          }}
        >
          <div style={{ fontSize: 11, color: '#467c9d' }}>
            {totalSelected() === 0 ? 'No selections' : `${totalSelected()} selected across layers`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setWorking({})}
              style={btnStyle('ghost')}
            >
              Reset
            </button>
            <button type="button" onClick={onCancel} style={btnStyle('ghost')}>
              Cancel
            </button>
            <button type="button" onClick={() => onApply(working)} style={btnStyle('primary')}>
              Apply
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function labelOf(id: GeoFilterLayerId): string {
  return GEO_FILTER_LAYERS.find((l) => l.id === id)?.label ?? id;
}

function isAllowListLayer(id: GeoFilterLayerId): id is AllowListLayer {
  return id === 'congressional' || id === 'senate' || id === 'assembly';
}

function LegendKeyDot({
  color,
  label,
}: {
  color: string;
  label: string;
}): React.JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
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
      <span>{label}</span>
    </span>
  );
}

function SortHeader({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        font: 'inherit',
        textTransform: 'inherit',
        letterSpacing: 'inherit',
        color: active ? '#027BC0' : '#467c9d',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
      title={`Sort by ${label.toLowerCase()}`}
    >
      <span>{label}</span>
      <span aria-hidden style={{ fontSize: 8, opacity: active ? 1 : 0.4 }}>▼</span>
    </button>
  );
}

interface AreaDisplay {
  /** Sortable primary string shown leftmost (after the checkbox). */
  primary: string;
  /** Sortable district number for natural-numeric sort independent of the
   *  primary string format. Null when the layer isn't district-numeric. */
  districtNum: number | null;
  /** Optional secondary string shown in a subdued middle column.
   *  Currently surfaced for layers whose source carries rep info:
   *  Congressional (label = rep), Assembly (attributes.Name + Party). */
  secondary: string | null;
}

/**
 * Per-layer display decomposition. Every numeric district layer gets a
 * uniform "District N" primary so the list reads 1, 2, … 26 instead of the
 * varied raw forms ("State Senate District 1", "1", "3601"). Counties keep
 * their native label ("Bronx County"). When the source provides a rep name,
 * it lands in the secondary column and participates in search.
 */
function displayFor(layer: GeoFilterLayerId, opt: GeoArea): AreaDisplay {
  if (layer === 'county') {
    return { primary: opt.label, districtNum: null, secondary: null };
  }
  const districtNum = districtNumberFor(layer, opt);
  const primary = districtNum != null ? `District ${districtNum}` : opt.label;
  const secondary = secondaryFor(layer, opt);
  return { primary, districtNum, secondary };
}

function districtNumberFor(layer: GeoFilterLayerId, opt: GeoArea): number | null {
  switch (layer) {
    case 'congressional': {
      // STFIPS+CDFIPS — '3613' → 13.
      const tail = opt.area_id.length > 2 ? opt.area_id.slice(2) : opt.area_id;
      const n = Number.parseInt(tail, 10);
      return Number.isFinite(n) ? n : null;
    }
    case 'senate': {
      // Label like "State Senate District 14"; trail-parse the number.
      const m = /(\d+)\s*$/.exec(opt.label);
      return m ? Number.parseInt(m[1]!, 10) : null;
    }
    case 'assembly':
    case 'council':
    case 'school_district':
    case 'community_district': {
      // area_id is the district number as a plain digit string.
      const n = Number.parseInt(opt.area_id, 10);
      return Number.isFinite(n) ? n : null;
    }
    default:
      return null;
  }
}

function secondaryFor(layer: GeoFilterLayerId, opt: GeoArea): string | null {
  if (layer === 'congressional') {
    // Congressional source delivers rep name in `label`.
    const num = districtNumberFor(layer, opt);
    if (num != null && opt.label && opt.label !== opt.area_id && opt.label !== String(num)) {
      return opt.label;
    }
    return null;
  }
  if (layer === 'assembly') {
    const a = opt.attributes ?? {};
    const name = a['Name']?.trim();
    if (!name) return null;
    const party = a['Party']?.trim();
    return party ? `${name} (${party})` : name;
  }
  return null;
}

function btnStyle(kind: 'primary' | 'ghost'): React.CSSProperties {
  if (kind === 'primary') {
    return {
      background: '#027BC0',
      color: 'white',
      border: '1px solid #027BC0',
      borderRadius: 4,
      padding: '4px 12px',
      fontSize: 12,
      cursor: 'pointer',
      fontWeight: 600,
    };
  }
  return {
    background: 'white',
    color: '#002040',
    border: '1px solid #c5cdd6',
    borderRadius: 4,
    padding: '4px 12px',
    fontSize: 12,
    cursor: 'pointer',
  };
}
