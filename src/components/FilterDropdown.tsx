'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface DropdownOption {
  value: string;
  label: string;
  /** Optional count badge — greyed-out when 0 (per the agreed UX). */
  count?: number;
}

interface Props {
  /** Short label shown in the trigger, e.g. "Cohort". */
  triggerLabel: string;
  /** Currently selected option's display string, or "All" sentinel. Surfaced
   *  in a tooltip on the trigger AND used to mark the selected row in the
   *  open panel — but NOT rendered inline on the trigger itself, so the
   *  header bar's width stays stable as users change filters. */
  selectedLabel: string;
  options: DropdownOption[];
  /** Discreet note shown above the option list when set. */
  prefilterNote?: string | null;
  /** Whether to show the search box (off for very small lists). */
  searchable?: boolean;
  /** "Reset to All" handler — clears the filter. */
  onReset: () => void;
  onPick: (value: string) => void;
  /** Whether the currently-selected value is the "all" / default state. */
  isAtDefault: boolean;
  /** When non-zero, drives the count badge shown beside the trigger label.
   *  Single-select filters pass 1 (or 0); the Geo multi-select passes the
   *  total picks across all layers. Optional — defaults to "1 when not at
   *  default" for the simple single-select case. */
  activeCount?: number;
}

/**
 * Generic single-select dropdown — reused by School Type, Cohort, and School
 * filters. Renders an inline-positioned panel with search, reset, and
 * per-option count badges. Options with `count === 0` render greyed but
 * remain clickable so users can see what the cascade hid.
 */
export default function FilterDropdown({
  triggerLabel,
  selectedLabel,
  options,
  prefilterNote,
  searchable = true,
  onReset,
  onPick,
  isAtDefault,
  activeCount,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // The panel is rendered via portal (to document.body) with `position: fixed`
  // so the toolbar's overflow clipping can't hide it. We track the trigger's
  // bounding rect to position the panel.
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const update = (): void => {
      const r = rootRef.current?.getBoundingClientRect();
      if (r) setTriggerRect(r);
    };
    update();
    // Re-position on scroll/resize. `capture: true` catches the inner header
    // scroller, not just the window.
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // Close on outside click. Click target may live in the portal, so we check
  // both the trigger root AND the panel before closing.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const visible = q
    ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  // Trigger shows only the filter NAME + a count badge when active. The
  // selected value lives in the tooltip and is marked inside the open panel
  // so the header bar's pill width stays stable — single-select changes
  // never push the time slider sideways.
  const count = activeCount ?? (isAtDefault ? 0 : 1);
  const tooltip = isAtDefault ? triggerLabel : `${triggerLabel}: ${selectedLabel}`;

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={tooltip}
        aria-label={tooltip}
        style={{
          padding: '4px 10px',
          background: isAtDefault ? '#ffffff' : '#027BC0',
          color: isAtDefault ? '#002040' : 'white',
          border: '1px solid #c5cdd6',
          borderRadius: 4,
          fontSize: 12,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontWeight: 500,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {triggerLabel}
        </span>
        {count > 0 ? (
          <span
            style={{
              background: isAtDefault ? '#027BC0' : 'white',
              color: isAtDefault ? 'white' : '#027BC0',
              borderRadius: 999,
              padding: '0 6px',
              fontSize: 10,
              fontWeight: 700,
              minWidth: 16,
              textAlign: 'center',
              lineHeight: '14px',
            }}
          >
            {count}
          </span>
        ) : null}
        <span aria-hidden style={{ opacity: 0.6 }}>▾</span>
      </button>

      {open && triggerRect && typeof document !== 'undefined'
        ? createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: triggerRect.bottom + 4,
            left: triggerRect.left,
            zIndex: 1000,
            minWidth: 240,
            maxWidth: 320,
            background: 'white',
            border: '1px solid #c5cdd6',
            borderRadius: 6,
            boxShadow: '0 6px 24px rgba(0,32,64,0.15)',
            padding: 8,
          }}
        >
          {prefilterNote ? (
            <div
              style={{
                fontSize: 10,
                color: '#467c9d',
                background: '#eef4f8',
                border: '1px solid #d4e2ec',
                borderRadius: 4,
                padding: '3px 6px',
                marginBottom: 6,
              }}
              title="Upper filters have narrowed the visible options"
            >
              pre-filtered by {prefilterNote}
            </div>
          ) : null}

          {searchable ? (
            <input
              type="text"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                padding: '4px 6px',
                fontSize: 12,
                border: '1px solid #c5cdd6',
                borderRadius: 4,
                marginBottom: 6,
              }}
            />
          ) : null}

          <button
            type="button"
            onClick={() => {
              onReset();
              setOpen(false);
            }}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '4px 6px',
              border: 'none',
              background: 'transparent',
              fontSize: 12,
              cursor: 'pointer',
              borderBottom: '1px solid #eef0f3',
              marginBottom: 4,
              color: isAtDefault ? '#999' : '#027BC0',
            }}
          >
            ↺ Reset to All
          </button>

          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {visible.length === 0 ? (
              <div style={{ fontSize: 11, color: '#999', padding: '4px 6px' }}>No matches</div>
            ) : null}
            {visible.map((opt) => {
              const zero = opt.count === 0;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onPick(opt.value);
                    setOpen(false);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '4px 6px',
                    border: 'none',
                    background:
                      selectedLabel === opt.label ? '#eef4f8' : 'transparent',
                    color: zero ? '#a8b3bf' : '#002040',
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    lineHeight: 1.3,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {opt.label}
                  </span>
                  {opt.count != null ? (
                    <span style={{ fontSize: 10, color: zero ? '#c5cdd6' : '#467c9d' }}>
                      ({opt.count})
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )
        : null}
    </div>
  );
}
