'use client';

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEMOGRAPHIC_FIELDS, type DemographicField, type SchoolMaster } from '../contract/types';
import { useHubStore, type DemographicRanges } from '../store/useHubStore';

interface Props {
  schoolsMaster: SchoolMaster[];
  /** DBNs that pass every filter up to Grade — the schools this step narrows. */
  candidateDbns: Set<string>;
  prefilterNote: string | null;
}

type Draft = Record<DemographicField, { min: string; max: string }>;

function draftFrom(d: DemographicRanges): Draft {
  const out = {} as Draft;
  for (const f of DEMOGRAPHIC_FIELDS) {
    const r = d[f.id];
    out[f.id] = { min: r ? String(r.min) : '', max: r ? String(r.max) : '' };
  }
  return out;
}

/** Parse one row's inputs: both blank → no constraint; a blank side is open
 *  (0 or 100); anything outside 0–100 or min > max is invalid. */
function parseRow(row: { min: string; max: string }): { min: number; max: number } | null | 'invalid' {
  const minS = row.min.trim();
  const maxS = row.max.trim();
  if (minS === '' && maxS === '') return null;
  const min = minS === '' ? 0 : Number(minS);
  const max = maxS === '' ? 100 : Number(maxS);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 'invalid';
  if (min < 0 || max > 100 || min > max) return 'invalid';
  return { min, max };
}

/**
 * Header chip + panel for the Demographics filter: % poverty, % students of
 * color, % ELL, % IEP, each an inclusive Min–Max % range. Same trigger
 * convention as FilterDropdown — the name plus a count badge (fields
 * constrained), never the values, so the slider never moves.
 */
export default function DemographicsFilter({
  schoolsMaster,
  candidateDbns,
  prefilterNote,
}: Props): React.JSX.Element {
  const demographics = useHubStore((s) => s.demographics);
  const setDemographics = useHubStore((s) => s.setDemographics);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(demographics));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);

  // Re-sync the inputs only when the store changes from outside (Reset all),
  // never on our own commits — that would rewrite what the user is typing.
  const lastCommitted = useRef<DemographicRanges>(demographics);
  useEffect(() => {
    if (demographics === lastCommitted.current) return;
    lastCommitted.current = demographics;
    setDraft(draftFrom(demographics));
  }, [demographics]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const update = (): void => {
      const r = rootRef.current?.getBoundingClientRect();
      if (r) setTriggerRect(r);
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

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

  // Schools among the candidates with no value per field — they drop out as
  // soon as that field is constrained.
  const missingByField = useMemo(() => {
    const out = {} as Record<DemographicField, number>;
    for (const f of DEMOGRAPHIC_FIELDS) out[f.id] = 0;
    for (const s of schoolsMaster) {
      if (!candidateDbns.has(s.dbn)) continue;
      for (const f of DEMOGRAPHIC_FIELDS) if (s[f.id] == null) out[f.id]++;
    }
    return out;
  }, [schoolsMaster, candidateDbns]);

  const commit = (next: Draft): void => {
    setDraft(next);
    const ranges: DemographicRanges = {};
    for (const f of DEMOGRAPHIC_FIELDS) {
      const parsed = parseRow(next[f.id]);
      if (parsed === 'invalid') return; // keep the last valid filter until fixed
      if (parsed) ranges[f.id] = parsed;
    }
    lastCommitted.current = ranges;
    setDemographics(ranges);
  };

  const activeCount = DEMOGRAPHIC_FIELDS.filter((f) => demographics[f.id] != null).length;
  const isAtDefault = activeCount === 0;
  const tooltip = isAtDefault
    ? 'Demographics'
    : `Demographics: ${DEMOGRAPHIC_FIELDS.filter((f) => demographics[f.id])
        .map((f) => `${f.label} ${demographics[f.id]!.min}–${demographics[f.id]!.max}`)
        .join(' · ')}`;

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={tooltip}
        aria-label={tooltip}
        aria-expanded={open}
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
          Demographics
        </span>
        {activeCount > 0 ? (
          <span
            style={{
              background: 'white',
              color: '#027BC0',
              borderRadius: 999,
              padding: '0 6px',
              fontSize: 10,
              fontWeight: 700,
              minWidth: 16,
              textAlign: 'center',
              lineHeight: '14px',
            }}
          >
            {activeCount}
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
                width: 300,
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

              <button
                type="button"
                onClick={() => {
                  setDemographics({});
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

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 56px 56px 18px',
                  gap: '4px 6px',
                  alignItems: 'center',
                  fontSize: 12,
                  color: '#002040',
                  padding: '2px 6px',
                }}
              >
                <span />
                <span style={headStyle}>Min %</span>
                <span style={headStyle}>Max %</span>
                <span />
                {DEMOGRAPHIC_FIELDS.map((f) => {
                  const row = draft[f.id];
                  const invalid = parseRow(row) === 'invalid';
                  const hasInput = row.min.trim() !== '' || row.max.trim() !== '';
                  const missing = missingByField[f.id];
                  return (
                    <Fragment key={f.id}>
                      <span>
                        {f.label}
                        {hasInput && missing > 0 ? (
                          <span style={{ display: 'block', fontSize: 10, color: '#467c9d' }}>
                            {missing.toLocaleString()} with no data left out
                          </span>
                        ) : null}
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        inputMode="decimal"
                        aria-label={`${f.label} minimum`}
                        value={row.min}
                        onChange={(e) => commit({ ...draft, [f.id]: { ...row, min: e.target.value } })}
                        style={inputStyle(invalid)}
                      />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        inputMode="decimal"
                        aria-label={`${f.label} maximum`}
                        value={row.max}
                        onChange={(e) => commit({ ...draft, [f.id]: { ...row, max: e.target.value } })}
                        style={inputStyle(invalid)}
                      />
                      <button
                        type="button"
                        onClick={() => commit({ ...draft, [f.id]: { min: '', max: '' } })}
                        aria-label={`Clear ${f.label}`}
                        title={`Clear ${f.label}`}
                        disabled={!hasInput}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: hasInput ? 'pointer' : 'default',
                          color: hasInput ? '#467c9d' : 'transparent',
                          fontSize: 14,
                          lineHeight: 1,
                          padding: 0,
                        }}
                      >
                        ×
                      </button>
                    </Fragment>
                  );
                })}
              </div>
              {DEMOGRAPHIC_FIELDS.some((f) => parseRow(draft[f.id]) === 'invalid') ? (
                <div style={{ fontSize: 10, color: '#c0392b', padding: '4px 6px 0' }}>
                  Use values from 0 to 100, with Min no higher than Max.
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

const headStyle: React.CSSProperties = {
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: '#a8b3bf',
};

function inputStyle(invalid: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: '3px 4px',
    fontSize: 12,
    border: `1px solid ${invalid ? '#c0392b' : '#c5cdd6'}`,
    borderRadius: 4,
  };
}
