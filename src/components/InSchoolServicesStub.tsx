'use client';

import { useState } from 'react';

/**
 * Spec §4.4 reserves a dedicated view for the PWC in-school-services metrics
 * (`sw_caseload_students`, `total_contacts_sw`, etc.). Phase 2 only reserves
 * the **entry point** — the view itself ships in a later phase. This stub
 * documents intent without committing to a UI shape.
 */
export default function InSchoolServicesStub(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'transparent',
          border: '1px dashed rgba(70,124,157,0.4)',
          color: '#467c9d',
          fontSize: 11,
          padding: '4px 6px',
          borderRadius: 4,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        In-school services →
      </button>
      {open ? (
        <div
          style={{
            marginTop: 6,
            padding: '6px 8px',
            background: '#f2f8ee',
            border: '1px solid #e5e9ee',
            borderRadius: 4,
            fontSize: 11,
            color: '#002040',
            lineHeight: 1.3,
          }}
        >
          The in-school-services view (caseload, individual + group contacts,
          students-served counts) ships in a later phase per spec §4.4. The
          data is already in <code>pwc_school_program</code> (`*_sw` /
          contacts columns) — only the view is deferred.
        </div>
      ) : null}
    </div>
  );
}
