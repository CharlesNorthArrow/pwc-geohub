'use client';

import { useState } from 'react';
import Modal from './Modal';
import ColumnReconciliationDialog from './ColumnReconciliationDialog';
import DiffPreview from './DiffPreview';

interface Classification {
  matched: Array<{ csvHeader: string; fieldId: string; viaAlias?: boolean }>;
  unmatched: Array<{ csvHeader: string; suggestions: Array<{ fieldId: string; score: number }> }>;
  missing: Array<{ fieldId: string; isKey: boolean }>;
  extra: Array<{ csvHeader: string }>;
}

interface UploadResponse {
  uploadId: string;
  filename: string;
  rowCount: number;
  headers: string[];
  classification: Classification;
}

export interface Decisions {
  unmatched: Array<{ kind: 'map'; csvHeader: string; fieldId: string } | { kind: 'ignore'; csvHeader: string }>;
  acknowledgedMissing: Record<string, boolean>;
  ignoredExtra: string[];
}

export interface PreviewResponse {
  summary: { added: number; updated: number; unchanged: number; retained: number; newVersionRowCount: number };
  updates: Array<{ dbn: string; school_year: string; changedColumns: string[]; before: Record<string, unknown>; after: Record<string, unknown> }>;
  addedSample: Array<{ dbn: string; school_year: string }>;
  retainedSample: Array<{ dbn: string; school_year: string }>;
  warnings: { unknownDbns: string[]; unknownDbnCount: number; retainedFromCurrent: number };
  canApply: boolean;
  currentVersionId: number | null;
}

type Step =
  | { kind: 'choose' }
  | { kind: 'uploading' }
  | { kind: 'reconcile'; upload: UploadResponse }
  | { kind: 'reviewing'; upload: UploadResponse; decisions: Decisions }
  | { kind: 'preview'; upload: UploadResponse; decisions: Decisions; preview: PreviewResponse }
  | { kind: 'applying' }
  | { kind: 'done'; versionId: number; summary: PreviewResponse['summary']; blobWarning: string | null };

export default function UploadFlow({
  onClose,
  onApplied,
}: {
  onClose: () => void;
  onApplied: () => Promise<void>;
}): React.JSX.Element {
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [error, setError] = useState<string | null>(null);

  const uploadFile = async (file: File): Promise<void> => {
    setError(null);
    setStep({ kind: 'uploading' });
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/admin/pwc/upload', { method: 'POST', body: fd });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `HTTP ${r.status}`);
      setStep({ kind: 'choose' });
      return;
    }
    const upload = (await r.json()) as UploadResponse;
    // If nothing needs reconciliation, skip straight to preview.
    const needs =
      upload.classification.unmatched.length > 0 ||
      upload.classification.missing.length > 0 ||
      upload.classification.extra.length > 0;
    if (!needs) {
      const decisions: Decisions = { unmatched: [], acknowledgedMissing: {}, ignoredExtra: [] };
      await runPreview(upload, decisions);
    } else {
      setStep({ kind: 'reconcile', upload });
    }
  };

  const runPreview = async (upload: UploadResponse, decisions: Decisions): Promise<void> => {
    setError(null);
    setStep({ kind: 'reviewing', upload, decisions });
    const r = await fetch('/api/admin/pwc/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadId: upload.uploadId, decisions }),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string; errors?: string[] };
      setError(body.errors?.join('\n') ?? body.error ?? `HTTP ${r.status}`);
      setStep({ kind: 'reconcile', upload });
      return;
    }
    const preview = (await r.json()) as PreviewResponse;
    setStep({ kind: 'preview', upload, decisions, preview });
  };

  const apply = async (notes: string): Promise<void> => {
    if (step.kind !== 'preview') return;
    setError(null);
    const { upload, decisions } = step;
    setStep({ kind: 'applying' });
    const r = await fetch('/api/admin/pwc/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadId: upload.uploadId, decisions, notes }),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string; errors?: string[]; message?: string };
      setError(body.message ?? body.errors?.join('\n') ?? body.error ?? `HTTP ${r.status}`);
      setStep({ kind: 'preview', upload, decisions, preview: step.preview });
      return;
    }
    const body = (await r.json()) as { versionId: number; summary: PreviewResponse['summary']; blobWarning: string | null };
    setStep({ kind: 'done', versionId: body.versionId, summary: body.summary, blobWarning: body.blobWarning });
  };

  // --- Rendering ----
  if (step.kind === 'choose' || step.kind === 'uploading') {
    return (
      <Modal title="Upload pwc_schools CSV" onClose={onClose} width={560}>
        <p style={{ marginTop: 0, fontSize: 13, color: '#5a6e85' }}>
          Pick the new CSV. The server compares its columns against the current schema before merging.
          Each row is keyed (DBN, school_year): existing rows get updated where values changed; new
          rows are appended; rows present today but missing from your file are <em>kept</em>.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={step.kind === 'uploading'}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadFile(f);
          }}
        />
        {step.kind === 'uploading' ? (
          <div style={{ marginTop: 10, fontSize: 13 }}>Parsing & classifying…</div>
        ) : null}
        {error ? <ErrorBox text={error} /> : null}
      </Modal>
    );
  }

  if (step.kind === 'reconcile') {
    return (
      <ColumnReconciliationDialog
        upload={step.upload}
        onCancel={onClose}
        onSubmit={(decisions) => runPreview(step.upload, decisions)}
        error={error}
      />
    );
  }

  if (step.kind === 'reviewing') {
    return (
      <Modal title="Previewing diff…" onClose={onClose}>
        Computing diff against the active version…
      </Modal>
    );
  }

  if (step.kind === 'preview') {
    return (
      <DiffPreview
        preview={step.preview}
        filename={step.upload.filename}
        onBack={() => setStep({ kind: 'reconcile', upload: step.upload })}
        onCancel={onClose}
        onConfirm={apply}
        error={error}
      />
    );
  }

  if (step.kind === 'applying') {
    return (
      <Modal title="Applying…" onClose={() => { /* nothing — wait it out */ }}>
        Writing new version… do not close.
      </Modal>
    );
  }

  // done
  return (
    <Modal
      title={`Applied — v${step.versionId}`}
      onClose={async () => { await onApplied(); }}
      footer={
        <button
          type="button"
          onClick={async () => { await onApplied(); }}
          style={{ background: '#027BC0', color: '#fff', border: 0, borderRadius: 4, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}
        >
          Done
        </button>
      }
    >
      <p style={{ marginTop: 0 }}>
        Version <strong>v{step.versionId}</strong> is now live.
      </p>
      <ul style={{ fontSize: 13, color: '#5a6e85' }}>
        <li>{step.summary.added} new rows</li>
        <li>{step.summary.updated} updated rows</li>
        <li>{step.summary.unchanged} unchanged</li>
        <li>{step.summary.retained} retained (present before, absent from this upload)</li>
        <li>{step.summary.newVersionRowCount} total in new version</li>
      </ul>
      {step.blobWarning ? <ErrorBox text={step.blobWarning} tone="warn" /> : null}
    </Modal>
  );
}

function ErrorBox({ text, tone = 'error' }: { text: string; tone?: 'error' | 'warn' }): React.JSX.Element {
  const bg = tone === 'error' ? '#fdecea' : '#fff7e0';
  const fg = tone === 'error' ? '#c0392b' : '#a37800';
  return (
    <div style={{ marginTop: 12, padding: '8px 10px', background: bg, color: fg, fontSize: 12, borderRadius: 4, whiteSpace: 'pre-wrap' }}>
      {text}
    </div>
  );
}
