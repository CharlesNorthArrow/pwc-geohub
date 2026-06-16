'use client';

import { useEffect, useState } from 'react';
import Modal from './Modal';

interface Preview {
  provider: 'acs' | 'cdc_places';
  alreadyLatest: boolean;
  targetVintage: string;
  cdcRowsUpdatedAt: string | null;
  loadedVintage: string | null;
  loadedCdcUpdatedAt: string | null;
  diff: {
    added: number;
    updated: number;
    unchanged: number;
    retained: number;
    newRowCount: number;
    byIndicator: Record<string, { added: number; updated: number; unchanged: number; retained: number }>;
  };
  updatedSample: Array<{ key: string; changed: string[]; before: unknown; after: unknown }>;
}

type Step =
  | { kind: 'loading' }
  | { kind: 'preview'; preview: Preview }
  | { kind: 'applying' }
  | { kind: 'done'; versionId: number | null; alreadyLatest: boolean }
  | { kind: 'error'; message: string };

export default function CommunitySyncDialog({
  provider,
  onClose,
  onApplied,
}: {
  provider: 'acs' | 'cdc_places';
  onClose: () => void;
  onApplied: () => Promise<void>;
}): React.JSX.Element {
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [notes, setNotes] = useState('');

  useEffect(() => {
    let abandoned = false;
    fetch(`/api/admin/community/${provider}/sync/preview`, { method: 'POST' })
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
          throw new Error(body.message ?? body.error ?? `HTTP ${r.status}`);
        }
        const body = (await r.json()) as { preview: Preview };
        if (!abandoned) setStep({ kind: 'preview', preview: body.preview });
      })
      .catch((e) => !abandoned && setStep({ kind: 'error', message: (e as Error).message }));
    return () => { abandoned = true; };
  }, [provider]);

  const apply = async (): Promise<void> => {
    setStep({ kind: 'applying' });
    try {
      const r = await fetch(`/api/admin/community/${provider}/sync/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
        setStep({ kind: 'error', message: body.message ?? body.error ?? `HTTP ${r.status}` });
        return;
      }
      const body = (await r.json()) as { versionId?: number; alreadyLatest: boolean };
      setStep({ kind: 'done', versionId: body.versionId ?? null, alreadyLatest: body.alreadyLatest });
    } catch (e) {
      setStep({ kind: 'error', message: (e as Error).message });
    }
  };

  const title = `Sync ${provider === 'acs' ? 'Census ACS' : 'CDC PLACES'}`;

  if (step.kind === 'loading') {
    return <Modal title={title} onClose={onClose}>Probing source for the latest vintage…</Modal>;
  }
  if (step.kind === 'error') {
    return (
      <Modal
        title={title}
        onClose={onClose}
        footer={<button type="button" onClick={onClose} style={ghostBtn}>Close</button>}
      >
        <div style={{ color: '#c0392b' }}>
          <strong>Sync failed.</strong>
          <div style={{ marginTop: 6, fontSize: 13 }}>{step.message}</div>
          <div style={{ marginTop: 12, fontSize: 12, color: '#5a6e85' }}>
            Nothing was written. The availability badge is unchanged.
          </div>
        </div>
      </Modal>
    );
  }
  if (step.kind === 'preview') {
    const p = step.preview;
    if (p.alreadyLatest) {
      return (
        <Modal
          title={title}
          onClose={onClose}
          footer={<button type="button" onClick={onClose} style={primaryBtn}>OK</button>}
        >
          <div style={{ marginBottom: 8 }}>
            You're already on the latest version{' — '}
            <code>{p.targetVintage}</code>
            {p.provider === 'cdc_places' && p.cdcRowsUpdatedAt ? <> (CDC re-issued <code>{shortDate(p.cdcRowsUpdatedAt)}</code>)</> : null}
            .
          </div>
          <div style={{ fontSize: 13, color: '#5a6e85' }}>Nothing to sync.</div>
        </Modal>
      );
    }
    return (
      <Modal
        title={title}
        onClose={onClose}
        width={760}
        footer={
          <>
            <button type="button" onClick={onClose} style={ghostBtn}>Cancel</button>
            <button type="button" onClick={apply} style={primaryBtnGreen}>
              Apply (write new version)
            </button>
          </>
        }
      >
        <div style={{ marginBottom: 12 }}>
          <strong>Newer data available.</strong>
          <div style={{ fontSize: 12, color: '#5a6e85', marginTop: 4 }}>
            Loaded: <code>{p.loadedVintage ?? '—'}</code>
            {' · '}Source: <code>{p.targetVintage}</code>
            {p.provider === 'cdc_places' && p.cdcRowsUpdatedAt
              ? <> · CDC updatedAt: <code>{shortDate(p.cdcRowsUpdatedAt)}</code></>
              : null}
          </div>
        </div>
        <SummaryRow d={p.diff} />
        {Object.keys(p.diff.byIndicator).length > 0 ? (
          <Section title="Per indicator">
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f6f8fb', textAlign: 'left' }}>
                  <th style={th}>Indicator</th>
                  <th style={th}>New</th>
                  <th style={th}>Updated</th>
                  <th style={th}>Unchanged</th>
                  <th style={th}>Retained</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(p.diff.byIndicator).map(([id, c]) => (
                  <tr key={id} style={{ borderTop: '1px solid #e1e8ef' }}>
                    <td style={td}><code>{id}</code></td>
                    <td style={td}>{c.added}</td>
                    <td style={td}>{c.updated}</td>
                    <td style={td}>{c.unchanged}</td>
                    <td style={td}>{c.retained}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        ) : null}
        {p.updatedSample.length > 0 ? (
          <Section title={`${p.diff.updated} rows updated — sample`}>
            <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #e1e8ef', borderRadius: 6 }}>
              {p.updatedSample.map((u) => (
                <div key={u.key} style={{ padding: '6px 8px', borderBottom: '1px solid #eef2f7', fontSize: 11 }}>
                  <code>{u.key}</code> — changed: {u.changed.join(', ')}
                </div>
              ))}
            </div>
          </Section>
        ) : null}
        {p.diff.retained > 0 ? (
          <Banner tone="info">
            <strong>{p.diff.retained} rows retained from current</strong> — rows present today but absent from the upstream feed are kept as-is. Sync never deletes.
          </Banner>
        ) : null}
        <Section title="Notes (optional)">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What prompted this sync?"
            style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #c7d3e0', borderRadius: 4, boxSizing: 'border-box' }}
          />
        </Section>
      </Modal>
    );
  }
  if (step.kind === 'applying') {
    return <Modal title={title} onClose={() => { /* don't close mid-apply */ }}>Writing new version… do not close.</Modal>;
  }
  // done
  return (
    <Modal
      title={step.alreadyLatest ? title : `Synced — v${step.versionId}`}
      onClose={async () => { await onApplied(); }}
      footer={<button type="button" onClick={async () => { await onApplied(); }} style={primaryBtn}>Done</button>}
    >
      {step.alreadyLatest
        ? 'No new data — already on the latest version.'
        : <>New version <strong>v{step.versionId}</strong> is now live. Availability badge is back to "Up to date".</>}
    </Modal>
  );
}

function SummaryRow({ d }: { d: Preview['diff'] }): React.JSX.Element {
  const items: Array<[string, number, string]> = [
    ['new', d.added, '#1f7a3a'],
    ['updated', d.updated, '#a37800'],
    ['unchanged', d.unchanged, '#5a6e85'],
    ['retained', d.retained, '#5a6e85'],
    ['total in new version', d.newRowCount, '#002040'],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 16 }}>
      {items.map(([k, n, c]) => (
        <div key={k} style={{ background: '#f6f8fb', borderRadius: 6, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: c }}>{n}</div>
          <div style={{ fontSize: 10, color: '#5a6e85', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 11, color: '#5a6e85', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Banner({ tone, children }: { tone: 'info'; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ marginTop: 14, background: '#eaf3fb', color: '#027BC0', padding: 12, borderRadius: 6, fontSize: 13 }}>
      {children}
    </div>
  );
}

function shortDate(iso: string): string {
  const n = Number(iso);
  if (Number.isFinite(n) && n > 1e9) return new Date(n * 1000).toLocaleDateString();
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };
const primaryBtn: React.CSSProperties = { background: '#027BC0', color: '#fff', border: 0, borderRadius: 4, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const primaryBtnGreen: React.CSSProperties = { background: '#1f7a3a', color: '#fff', border: 0, borderRadius: 4, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#5a6e85', border: '1px solid #c7d3e0', borderRadius: 4, padding: '8px 14px', fontSize: 13, cursor: 'pointer' };
