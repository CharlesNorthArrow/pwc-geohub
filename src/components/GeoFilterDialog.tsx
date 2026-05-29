'use client';

import { useEffect, useState } from 'react';
import {
  GEO_FILTER_LAYERS,
  type GeoArea,
  type GeoFilterLayerId,
  type GeographiesResponse,
} from '../contract/types';
import type { GeoFilterMap } from '../store/useHubStore';

interface Props {
  open: boolean;
  geographies: GeographiesResponse | null;
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
  initial,
  onCancel,
  onApply,
}: Props): React.JSX.Element | null {
  const [working, setWorking] = useState<GeoFilterMap>(initial);
  const [activeLayer, setActiveLayer] = useState<GeoFilterLayerId>('council');
  const [q, setQ] = useState('');

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

  if (!open) return null;

  const layerOptions: GeoArea[] = geographies?.layers[activeLayer] ?? [];
  const filteredOptions = q
    ? layerOptions.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    : layerOptions;
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
          <section style={{ padding: 12, display: 'grid', gridTemplateRows: 'auto 1fr', minHeight: 0 }}>
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
            <div style={{ overflowY: 'auto', minHeight: 0 }}>
              {filteredOptions.length === 0 ? (
                <div style={{ fontSize: 11, color: '#999' }}>No matches.</div>
              ) : null}
              {filteredOptions.map((opt) => {
                const picked = layerPicks.includes(opt.area_id);
                return (
                  <label
                    key={opt.area_id}
                    style={{
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                      padding: '3px 4px',
                      fontSize: 12,
                      cursor: 'pointer',
                      borderRadius: 3,
                      background: picked ? '#eef4f8' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={picked}
                      onChange={() => toggleArea(opt.area_id)}
                    />
                    <span>{opt.label}</span>
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
