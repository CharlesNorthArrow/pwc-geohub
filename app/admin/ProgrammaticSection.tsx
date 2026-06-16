'use client';

import { useEffect, useState } from 'react';
import UploadFlow from './UploadFlow';
import VersionHistory from './VersionHistory';
import ViewSchemaDialog from './ViewSchemaDialog';

interface InitialSchema {
  versionId: number | null;
  rowCount: number;
  updatedAt: string | null;
}

export default function ProgrammaticSection({
  initialSchema,
}: {
  initialSchema: InitialSchema;
}): React.JSX.Element {
  const [versionsKey, setVersionsKey] = useState(0); // bump to force-refresh
  const [activeVersion, setActiveVersion] = useState<InitialSchema>(initialSchema);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);

  const refreshActive = async (): Promise<void> => {
    try {
      const r = await fetch('/api/admin/pwc/schema');
      if (!r.ok) return;
      const body = (await r.json()) as { currentVersion: number | null; rowCount: number; updatedAt: string | null };
      setActiveVersion({
        versionId: body.currentVersion,
        rowCount: body.rowCount,
        updatedAt: body.updatedAt,
      });
    } catch {
      // soft fail — the version history fetch is the user-visible source of truth
    }
  };

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e1e8ef',
        borderRadius: 8,
        padding: 20,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#5a6e85', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            PWC Programmatic data
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, marginTop: 2 }}>pwc_schools</div>
          <div style={{ fontSize: 12, color: '#5a6e85', marginTop: 6, maxWidth: 540, lineHeight: 1.45 }}>
            PWC's school × school_year program panel — anchor / healing-arts flags, cohort, social-work
            counts, programs. Keyed (DBN, school_year). Uploaded as CSV; merged into the live table
            with update + append (rows that already exist are updated, rows present in the current
            data but absent from your upload are kept).
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <Badge versionId={activeVersion.versionId} updatedAt={activeVersion.updatedAt} rowCount={activeVersion.rowCount} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <PrimaryButton onClick={() => setUploadOpen(true)}>Update data…</PrimaryButton>
        <SecondaryButton onClick={() => setSchemaOpen(true)}>View schema</SecondaryButton>
        <SecondaryButton
          onClick={() => {
            window.location.href = '/api/admin/pwc/download';
          }}
        >
          Download current CSV
        </SecondaryButton>
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ fontSize: 12, color: '#5a6e85', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Version history
        </div>
        <VersionHistory
          refreshKey={versionsKey}
          onRolledBack={async () => {
            await refreshActive();
            setVersionsKey((k) => k + 1);
          }}
        />
      </div>

      {uploadOpen ? (
        <UploadFlow
          onClose={() => setUploadOpen(false)}
          onApplied={async () => {
            setUploadOpen(false);
            await refreshActive();
            setVersionsKey((k) => k + 1);
          }}
        />
      ) : null}
      {schemaOpen ? <ViewSchemaDialog onClose={() => setSchemaOpen(false)} /> : null}
    </div>
  );
}

function Badge({
  versionId,
  updatedAt,
  rowCount,
}: {
  versionId: number | null;
  updatedAt: string | null;
  rowCount: number;
}): React.JSX.Element {
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
      <div style={{ fontSize: 11, color: '#9aa9ba', marginTop: 4 }}>{rowCount} rows</div>
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function PrimaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: '#027BC0',
        color: '#fff',
        border: 0,
        borderRadius: 4,
        padding: '8px 14px',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: '#fff',
        color: '#027BC0',
        border: '1px solid #c7d3e0',
        borderRadius: 4,
        padding: '8px 14px',
        fontSize: 13,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
