'use client';

import { useState } from 'react';
import Modal from './Modal';
import ColumnReconciliationDialog from './ColumnReconciliationDialog';
import DiffPreview from './DiffPreview';
import TransformIssueList, { type TransformIssue } from './TransformIssueList';
import { guessSchoolYearFromFilename } from '../../src/lib/schoolYear';

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
  /** Rows were computed from raw DOE file(s) by the dataset's transform. */
  transformed?: boolean;
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
  warnings: {
    unknownDbns: string[];
    unknownDbnCount: number;
    retainedFromCurrent: number;
    // schools_master-only data-quality signals (absent in the pwc flow).
    remappedDbnCount?: number;
    duplicateRowCount?: number;
    unplottableCount?: number;
    unplottableSample?: string[];
    fractionSuspectCount?: number;
    fractionSuspectSample?: string[];
    // school-indicator-only data-quality signals.
    sentinelNulledCount?: number;
    newYears?: string[];
    cohortDerivedCount?: number;
    cohortMismatchCount?: number;
    // raw-file transform (school indicators).
    transformWarnings?: TransformIssue[];
    transformSourceFiles?: string[];
  };
  canApply: boolean;
  currentVersionId: number | null;
}

/** Which dataset an upload dialog talks to. Defaults preserve the pwc flow. */
export interface DatasetConfig {
  /** API prefix, e.g. '/api/admin/pwc' or '/api/admin/school-master'. */
  basePath: string;
  /** Dataset name shown in dialog titles, e.g. 'pwc_schools'. */
  datasetLabel: string;
  /** School indicators: upload the raw DOE file(s); the server transforms them. */
  raw?: RawUploadConfig;
}

export interface RawUploadConfig {
  multiFile: boolean;
  yearSource: 'in_file' | 'filename_or_pick' | 'filename_code';
  /** File-input accept list, e.g. '.xlsx,.xls'. */
  accepts: string;
  /** School years offered by the year picker. */
  yearOptions: readonly string[];
  sourceLabel: string;
}

export const PWC_DATASET: DatasetConfig = { basePath: '/api/admin/pwc', datasetLabel: 'pwc_schools' };

type Step =
  | { kind: 'choose' }
  | { kind: 'uploading' }
  | { kind: 'reconcile'; upload: UploadResponse }
  | { kind: 'reviewing'; upload: UploadResponse; decisions: Decisions }
  | { kind: 'preview'; upload: UploadResponse; decisions: Decisions; preview: PreviewResponse }
  | { kind: 'applying' }
  | {
      kind: 'done';
      versionId: number;
      summary: PreviewResponse['summary'];
      blobWarning: string | null;
      skippedUnknownDbns: string[];
    };

