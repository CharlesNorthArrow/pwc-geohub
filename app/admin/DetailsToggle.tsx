'use client';

import { useState } from 'react';

/**
 * "Show details ▾" / "Hide details ▴" — the one expand pattern on Data Admin
 * cards. Closed by default; children (and anything they fetch, e.g. version
 * history) only mount once opened. Pass `open` + `onOpenChange` to control
 * it from elsewhere on the card.
 */
export default function DetailsToggle({
  label = 'details',
  open: openProp,
  onOpenChange,
  children,
}: {
  /** What's behind the toggle, e.g. "details" or "sources, history & details". */
  label?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const toggle = (): void => {
    if (openProp === undefined) setOpenState(!open);
    onOpenChange?.(!open);
  };
  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          alignSelf: 'flex-start',
          background: 'none',
          border: 0,
          padding: 0,
          color: '#027BC0',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {open ? `Hide ${label} ▴` : `Show ${label} ▾`}
      </button>
      {open ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div> : null}
    </>
  );
}
