'use client';

import { useEffect } from 'react';

export default function Modal({
  title,
  children,
  onClose,
  width = 560,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
  footer?: React.ReactNode;
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 32, 64, 0.4)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '60px 24px',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          color: '#002040',
          borderRadius: 8,
          width: '100%',
          maxWidth: width,
          maxHeight: 'calc(100dvh - 120px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}
      >
        <header
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid #e1e8ef',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontWeight: 600 }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 0, fontSize: 18, cursor: 'pointer', color: '#5a6e85' }}
          >
            ×
          </button>
        </header>
        <div style={{ padding: '18px 20px', overflow: 'auto' }}>{children}</div>
        {footer ? (
          <footer
            style={{
              padding: '12px 20px',
              borderTop: '1px solid #e1e8ef',
              background: '#f6f8fb',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
            }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
