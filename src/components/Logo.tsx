'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * "Top Logo Corner" — pinned above the left panel, never scrolls.
 *
 * Composition:
 *  ┌───────────────────────────────────────────┐
 *  │  [PWC mark + text]            [i]  [⚙]   │  ← PWC blue band
 *  └━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┘  ← orange accent line
 *
 * - The icon (4 concentric arcs + central sunburst star) is rebuilt as
 *   inline SVG so each ring can rotate independently. Reconstructed from the
 *   PNG by eye against the brand palette.
 * - "Partnership with Children" renders as white HTML text alongside.
 * - Info bubble (i) opens a tiny credit popover linking to North Arrow.
 * - Admin gear (⚙) is a placeholder for a future Admin Data Update panel.
 */
export default function Logo(): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        background: '#027BC0',
        color: '#ffffff',
        borderBottom: '3px solid #F0901F',
        // Lift over the scrolling content below so a fade isn't needed.
        boxShadow: '0 1px 2px rgba(0, 32, 64, 0.12)',
      }}
    >
      {/* Keyframes scoped via class names; one declaration per mount. */}
      <style>{KEYFRAMES_CSS}</style>

      <a
        href="https://partnershipwithchildren.org/"
        target="_blank"
        rel="noreferrer"
        aria-label="Partnership with Children"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          textDecoration: 'none',
          color: '#ffffff',
          flex: 1,
          minWidth: 0,
        }}
      >
        <PwcMark />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            lineHeight: 1.05,
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.2 }}>
            Partnership
          </span>
          <span style={{ fontSize: 13, fontWeight: 500, marginTop: 1, opacity: 0.95 }}>
            with Children
          </span>
        </div>
      </a>
      <CreditsButton />
      <AdminButton />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* PWC mark — animated rings + sunburst star                                  */
/* -------------------------------------------------------------------------- */

const RING_COLORS = {
  teal: '#00A0B0',
  magenta: '#903090',
  lime: '#A0B000',
  blue: '#027BC0',
} as const;
const STAR_FILL = '#F0901F';

function PwcMark(): React.JSX.Element {
  return (
    <svg
      width={44}
      height={44}
      viewBox="0 0 48 48"
      aria-hidden
      style={{ flexShrink: 0, display: 'block' }}
    >
      {/* Four concentric ring arcs. Each <g> rotates around the viewBox
       *  center via the CSS classes below. Alternating direction + slightly
       *  different cadences keep the motion visually interesting without
       *  being distracting. */}
      <g className="pwc-ring pwc-ring--outer">
        <circle
          cx={24}
          cy={24}
          r={21}
          fill="none"
          stroke={RING_COLORS.teal}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="78 54"
        />
      </g>
      <g className="pwc-ring pwc-ring--three">
        <circle
          cx={24}
          cy={24}
          r={17}
          fill="none"
          stroke={RING_COLORS.magenta}
          strokeWidth={2.8}
          strokeLinecap="round"
          strokeDasharray="62 45"
        />
      </g>
      <g className="pwc-ring pwc-ring--two">
        <circle
          cx={24}
          cy={24}
          r={13}
          fill="none"
          stroke={RING_COLORS.lime}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray="48 33"
        />
      </g>
      <g className="pwc-ring pwc-ring--inner">
        <circle
          cx={24}
          cy={24}
          r={9}
          fill="none"
          stroke={RING_COLORS.blue}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeDasharray="30 25"
        />
      </g>

      {/* Central sunburst star — five-point star in PWC orange. Coords
       *  derived from a 5-point star (outer r≈7, inner r≈3) centered at
       *  the viewBox midpoint. */}
      <path
        d="M 24 17 L 25.76 21.57 L 30.66 21.84 L 26.85 24.93 L 28.11 29.66 L 24 27 L 19.89 29.66 L 21.15 24.93 L 17.34 21.84 L 22.24 21.57 Z"
        fill={STAR_FILL}
      />
    </svg>
  );
}

/**
 * Keyframes + per-ring animation rules. Lives inside the component so the
 * CSS travels with the file and there's no globals.css coupling. Respects
 * `prefers-reduced-motion`.
 */
const KEYFRAMES_CSS = `
@keyframes pwc-rotate-cw  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes pwc-rotate-ccw { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
.pwc-ring { transform-origin: 24px 24px; transform-box: view-box; }
.pwc-ring--outer { animation: pwc-rotate-cw  22s linear infinite; }
.pwc-ring--three { animation: pwc-rotate-ccw 17s linear infinite; }
.pwc-ring--two   { animation: pwc-rotate-cw  13s linear infinite; }
.pwc-ring--inner { animation: pwc-rotate-ccw 9s  linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .pwc-ring { animation: none !important; }
}
`;

/* -------------------------------------------------------------------------- */
/* Icon buttons (credits + admin placeholder)                                 */
/* -------------------------------------------------------------------------- */

/** Round "i" button — toggles a small popover with the North Arrow credit. */
function CreditsButton(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent): void {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="About"
        title="About this tool"
        style={iconBtnStyle(open)}
      >
        i
      </button>
      {open ? (
        <div
          role="dialog"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            background: '#ffffff',
            color: '#002040',
            border: '1px solid #c5cdd6',
            borderRadius: 6,
            boxShadow: '0 6px 20px rgba(0, 32, 64, 0.18)',
            padding: '10px 12px',
            fontSize: 12,
            lineHeight: 1.4,
            width: 220,
            zIndex: 50,
          }}
        >
          Made in 2026 by{' '}
          <a
            href="https://north-arrow.org/"
            target="_blank"
            rel="noreferrer"
            style={{ color: '#027BC0', fontWeight: 600 }}
          >
            North Arrow
          </a>
          .
        </div>
      ) : null}
    </div>
  );
}

/** Placeholder admin gear — future data-update panel. */
function AdminButton(): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => {
        // Placeholder. The future Admin Panel ships separately (spec §10).
      }}
      aria-label="Admin data updates (coming soon)"
      title="Admin data updates (coming soon)"
      style={iconBtnStyle(false)}
    >
      <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>⚙</span>
    </button>
  );
}

function iconBtnStyle(active: boolean): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.6)',
    background: active ? 'rgba(255,255,255,0.18)' : 'transparent',
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  };
}
