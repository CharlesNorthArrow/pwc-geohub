'use client';

import { useCallback, useEffect, useState } from 'react';
import UploadFlow, { type DatasetConfig } from './UploadFlow';
import VersionHistory from './VersionHistory';
import ViewSchemaDialog from './ViewSchemaDialog';
import MasterSourcesDialog from './MasterSourcesDialog';
import { MASTER_SOURCE_GUIDES, type MasterSourceGuide } from '../../src/registry/dataSources';

const DATASET: DatasetConfig = {
  basePath: '/api/admin/school-master',
  datasetLabel: 'schools_master',
};

interface InitialSchema {
  versionId: number | null;
  rowCount: number;
  updatedAt: string | null;
}

interface StoredSource {
  slot: string;
  kind: string;
  filename: string;
  rowCount: number;
  summary: string;
  uploadedAt?: string;
}

interface SourcesState {
  sources: StoredSource[];
  missing: string[];
  coverage: { directoryYearsUsed: string[]; directoryYearsWaiting: string[] } | null;
  notes: string[];
}

/**
 * "School data master" admin category. The master is BUILT by the hub from
 * public source files (Demographic Snapshot, Directory data, LCGMS, NYSED
 * Community Schools list). The panel lists every source — where to get it,
 * what the hub takes from it, and which file is stored — and "Update
 * sources…" takes only the file(s) that changed, rebuilds, previews, and
 * applies. Apply UPSERTS `schools` / `schools_year` and rebuilds the geo
 * crosswalks; nothing is ever deleted. A prepared CSV can still be uploaded
 * through the column-matching flow (advanced).
 */
