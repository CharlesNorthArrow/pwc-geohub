'use client';

import { useState } from 'react';
import Modal from './Modal';
import TransformIssueList, { type TransformIssue } from './TransformIssueList';
import { MAX_UPLOAD_BYTES, TOO_LARGE_MESSAGE } from '../../src/admin/uploadLimits';
import type { MasterSourceGuide } from '../../src/registry/dataSources';

interface FileResult {
  file: string;
  slot: string | null;
  summary: string | null;
  replaced: string | null;
}

const ACCEPT: Record<MasterSourceGuide['kind'], string> = {
  snapshot: '.xlsx,.xls',
  directory: '.xlsx,.xls',
  lcgms: '.csv,.xls,.xlsx',
  community_schools: '.pdf',
};

/**
 * Upload the file(s) for ONE school-master source. Each file is checked to
 * really be this source, parsed and stored; the live master doesn't change
 * until "Rebuild master" is applied.
 */
export default function SourceUploadDialog({
  guide,
  onClose,
  onStored,
}: {
  guide: MasterSourceGuide;
  onClose: () => void;
  onStored: () => Promise<void>;
}): React.JSX.Element {
  const multiple = guide.kind === 'directory' || guide.kind === 'lcgms';
  const [picked, setPicked] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<FileResult[] | null>(null);
  const [issues, setIssues] = useState<TransformIssue[] | null>(null);
  const [warnings, setWarnings] = useState<TransformIssue[]>([]);
  const [stored, setStored] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooLarge = picked.reduce((s, f) => s + f.size, 0) > MAX_UPLOAD_BYTES;

  const upload = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setIssues(null);
    setResults(null);
    const fd = new FormData();
    fd.append('card', guide.kind);
    for (const f of picked) fd.append('file', f);
    const r = await fetch('/api/admin/school-master/sources/upload', { method: 'POST', body: fd });
    const body = (await r.json().catch(() => ({}))) as {
      error?: string;
      issues?: TransformIssue[];
      warnings?: TransformIssue[];
      files?: FileResult[];
    };
    setBusy(false);
    setResults(body.files ?? null);
    setWarnings(body.warnings ?? []);
    if (!r.ok) {
      if (body.error === 'schema_changed') setIssues(body.issues ?? []);
      else setError(body.error === 'file_too_large' ? TOO_LARGE_MESSAGE : (body.error ?? `HTTP ${r.status}`));
      return;
    }
    setStored(true);
    await onStored();
  };

  const blocked = busy || picked.length === 0 || tooLarge;
  return (
    <Modal
      title={`Upload — ${guide.title}`}
      onClose={onClose}
      width={600}
      footer={
        stored ? (
          <button type="button" onClick={onClose} style={primaryBtn}>
            Done
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} style={ghostBtn}>Cancel</button>
            <button
              type="button"
              disabled={blocked}
              onClick={() => void upload()}
              style={{ ...primaryBtn, opacity: blocked ? 0.5 : 1, cursor: blocked ? 'not-allowed' : 'pointer' }}
            >
              {busy ? 'Reading…' : 'Upload'}
            </button>
          </>
        )
      }
    >
      {!stored ? (
        <>
          <div style={{ fontSize: 12, color: '#5a6e85', lineHeight: 1.5, marginBottom: 10 }}>
            <div>
              Download from{' '}
              <a href={guide.sourceUrl} target="_blank" rel="noreferrer" style={{ color: '#027BC0' }}>
                {guide.sourceLabel} ↗
              </a>{' '}
              — {guide.fileCount}:
            </div>
            <ul style={{ margin: '4px 0 0 0', paddingLeft: 16 }}>
              {guide.files.map((f) => (
                <li key={f.filename}>
                  {f.link} → <code style={{ fontSize: 10.5 }}>{f.filename}</code>
                </li>
              ))}
            </ul>
            {guide.kind === 'directory' ? (
              <div style={{ marginTop: 4 }}>You can select several fall years at once.</div>
            ) : null}
            {guide.kind === 'lcgms' ? <div style={{ marginTop: 4 }}>Select both files together, or just the one that changed.</div> : null}
            <div style={{ marginTop: 4 }}>Upload the file(s) exactly as downloaded. The live master doesn&apos;t change until you rebuild it.</div>
          </div>
          <input
            type="file"
            accept={ACCEPT[guide.kind]}
            multiple={multiple}
            disabled={busy}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              setPicked(files);
              setIssues(null);
              setResults(null);
              setError(files.reduce((s, f) => s + f.size, 0) > MAX_UPLOAD_BYTES ? TOO_LARGE_MESSAGE : null);
            }}
          />
        </>
      ) : (
        <p style={{ marginTop: 0, fontSize: 13 }}>
          <strong>Stored.</strong> The live master is unchanged — click <strong>Rebuild master…</strong> when you&apos;ve loaded
          everything you want to apply.
        </p>
      )}

      {results && results.length > 0 ? (
        <table style={{ width: '100%', fontSize: 12, marginTop: 12, borderCollapse: 'collapse' }}>
          <tbody>
            {results.map((f) => (
              <tr key={f.file} style={{ borderTop: '1px solid #eef2f7' }}>
                <td style={{ padding: '5px 6px', fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{f.file}</td>
                <td style={{ padding: '5px 6px', color: f.slot ? '#1f7a3a' : '#c0392b' }}>
                  {f.slot ? `✓ ${f.summary}${f.replaced && stored ? ` (replaces ${f.replaced})` : ''}` : '✗ see below'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {issues ? (
        <Box tone="error">
          <strong>Nothing was stored.</strong> If DOE or NYSED changed the file&apos;s layout, the hub needs an update —
          send these details to North Arrow.
          <TransformIssueList issues={issues} />
        </Box>
      ) : null}
      {warnings.length > 0 && !issues ? (
        <Box tone="warn">
          <strong>Stored, with differences from past downloads</strong> — check the rebuild preview.
          <TransformIssueList issues={warnings} />
        </Box>
      ) : null}
      {error ? <Box tone="error">{error}</Box> : null}
    </Modal>
  );
}

function Box({ tone, children }: { tone: 'error' | 'warn'; children: React.ReactNode }): React.JSX.Element {
  const [bg, fg] = tone === 'error' ? ['#fdecea', '#c0392b'] : ['#fff7e0', '#a37800'];
  return <div style={{ marginTop: 12, padding: '8px 10px', background: bg, color: fg, fontSize: 12, borderRadius: 4 }}>{children}</div>;
}

const primaryBtn: React.CSSProperties = { background: '#027BC0', color: '#fff', border: 0, borderRadius: 4, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#5a6e85', border: '1px solid #c7d3e0', borderRadius: 4, padding: '8px 14px', fontSize: 13, cursor: 'pointer' };
