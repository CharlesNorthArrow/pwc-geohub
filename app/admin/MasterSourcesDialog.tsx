'use client';

import { useState } from 'react';
import Modal from './Modal';
import DiffPreview from './DiffPreview';
import TransformIssueList, { type TransformIssue } from './TransformIssueList';
import type { PreviewResponse } from './UploadFlow';
import { MAX_UPLOAD_BYTES, TOO_LARGE_MESSAGE } from '../../src/admin/uploadLimits';

const BASE = '/api/admin/school-master';
const NO_DECISIONS = { unmatched: [], acknowledgedMissing: {}, ignoredExtra: [] };

interface StagedFile {
  file: string;
  slot: string | null;
  summary: string | null;
  replaces: string | null;
}

type Step =
  | { kind: 'choose'; busy: boolean }
  | { kind: 'preview'; uploadId: string; filename: string; files: StagedFile[]; preview: PreviewResponse }
  | { kind: 'applying' }
  | { kind: 'done'; versionId: number; summary: PreviewResponse['summary']; warning: string | null };

/**
 * Update the school master from raw source files: pick any subset of the
 * source files (only the ones that changed), see what each was recognized
 * as, then the usual diff preview → apply. Blocking problems (unrecognized
 * file, drifted layout, two files for one source, a required source never
 * uploaded) stop before the preview with every issue listed.
 */
export default function MasterSourcesDialog({
  onClose,
  onApplied,
}: {
  onClose: () => void;
  onApplied: () => Promise<void>;
}): React.JSX.Element {
  const [step, setStep] = useState<Step>({ kind: 'choose', busy: false });
  const [picked, setPicked] = useState<File[]>([]);
  const [issues, setIssues] = useState<TransformIssue[] | null>(null);
  const [fileResults, setFileResults] = useState<StagedFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tooLarge = picked.reduce((s, f) => s + f.size, 0) > MAX_UPLOAD_BYTES;

  const upload = async (): Promise<void> => {
    setError(null);
    setIssues(null);
    setFileResults(null);
    setStep({ kind: 'choose', busy: true });
    const fd = new FormData();
    for (const f of picked) fd.append('file', f);
    const r = await fetch(`${BASE}/sources/upload`, { method: 'POST', body: fd });
    const body = (await r.json().catch(() => ({}))) as {
      error?: string;
      issues?: TransformIssue[];
      files?: StagedFile[];
      uploadId?: string;
      filename?: string;
    };
    if (!r.ok) {
      if (body.error === 'schema_changed') {
        setIssues(body.issues ?? []);
        setFileResults(body.files ?? null);
      } else setError(body.error === 'file_too_large' ? TOO_LARGE_MESSAGE : (body.error ?? `HTTP ${r.status}`));
      setStep({ kind: 'choose', busy: false });
      return;
    }
    const pr = await fetch(`${BASE}/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadId: body.uploadId, decisions: NO_DECISIONS }),
    });
    if (!pr.ok) {
      const pb = (await pr.json().catch(() => ({}))) as { error?: string };
      setError(pb.error ?? `Preview failed (HTTP ${pr.status})`);
      setStep({ kind: 'choose', busy: false });
      return;
    }
    setStep({
      kind: 'preview',
      uploadId: body.uploadId!,
      filename: body.filename!,
      files: body.files ?? [],
      preview: (await pr.json()) as PreviewResponse,
    });
  };

  const apply = async (notes: string): Promise<void> => {
    if (step.kind !== 'preview') return;
    const prev = step;
    setError(null);
    setStep({ kind: 'applying' });
    const r = await fetch(`${BASE}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadId: prev.uploadId, decisions: NO_DECISIONS, notes }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      error?: string;
      versionId?: number;
      summary?: PreviewResponse['summary'];
      blobWarning?: string | null;
    };
    if (!r.ok) {
      setError(body.error === 'upload_expired' ? 'The upload expired — please upload the files again.' : (body.error ?? `HTTP ${r.status}`));
      setStep(prev);
      return;
    }
    setStep({ kind: 'done', versionId: body.versionId!, summary: body.summary!, warning: body.blobWarning ?? null });
  };

  if (step.kind === 'preview') {
    return (
      <DiffPreview
        preview={step.preview}
        filename={step.files.length === 1 ? step.files[0]!.file : `${step.files.length} source files`}
        backLabel="← Back"
        onBack={() => setStep({ kind: 'choose', busy: false })}
        onCancel={onClose}
        onConfirm={apply}
        error={error}
      />
    );
  }

  if (step.kind === 'applying') {
    return (
      <Modal title="Applying…" onClose={() => { /* wait it out */ }}>
        Writing the new version and refreshing school ↔ geography assignments… do not close.
      </Modal>
    );
  }

  if (step.kind === 'done') {
    return (
      <Modal
        title={`Applied — v${step.versionId}`}
        onClose={() => void onApplied()}
        footer={
          <button type="button" onClick={() => void onApplied()} style={primaryBtn}>
            Done
          </button>
        }
      >
        <p style={{ marginTop: 0 }}>
          Version <strong>v{step.versionId}</strong> is live, and the uploaded files are now the stored sources.
        </p>
        <ul style={{ fontSize: 13, color: '#5a6e85' }}>
          <li>{step.summary.added} new rows</li>
          <li>{step.summary.updated} updated rows</li>
          <li>{step.summary.unchanged} unchanged</li>
          <li>{step.summary.newVersionRowCount} total in the new version</li>
        </ul>
        {step.warning ? <Box tone="warn">{step.warning}</Box> : null}
      </Modal>
    );
  }

  const busy = step.busy;
  const blocked = busy || picked.length === 0 || tooLarge;
  return (
    <Modal
      title="Update school master sources"
      onClose={onClose}
      width={640}
      footer={
        <>
          <button type="button" onClick={onClose} style={ghostBtn}>Cancel</button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => void upload()}
            style={{ ...primaryBtn, opacity: blocked ? 0.5 : 1, cursor: blocked ? 'not-allowed' : 'pointer' }}
          >
            {busy ? 'Reading files & rebuilding…' : 'Upload & preview'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, fontSize: 13, color: '#5a6e85', lineHeight: 1.5 }}>
        Select only the file(s) that changed, exactly as downloaded — e.g. the new Demographic Snapshot, or this
        fall&apos;s three Directory files. The hub recognizes each file, rebuilds the master from these plus the
        stored sources, and shows you what changes before anything is saved.
      </p>
      <input
        type="file"
        multiple
        accept=".xlsx,.xls,.csv,.pdf"
        disabled={busy}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          setPicked(files);
          setIssues(null);
          setFileResults(null);
          setError(files.reduce((s, f) => s + f.size, 0) > MAX_UPLOAD_BYTES ? TOO_LARGE_MESSAGE : null);
        }}
      />
      {picked.length > 0 ? (
        <div style={{ fontSize: 12, color: '#5a6e85', marginTop: 8 }}>
          {picked.length} file{picked.length > 1 ? 's' : ''} selected
          {busy ? ' — large spreadsheets take a few seconds each.' : ''}
        </div>
      ) : null}

      {fileResults && fileResults.length > 0 ? (
        <table style={{ width: '100%', fontSize: 12, marginTop: 12, borderCollapse: 'collapse' }}>
          <tbody>
            {fileResults.map((f) => (
              <tr key={f.file} style={{ borderTop: '1px solid #eef2f7' }}>
                <td style={{ padding: '5px 6px', fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{f.file}</td>
                <td style={{ padding: '5px 6px', color: f.slot ? '#1f7a3a' : '#c0392b' }}>
                  {f.slot ? `✓ ${f.summary}` : '✗ not usable — see below'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {issues ? (
        <Box tone="error">
          <strong>Nothing was uploaded.</strong> Fix the problem(s) below and try again. If DOE or NYSED changed a
          file&apos;s layout, the hub needs an update — send these details to North Arrow.
          <TransformIssueList issues={issues} />
        </Box>
      ) : null}
      {error ? <Box tone="error">{error}</Box> : null}
    </Modal>
  );
}

function Box({ tone, children }: { tone: 'error' | 'warn'; children: React.ReactNode }): React.JSX.Element {
  const [bg, fg] = tone === 'error' ? ['#fdecea', '#c0392b'] : ['#fff7e0', '#a37800'];
  return (
    <div style={{ marginTop: 12, padding: '8px 10px', background: bg, color: fg, fontSize: 12, borderRadius: 4 }}>
      {children}
    </div>
  );
}

const primaryBtn: React.CSSProperties = { background: '#027BC0', color: '#fff', border: 0, borderRadius: 4, padding: '8px 14px', fontSize: 13, fontWeight: 600 };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#5a6e85', border: '1px solid #c7d3e0', borderRadius: 4, padding: '8px 14px', fontSize: 13, cursor: 'pointer' };