export default function SchoolMasterSection({
  initialSchema,
}: {
  initialSchema: InitialSchema;
}): React.JSX.Element {
  const [versionsKey, setVersionsKey] = useState(0);
  const [activeVersion, setActiveVersion] = useState<InitialSchema>(initialSchema);
  const [sources, setSources] = useState<SourcesState | null>(null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'sources' | 'csv' | 'schema' | null>(null);

  const loadSources = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch(`${DATASET.basePath}/sources`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSources((await r.json()) as SourcesState);
      setSourcesError(null);
    } catch (err) {
      setSourcesError(`Could not load the stored sources (${(err as Error).message}).`);
    }
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const refreshActive = async (): Promise<void> => {
    try {
      const r = await fetch(`${DATASET.basePath}/schema`);
      if (!r.ok) return;
      const body = (await r.json()) as { currentVersion: number | null; rowCount: number; updatedAt: string | null };
      setActiveVersion({ versionId: body.currentVersion, rowCount: body.rowCount, updatedAt: body.updatedAt });
    } catch {
      // soft fail — the version history fetch is the user-visible source of truth
    }
  };

  const afterApply = async (): Promise<void> => {
    setDialog(null);
    await Promise.all([refreshActive(), loadSources()]);
    setVersionsKey((k) => k + 1);
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #e1e8ef', borderRadius: 8, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#5a6e85', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            School data master
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, marginTop: 2 }}>schools_master</div>
          <div style={{ fontSize: 12, color: '#5a6e85', marginTop: 6, maxWidth: 600, lineHeight: 1.5 }}>
            Every NYC school with its location, enrollment and demographics, per school year — the base every
            indicator and PWC record joins to. The hub builds it from the four public sources below. To update,
            download the new file(s) and use <strong>Update sources…</strong>: only the files that changed are
            needed; the hub rebuilds the master from them plus the stored ones and shows you the changes before
            anything is saved. Schools are never deleted.
          </div>
        </div>
        <Badge {...activeVersion} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => setDialog('sources')} style={primaryBtn}>
          Update sources…
        </button>
        <button type="button" onClick={() => { window.location.href = `${DATASET.basePath}/download`; }} style={secondaryBtn}>
          Download current CSV
        </button>
        <button type="button" onClick={() => setDialog('schema')} style={secondaryBtn}>
          View schema
        </button>
        <button type="button" onClick={() => setDialog('csv')} style={textBtn}>
          Advanced: upload a prepared CSV instead
        </button>
      </div>

      {sourcesError ? <Callout tone="error">{sourcesError}</Callout> : null}
      {sources && sources.missing.length > 0 ? (
        <Callout tone="warn">
          <strong>Sources still needed before the master can be rebuilt:</strong>
          <ul style={{ margin: '4px 0 0 0', paddingLeft: 18 }}>
            {sources.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <div style={{ marginTop: 4 }}>
            Upload them (all at once is fine) with Update sources…. The current version stays live until you apply.
          </div>
        </Callout>
      ) : null}
      {sources && sources.notes.length > 0 ? (
        <Callout tone="info">
          <strong>What the stored sources cover</strong>
          <ul style={{ margin: '4px 0 0 0', paddingLeft: 18 }}>
            {sources.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <div style={{ marginTop: 22, fontSize: 12, color: '#5a6e85', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Sources
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 8 }}>
        {MASTER_SOURCE_GUIDES.map((g) => (
          <SourceCard key={g.kind} guide={g} state={sources} />
        ))}
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ fontSize: 12, color: '#5a6e85', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Version history
        </div>
        <div style={{ fontSize: 11, color: '#9aa9ba', marginBottom: 6 }}>
          Rolling back restores the master&apos;s rows; the stored source files stay at their latest upload.
        </div>
        <VersionHistory
          refreshKey={versionsKey}
          basePath={DATASET.basePath}
          onRolledBack={async () => {
            await refreshActive();
            setVersionsKey((k) => k + 1);
          }}
        />
      </div>

      {dialog === 'sources' ? <MasterSourcesDialog onClose={() => setDialog(null)} onApplied={afterApply} /> : null}
      {dialog === 'csv' ? <UploadFlow dataset={DATASET} onClose={() => setDialog(null)} onApplied={afterApply} /> : null}
      {dialog === 'schema' ? (
        <ViewSchemaDialog basePath={DATASET.basePath} datasetLabel={DATASET.datasetLabel} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function SourceCard({ guide, state }: { guide: MasterSourceGuide; state: SourcesState | null }): React.JSX.Element {
  const stored = (slot: string): StoredSource | undefined => state?.sources.find((s) => s.slot === slot);
  return (
    <div style={{ border: '1px solid #e1e8ef', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{guide.title}</div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: guide.required ? '#027BC0' : '#5a6e85',
          }}
        >
          {guide.required ? 'Required' : 'Recommended'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#33455c', lineHeight: 1.45 }}>{guide.provides}</div>

      <div style={{ fontSize: 11, color: '#5a6e85' }}>
        <a href={guide.sourceUrl} target="_blank" rel="noreferrer" style={{ color: '#027BC0', fontWeight: 600, textDecoration: 'none' }}>
          {guide.sourceLabel} ↗
        </a>
        <ul style={{ margin: '4px 0 0 0', paddingLeft: 16 }}>
          {guide.files.map((f) => (
            <li key={f.filename} style={{ marginBottom: 2 }}>
              {f.link} → <code style={{ fontSize: 10.5 }}>{f.filename}</code>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 4 }}>{guide.cadence}</div>
        {guide.note ? <div style={{ marginTop: 4, fontStyle: 'italic' }}>{guide.note}</div> : null}
      </div>

      <div style={{ background: '#f6f8fb', borderRadius: 6, padding: '8px 10px' }}>
        <div style={{ fontSize: 10, color: '#5a6e85', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
          Stored in the hub
        </div>
        {state == null ? (
          <div style={{ fontSize: 11, color: '#9aa9ba' }}>Loading…</div>
        ) : guide.kind === 'directory' ? (
          <DirectoryGrid state={state} />
        ) : guide.kind === 'lcgms' ? (
          <>
            <StoredLine label="Geocoded CSV" source={stored('lcgms_geo')} required />
            <StoredLine label="School Data export" source={stored('lcgms_beds')} required />
          </>
        ) : (
          <StoredLine source={stored(guide.kind)} required={guide.required} />
        )}
      </div>
    </div>
  );
}

function StoredLine({
  label,
  source,
  required,
}: {
  label?: string;
  source: StoredSource | undefined;
  required: boolean;
}): React.JSX.Element {
  return (
    <div style={{ fontSize: 11, marginBottom: 4 }}>
      {label ? <span style={{ color: '#5a6e85' }}>{label}: </span> : null}
      {source ? (
        <>
          <code style={{ fontSize: 10.5, wordBreak: 'break-all' }}>{source.filename}</code>
          <div style={{ color: '#5a6e85' }}>
            {source.summary}
            {source.uploadedAt ? ` · uploaded ${fmtDate(source.uploadedAt)}` : ''}
          </div>
        </>
      ) : (
        <span style={{ color: required ? '#c0392b' : '#9aa9ba' }}>Not uploaded yet</span>
      )}
    </div>
  );
}

function DirectoryGrid({ state }: { state: SourcesState }): React.JSX.Element {
  const dir = state.sources.filter((s) => s.kind === 'directory');
  const falls = [...new Set(dir.map((s) => Number(s.slot.split(':')[1])))].sort((a, b) => b - a);
  if (falls.length === 0) return <div style={{ fontSize: 11, color: '#9aa9ba' }}>No directory files uploaded yet</div>;
  const used = new Set(state.coverage?.directoryYearsUsed ?? []);
  return (
    <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ color: '#5a6e85', textAlign: 'left' }}>
          <th style={cellTh}>Fall</th>
          <th style={cellTh}>ES</th>
          <th style={cellTh}>MS</th>
          <th style={cellTh}>HS</th>
          <th style={cellTh}>Used for</th>
        </tr>
      </thead>
      <tbody>
        {falls.map((fall) => {
          const sy = `${fall}-${String((fall + 1) % 100).padStart(2, '0')}`;
          return (
            <tr key={fall} style={{ borderTop: '1px solid #e1e8ef' }}>
              <td style={cellTd}>{fall}</td>
              {(['es', 'ms', 'hs'] as const).map((l) => {
                const s = dir.find((d) => d.slot === `directory:${fall}:${l}`);
                return (
                  <td key={l} style={{ ...cellTd, color: s ? '#1f7a3a' : '#c0392b' }} title={s ? `${s.filename} — ${s.summary}` : 'Missing'}>
                    {s ? '✓' : '—'}
                  </td>
                );
              })}
              <td style={{ ...cellTd, color: used.has(sy) ? '#33455c' : '#a37800' }}>
                {used.has(sy) ? sy : `waiting for the ${sy} snapshot`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Badge({ versionId, updatedAt, rowCount }: InitialSchema): React.JSX.Element {
  return (
    <div style={{ textAlign: 'right' }}>
      <div
        style={{
          background: '#eaf3fb',
          color: '#027BC0',
          padding: '4px 10px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          display: 'inline-block',
        }}
      >
        {versionId == null ? 'No data yet' : `v${versionId}`} {updatedAt ? `· ${fmtDate(updatedAt)}` : ''}
      </div>
      <div style={{ fontSize: 11, color: '#9aa9ba', marginTop: 4 }}>{rowCount.toLocaleString()} rows</div>
    </div>
  );
}

function Callout({ tone, children }: { tone: 'error' | 'warn' | 'info'; children: React.ReactNode }): React.JSX.Element {
  const [bg, fg] = tone === 'error' ? ['#fdecea', '#c0392b'] : tone === 'warn' ? ['#fff7e0', '#a37800'] : ['#eaf3fb', '#1c4f73'];
  return (
    <div style={{ marginTop: 14, background: bg, color: fg, borderRadius: 6, padding: '10px 12px', fontSize: 12, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
  } catch {
    return iso;
  }
}

const cellTh: React.CSSProperties = { padding: '2px 4px', fontWeight: 600, fontSize: 10 };
const cellTd: React.CSSProperties = { padding: '3px 4px' };
const primaryBtn: React.CSSProperties = { background: '#027BC0', color: '#fff', border: 0, borderRadius: 4, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { background: '#fff', color: '#027BC0', border: '1px solid #c7d3e0', borderRadius: 4, padding: '8px 14px', fontSize: 13, cursor: 'pointer' };
const textBtn: React.CSSProperties = { background: 'none', color: '#5a6e85', border: 0, padding: '0 4px', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' };