export default function UploadFlow({
  onClose,
  onApplied,
  dataset = PWC_DATASET,
}: {
  onClose: () => void;
  onApplied: () => Promise<void>;
  dataset?: DatasetConfig;
}): React.JSX.Element {
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<TransformIssue[] | null>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const [year, setYear] = useState('');

  const raw = dataset.raw;
  const needsYear =
    raw != null &&
    raw.yearSource === 'filename_or_pick' &&
    picked.length === 1 &&
    !picked[0]!.name.toLowerCase().endsWith('.csv');

  const pickFiles = (files: File[]): void => {
    setPicked(files);
    setIssues(null);
    setError(null);
    const guess = files.length === 1 ? guessSchoolYearFromFilename(files[0]!.name) : null;
    setYear(guess && raw?.yearOptions.includes(guess) ? guess : '');
  };

  const uploadFile = async (files: File[], schoolYear?: string): Promise<void> => {
    setError(null);
    setIssues(null);
    setStep({ kind: 'uploading' });
    const fd = new FormData();
    for (const f of files) fd.append('file', f);
    if (schoolYear) fd.append('schoolYear', schoolYear);
    const r = await fetch(`${dataset.basePath}/upload`, { method: 'POST', body: fd });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string; issues?: TransformIssue[] };
      if (body.error === 'schema_changed' && body.issues) setIssues(body.issues);
      else if (body.error === 'file_too_large') setError('The upload is larger than 95 MB.');
      else setError(body.error ?? `HTTP ${r.status}`);
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
    const r = await fetch(`${dataset.basePath}/preview`, {
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
    const r = await fetch(`${dataset.basePath}/apply`, {
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
    const body = (await r.json()) as {
      versionId: number;
      summary: PreviewResponse['summary'];
      blobWarning: string | null;
      skippedUnknownDbns?: string[];
    };
    setStep({
      kind: 'done',
      versionId: body.versionId,
      summary: body.summary,
      blobWarning: body.blobWarning,
      skippedUnknownDbns: body.skippedUnknownDbns ?? [],
    });
  };

  // --- Rendering ----
  if (raw && (step.kind === 'choose' || step.kind === 'uploading')) {
    const busy = step.kind === 'uploading';
    const blocked = busy || picked.length === 0 || (needsYear && !year);
    return (
      <Modal
        title={`Update ${dataset.datasetLabel}`}
        onClose={onClose}
        width={600}
        footer={
          <>
            <button type="button" onClick={onClose} style={ghostBtn}>Cancel</button>
            <button
              type="button"
              disabled={blocked}
              onClick={() => void uploadFile(picked, needsYear ? year : undefined)}
              style={{ ...primaryBtn, opacity: blocked ? 0.5 : 1, cursor: blocked ? 'not-allowed' : 'pointer' }}
            >
              {busy ? 'Checking…' : 'Upload & check'}
            </button>
          </>
        }
      >
        <p style={{ marginTop: 0, fontSize: 13, color: '#5a6e85', lineHeight: 1.5 }}>
          Upload the file{raw.multiFile ? '(s)' : ''} exactly as downloaded from {raw.sourceLabel} — no
          editing needed. The hub checks the file&apos;s structure, computes the indicator values, and
          shows you a preview before anything changes.
        </p>
        {raw.yearSource === 'filename_code' ? (
          <p style={{ fontSize: 12, color: '#5a6e85' }}>
            Select all the school-type files for the year together (EMS, HS, Transfer HS, D75, Early
            Childhood). Keep DOE&apos;s filenames — the year and school type are read from them.
          </p>
        ) : null}
        <input
          type="file"
          accept={`${raw.accepts},.csv`}
          multiple={raw.multiFile}
          disabled={busy}
          onChange={(e) => pickFiles(Array.from(e.target.files ?? []))}
        />
        {picked.length > 1 ? (
          <div style={{ fontSize: 12, color: '#5a6e85', marginTop: 8 }}>
            {picked.length} files selected
            {raw.yearSource === 'filename_or_pick' ? " — each file's school year is read from its filename." : '.'}
          </div>
        ) : null}
        {needsYear ? (
          <label style={{ display: 'block', marginTop: 12, fontSize: 13 }}>
            School year this file covers
            <select value={year} onChange={(e) => setYear(e.target.value)} disabled={busy} style={{ marginLeft: 8 }}>
              <option value="">Select…</option>
              {raw.yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: '#9aa9ba', marginTop: 4 }}>
              {guessSchoolYearFromFilename(picked[0]!.name)
                ? 'Pre-filled from the filename — please confirm.'
                : "The filename doesn't say which year — please pick it."}
            </div>
          </label>
        ) : null}
        {issues ? (
          <ErrorBox
            text={
              <>
                <strong>The file&apos;s structure changed beyond what the transformation can handle.</strong>{' '}
                Nothing was uploaded. If DOE changed the file format, the transformation needs an update —
                send these details to North Arrow.
                <TransformIssueList issues={issues} />
              </>
            }
          />
        ) : null}
        {error ? <ErrorBox text={error} /> : null}
        <p style={{ fontSize: 11, color: '#9aa9ba', marginTop: 14, marginBottom: 0 }}>
          Correcting values by hand? Upload a CSV shaped like the template (&quot;Download template&quot;
          on the card) instead — it goes through column matching as before.
        </p>
      </Modal>
    );
  }

  if (step.kind === 'choose' || step.kind === 'uploading') {
    return (
      <Modal title={`Upload ${dataset.datasetLabel} CSV`} onClose={onClose} width={560}>
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
            if (f) void uploadFile([f]);
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
        backLabel={step.upload.transformed ? '← Back' : undefined}
        onBack={() =>
          setStep(step.upload.transformed ? { kind: 'choose' } : { kind: 'reconcile', upload: step.upload })
        }
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
      {step.skippedUnknownDbns.length > 0 ? (
        <ErrorBox
          tone="warn"
          text={
            `${step.skippedUnknownDbns.length} school(s) not in the schools master were kept in the version ` +
            `but are NOT live on the dashboard: ${step.skippedUnknownDbns.join(', ')}. ` +
            `They'll go live automatically on the next update after those schools appear in the master.`
          }
        />
      ) : null}
      {step.blobWarning ? <ErrorBox text={step.blobWarning} tone="warn" /> : null}
    </Modal>
  );
}

const primaryBtn: React.CSSProperties = { background: '#027BC0', color: '#fff', border: 0, borderRadius: 4, padding: '8px 14px', fontSize: 13, fontWeight: 600 };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#5a6e85', border: '1px solid #c7d3e0', borderRadius: 4, padding: '8px 14px', fontSize: 13, cursor: 'pointer' };

function ErrorBox({ text, tone = 'error' }: { text: React.ReactNode; tone?: 'error' | 'warn' }): React.JSX.Element {
  const bg = tone === 'error' ? '#fdecea' : '#fff7e0';
  const fg = tone === 'error' ? '#c0392b' : '#a37800';
  return (
    <div style={{ marginTop: 12, padding: '8px 10px', background: bg, color: fg, fontSize: 12, borderRadius: 4, whiteSpace: 'pre-wrap' }}>
      {text}
    </div>
  );
}
