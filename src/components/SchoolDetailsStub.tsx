'use client';

interface Props {
  open: boolean;
  dbn: string | null;
  schoolName: string | null;
  onClose: () => void;
}

/**
 * Spec §6.4 zooms to the picked school and opens the School Details View. The
 * view itself is in the "Later (separately specced)" bucket; Phase 3 just
 * reserves the entry point. Same pattern as the in-school-services stub.
 */
export default function SchoolDetailsStub({ open, dbn, schoolName, onClose }: Props): React.JSX.Element | null {
  if (!open || !dbn) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="School Details (stub)"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,32,64,0.45)',
        zIndex: 100,
        display: 'grid',
        placeItems: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'white',
          padding: 24,
          borderRadius: 8,
          maxWidth: 460,
          boxShadow: '0 12px 40px rgba(0,32,64,0.3)',
        }}
      >
        <div style={{ fontSize: 11, color: '#467c9d', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          School Details · stub
        </div>
        <div style={{ marginTop: 6, fontSize: 16, color: '#002040', fontWeight: 700 }}>
          {schoolName ?? dbn} <span style={{ fontWeight: 400, color: '#467c9d' }}>({dbn})</span>
        </div>
        <p style={{ marginTop: 12, fontSize: 13, color: '#002040', lineHeight: 1.4 }}>
          The full School Details View — score card, indicator history, PWC
          services breakdown — ships in a later phase (spec §10 Later). For now
          the map has zoomed to this school.
        </p>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#027BC0',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              padding: '6px 14px',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
