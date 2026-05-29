'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  GEO_FILTER_LAYERS,
  type GeoArea,
  type GeoFilterLayerId,
  type GeographiesResponse,
  type SchoolMaster,
} from '../contract/types';
import type { GeoFilterMap } from '../store/useHubStore';

interface Props {
  open: boolean;
  geographies: GeographiesResponse | null;
  /** Schools universe — used to compute per-area NYC-school counts. */
  schoolsMaster: SchoolMaster[];
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
  initial,
  onCancel,
  onApply,
}: Props): React.JSX.Element | null {
  const [working, setWorking] = useState<GeoFilterMap>(initial);
  const [activeLayer, setActiveLayer] = useState<GeoFilterLayerId>('council');
  const [q, setQ] = useState('');

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
  const layerOptions: GeoArea[] = geographies?.layers[activeLayer] ?? [];
  const layerCounts = countsByLayer[activeLayer];
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
      const ca = layerCounts.get(a.opt.area_id) ?? 0;
      const cb = layerCounts.get(b.opt.area_id) ?? 0;
      if (ca !== cb) return cb - ca;
      return naturalCollator.compare(a.display.primary, b.display.primary);
    });
    return list;
  }, [decoratedOptions, layerCounts, naturalCollator, q]);

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
          maxHeight: '85vh',
          display: 'grid',
          gridTemplateRows: 'auto 1fr auto',
          borderRadius: 8,
          boxShadow: '0 12px 40px rgba(0,32,64,0.3)',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #eef0f3',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <strong style={{ color: '#002040' }}>Geographies</strong>
          <button
            type="button"
            onClick={onCancel}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18 }}
            aria-label="Close"
          >
            ×
          </button>
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
                <button
                  key={layer.id}
                  type="button"
                  onClick={() => {
                    setActiveLayer(layer.id);
                    setQ('');
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 8px',
                    fontSize: 12,
                    border: '1px solid transparent',
                    borderRadius: 4,
                    background: active ? '#027BC0' : 'transparent',
                    color: active ? 'white' : '#002040',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 2,
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
                display: 'flex',
                justifyContent: 'space-between',
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
              <span>{labelOf(activeLayer)}</span>
              <span>Matched Districts</span>
            </div>
            <div style={{ overflowY: 'auto', minHeight: 0 }}>
              {filteredOptions.length === 0 ? (
                <div style={{ fontSize: 11, color: '#999' }}>No matches.</div>
              ) : null}
              {filteredOptions.map(({ opt, display }) => {
                const picked = layerPicks.includes(opt.area_id);
                const count = layerCounts.get(opt.area_id) ?? 0;
                const empty = count === 0;
                return (
                  <label
                    key={opt.area_id}
                    title={empty ? 'No NYC schools in this district' : `${count} NYC schools`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto',
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
                    <span style={{ fontSize: 10, color: empty ? '#c5cdd6' : '#467c9d' }}>
                      ({count})
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

interface AreaDisplay {
  /** Sortable primary string shown leftmost (after the checkbox). */
  primary: string;
  /** Optional secondary string shown in a subdued middle column. */
  secondary: string | null;
}

/**
 * Per-layer display decomposition. Congressional gets a two-column treatment:
 * district number leads (so the list reads 1, 2, … 26) and the rep name sits
 * to its right as a secondary label that participates in search. Other layers
 * keep the existing label as primary and have no secondary.
 *
 * Congressional `area_id` is STFIPS+CDFIPS — e.g. NY District 13 = '3613'. We
 * peel off the leading state FIPS ('36') to reveal the district number.
 */
function displayFor(layer: GeoFilterLayerId, opt: GeoArea): AreaDisplay {
  if (layer === 'congressional') {
    const districtNum = stripStateFips(opt.area_id);
    return {
      primary: `District ${districtNum}`,
      secondary: opt.label && opt.label !== opt.area_id ? opt.label : null,
    };
  }
  return { primary: opt.label, secondary: null };
}

function stripStateFips(areaId: string): string {
  // NY congressional area_ids are 4 chars: '36' + 2-digit district. Trim and
  // parse so '3601' becomes '1', '3613' becomes '13'.
  const tail = areaId.length > 2 ? areaId.slice(2) : areaId;
  const n = Number.parseInt(tail, 10);
  return Number.isFinite(n) ? String(n) : tail;
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
