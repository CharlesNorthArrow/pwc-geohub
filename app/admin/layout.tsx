import type { Metadata } from 'next';
import Link from 'next/link';
import { hasValidAdminSession } from '../../src/server/auth';
import AdminLogin from './AdminLogin';
import LogoutButton from './LogoutButton';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin · PWC Geospatial Hub',
  robots: { index: false, follow: false },
};

/**
 * One gate, every admin page. If the session cookie isn't a valid admin
 * session, render the login form INSTEAD of the children. Auth never
 * "fails through" to a child component.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const authed = await hasValidAdminSession();
  return (
    // height + overflow:auto so the admin pane is its OWN scroll container.
    // The dashboard sets body{overflow:hidden} globally (for the full-screen
    // map), which otherwise traps the admin content above the fold.
    <div
      style={{
        height: '100dvh',
        overflow: 'auto',
        background: '#f6f8fb',
        color: '#002040',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <header
        style={{
          background: '#027BC0',
          color: '#fff',
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          PWC Geospatial Hub · Admin
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.5)',
              borderRadius: 4,
              fontSize: 12,
              textDecoration: 'none',
            }}
          >
            <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="7,2 3,6 7,10" />
              <line x1={3} y1={6} x2={10} y2={6} />
            </svg>
            Back to map
          </Link>
          {authed ? <LogoutButton /> : null}
        </div>
      </header>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>
        {authed ? children : <AdminLogin />}
      </main>
    </div>
  );
}

