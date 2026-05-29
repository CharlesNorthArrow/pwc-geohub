'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * "Top Logo Corner" — pinned above the left panel, never scrolls.
 *
 * Composition:
 *  ┌───────────────────────────────────────────┐
 *  │  [PWC logo]                  [i]  [⚙]    │  ← PWC blue band
 *  └───────────────────────────────────────────┘
 *
 * - PWC logo is the existing PNG, force-tinted white via CSS filter so we can
 *   stay on the dark-blue band without shipping a second asset.
 * - Info bubble (i) opens a tiny credit popover linking to North Arrow.
 * - Admin gear (⚙) is a placeholder for a future Admin Data Update panel —
 *   it's surfaced now so the slot is visible, but it does nothing yet.
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
        // Lift over the scrolling content below so a fade isn't needed.
        boxShadow: '0 1px 2px rgba(0, 32, 64, 0.12)',
      }}
    >
      <a
        href="https://partnershipwithchildren.org/"
        target="_blank"
        rel="noreferrer"
        aria-label="Partnership with Children"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          textDecoration: 'none',
          flex: 1,
          minWidth: 0,
        }}
      >
        <img
          src="/brand/PWC-Logo.png"
          alt="Partnership with Children"
          style={{
            height: 44,
            width: 'auto',
            // Force the existing dark-on-light PNG to render white.
            filter: 'brightness(0) invert(1)',
          }}
        />
      </a>
      <CreditsButton />
      <AdminButton />
    </div>
  );
}

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
