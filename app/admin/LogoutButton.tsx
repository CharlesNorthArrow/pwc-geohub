'use client';

import { useState } from 'react';

export default function LogoutButton(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/admin/logout', { method: 'POST' });
        // Forces the layout to re-render with the login form.
        window.location.reload();
      }}
      style={{
        background: 'transparent',
        border: '1px solid rgba(255,255,255,0.5)',
        color: '#fff',
        padding: '6px 12px',
        fontSize: 12,
        borderRadius: 4,
        cursor: busy ? 'progress' : 'pointer',
      }}
    >
      Sign out
    </button>
  );
}
