'use client';

import { useEffect, useState } from 'react';

interface VersionRow {
  version_id: number;
  provider: 'acs' | 'cdc_places';
  created_at: string;
  created_by: string;
  source: string;
  notes: string | null;
  row_count: number;
  vintages: Record<string, string[]>;
  is_current: boolean;
}

export default function CommunityVersionHistory({
  provider,
  refreshKey,
}: {
  provider: 'acs' | 'cdc_places';
  refreshKey: number;
}): React.JSX.Element {
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rollbackBusy, setRollbackBusy] = useState<number | null>(null);

  useEffect(() => {
    let abandoned = false;
    fetch(`/api/admin/community/${provider}/versions`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as { versions: VersionRow[] };
        if (!abandoned) setRows(body.versions);
      })
      .catch((e) => !abandoned && setErr((e as Error).message));
    return () => { abandoned = true; };
  }, [provider, refreshKey]);

  const rollback = async (versionId: number): Promise<void> => {
    const sure = window.confirm(
      `Rollback ${provider} to v${versionId}? A new version row will be written with v${versionId}'s data and "current" will point at it.`,
    );
    if (!sure) return;
    setRollbackBusy(versionId);
    try {
      const r = await fetch(`/api/admin/community/${provider}/rollback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetVersionId: versionId }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
        alert(`Rollback failed: ${body.message ?? body.error ?? r.status}`);
      } else {
        // Trigger a remount-via-refresh of the history (parent passes refreshKey).
        window.location.reload();
      }
    } finally {
      setRollbackBusy(null);
    }
  };

  if (err) return <div style={{ color: '#c0392b', fontSize: 12 }}>Failed to load: {err}</div>;
  if (!rows) return <div style={{ fontSize: 12, color: '#5a6e85' }}>Loading…</div>;
  if (rows.length === 0) return <div style={{ fontSize: 12, color: '#5a6e85' }}>No versions yet.</div>;

  return (
    <div style={{ border: '1px solid #e1e8ef', borderRadius: 6, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ background: '#f6f8fb', textAlign: 'left' }}>
            <th style={th}>Version</th>
            <th style={th}>When</th>
            <th style={th}>Source</th>
            <th style={th}>Rows</th>
            <th style={th}>Notes</th>
            <th style={{ ...th, textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.version_id} style={{ borderTop: '1px solid #e1e8ef', background: r.is_current ? '#eaf3fb' : '#fff' }}>
              <td style={td}>
                <strong>v{r.version_id}</strong>
                {r.is_current ? <ActiveBadge /> : null}
              </td>
              <td style={td}>{fmt(r.created_at)}</td>
              <td style={{ ...td, color: '#5a6e85' }}>{r.source}</td>
              <td style={td}>{r.row_count}</td>
              <td style={{ ...td, color: '#5a6e85' }}>{r.notes ?? '—'}</td>
              <td style={{ ...td, textAlign: 'right' }}>
                {!r.is_current ? (
                  <button
                    type="button"
                    onClick={() => rollback(r.version_id)}
                    disabled={rollbackBusy != null}
                    style={{
                      background: '#fff',
                      color: '#c0392b',
                      border: '1px solid #f1c4be',
                      borderRadius: 4,
                      padding: '3px 8px',
                      fontSize: 11,
                      cursor: rollbackBusy != null ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {rollbackBusy === r.version_id ? 'Rolling back…' : 'Rollback'}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActiveBadge(): React.JSX.Element {
  return (
    <span style={{ marginLeft: 6, fontSize: 9, background: '#027BC0', color: '#fff', padding: '2px 5px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      Active
    </span>
  );
}

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; }
}

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };
