import type { Metadata } from 'next';
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
    <div
      style={{
        minHeight: '100dvh',
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
        }}
      >
        <div style={{ fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          PWC Geospatial Hub · Admin
        </div>
        {authed ? <LogoutButton /> : null}
      </header>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>
        {authed ? children : <AdminLogin />}
      </main>
    </div>
  );
}

