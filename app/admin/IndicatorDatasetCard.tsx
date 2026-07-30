'use client';

import { useState } from 'react';
import UploadFlow, { type DatasetConfig } from './UploadFlow';
import VersionHistory from './VersionHistory';
import ViewSchemaDialog from './ViewSchemaDialog';
import Modal from './Modal';
import type { DatasetGuidelines } from '../../src/registry/dataSources';

export interface IndicatorCardStatus {
  versionId: number | null;
  rowCount: number;
  updatedAt: string | null;
  latestYearLoaded: string | null;
}

/**
 * One School-indicator dataset card: latest-year badge, wishlist guidelines
 * with the source outlink, template + longitudinal downloads, and the guided
 * upload flow (reconcile → diff preview → apply) with version history.
 */
export default function IndicatorDatasetCard({
  id,
  title,
  description,
  indicators,
  guidelines,
  initialStatus,
}: {
  id: string;
  title: string;
  description: string;
  indicators: Array<{ id: string; shortLabel: string }>;
  guidelines: DatasetGuidelines;
  initialStatus: IndicatorCardStatus;
}): React.JSX.Element {
  const dataset: DatasetConfig = {
    basePath: `/api/admin/school-indicators/${id}`,
    datasetLabel: id,
  };
  const [status, setStatus] = useState<IndicatorCardStatus>(initialStatus);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const refresh = async (): Promise<void> => {
    try {
      const r = await fetch(`${dataset.basePath}/schema`);
      if (!r.ok) return;
      const body = (await r.json()) as {
        currentVersion: number | null;
        rowCount: number;
        updatedAt: string | null;
        latestYearLoaded: string | null;
      };
      setStatus({
        versionId: body.currentVersion,
        rowCount: body.rowCount,
        updatedAt: body.updatedAt,
        latestYearLoaded: body.latestYearLoaded,
      });
    } catch {
      // soft fail — the next page load re-reads the status server-side
    }
  };

  const hasData = status.versionId != null;

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e1e8ef',
        borderRadius: 8,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ fontSize: 10, color: '#5a6e85', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          School indicator
        </div>
        <div style={{ textAlign: 'right' }}>
          <span
            style={{
              background: status.latestYearLoaded ? '#eaf3fb' : '#eef2f7',
              color: status.latestYearLoaded ? '#027BC0' : '#9aa9ba',
              padding: '3px 9px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {status.latestYearLoaded ? `Latest: ${status.latestYearLoaded}` : 'No data yet'}
          </span>
          <div style={{ fontSize: 10, color: '#9aa9ba', marginTop: 4 }}>
            {hasData
              ? `v${status.versionId}${status.updatedAt ? ` · ${fmtDate(status.updatedAt)}` : ''} · ${status.rowCount.toLocaleString()} rows`
              : 'Run etl:indicator-init to seed'}
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: '#5a6e85', marginTop: 3, lineHeight: 1.45 }}>{description}</div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {indicators.map((ind) => (
          <span
            key={ind.id}
            style={{
              background: '#f6f8fb',
              color: '#5a6e85',
              border: '1px solid #e1e8ef',
              borderRadius: 999,
              padding: '2px 8px',
              fontSize: 10,
              whiteSpace: 'nowrap',
            }}
          >
            {ind.shortLabel}
          </span>
        ))}
      </div>

      <details style={{ fontSize: 12, lineHeight: 1.5 }}>
        <summary style={{ cursor: 'pointer', color: '#027BC0', fontWeight: 600 }}>
          How to update this data
        </summary>
        <ol style={{ margin: '8px 0 0 0', paddingLeft: 18, color: '#33455c' }}>
          {guidelines.steps.map((s) => (
            <li key={s} style={{ marginBottom: 4 }}>{s}</li>
          ))}
          <li style={{ marginBottom: 4 }}>
            Shape the CSV like the template ("Download template" below), then use "Update data…".
            Renamed columns are fine — the upload walks you through matching them.
          </li>
        </ol>
        <div
          style={{
            background: '#f6f8fb',
            borderRadius: 6,
            padding: '8px 10px',
            marginTop: 8,
            color: '#5a6e85',
            fontSize: 11,
          }}
        >
          {guidelines.fieldCalc.map((c) => (
            <div key={c} style={{ marginBottom: 4 }}>{c}</div>
          ))}
          {guidelines.notes ? (
            <div style={{ marginTop: 6, fontStyle: 'italic' }}>{guidelines.notes}</div>
          ) : null}
        </div>
        <div style={{ marginTop: 8 }}>
          <a
            href={guidelines.sourceUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#027BC0', fontWeight: 600, textDecoration: 'none' }}
          >
            Open source: {guidelines.sourceLabel} ↗
          </a>
        </div>
      </details>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
        <button type="button" onClick={() => setUploadOpen(true)} style={primaryBtn}>
          Update data…
        </button>
        <button type="button" onClick={() => setHistoryOpen(true)} style={secondaryBtn}>
          History…
        </button>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 11 }}>
        <button type="button" onClick={() => setSchemaOpen(true)} style={textBtn}>
          View schema
        </button>
        <span style={{ color: '#c7d3e0' }}>·</span>
        <button
          type="button"
          onClick={() => { window.location.href = `${dataset.basePath}/download`; }}
          style={textBtn}
          disabled={!hasData}
        >
          Download data
        </button>
        <span style={{ color: '#c7d3e0' }}>·</span>
        <button
          type="button"
          onClick={() => { window.location.href = `${dataset.basePath}/template`; }}
          style={textBtn}
        >
          Download template
        </button>
      </div>

      {uploadOpen ? (
        <UploadFlow
          dataset={dataset}
          onClose={() => setUploadOpen(false)}
          onApplied={async () => {
            setUploadOpen(false);
            await refresh();
            setHistoryKey((k) => k + 1);
          }}
        />
      ) : null}
      {schemaOpen ? (
        <ViewSchemaDialog
          basePath={dataset.basePath}
          datasetLabel={dataset.datasetLabel}
          onClose={() => setSchemaOpen(false)}
        />
      ) : null}
      {historyOpen ? (
        <Modal title={`Version history — ${title}`} onClose={() => setHistoryOpen(false)} width={760}>
          <VersionHistory
            refreshKey={historyKey}
            basePath={dataset.basePath}
            onRolledBack={async () => {
              await refresh();
              setHistoryKey((k) => k + 1);
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
  } catch {
    return iso;
  }
}

const primaryBtn: React.CSSProperties = {
  background: '#027BC0',
  color: '#fff',
  border: 0,
  borderRadius: 4,
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  background: '#fff',
  color: '#027BC0',
  border: '1px solid #c7d3e0',
  borderRadius: 4,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};

const textBtn: React.CSSProperties = {
  background: 'none',
  color: '#027BC0',
  border: 0,
  padding: 0,
  fontSize: 11,
  cursor: 'pointer',
  textDecoration: 'underline',
};
