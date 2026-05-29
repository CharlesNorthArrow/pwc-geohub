'use client';

import { useEffect, useRef, useState } from 'react';

export interface DropdownOption {
  value: string;
  label: string;
  /** Optional count badge — greyed-out when 0 (per the agreed UX). */
  count?: number;
}

interface Props {
  /** Short label shown in the trigger, e.g. "Cohort". */
  triggerLabel: string;
  /** Currently selected option's display string, or "All" sentinel. */
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
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const visible = q
    ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
        }}
      >
        <span style={{ opacity: 0.7, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {triggerLabel}
        </span>
        <span>{selectedLabel}</span>
        <span aria-hidden style={{ opacity: 0.6 }}>▾</span>
      </button>

      {open ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 10,
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
        </div>
      ) : null}
    </div>
  );
}
