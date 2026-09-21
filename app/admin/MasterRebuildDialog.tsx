'use client';

import { useEffect, useState } from 'react';
import Modal from './Modal';
import DiffPreview from './DiffPreview';
import TransformIssueList, { type TransformIssue } from './TransformIssueList';
import type { PreviewResponse } from './UploadFlow';

const BASE = '/api/admin/school-master';
const NO_DECISIONS = { unmatched: [], acknowledgedMissing: {}, ignoredExtra: [] };

type Step =
  | { kind: 'building' }
  | { kind: 'blocked'; issues: TransformIssue[] }
  | { kind: 'preview'; uploadId: string; preview: PreviewResponse }
  | { kind: 'applying' }
  | { kind: 'done'; versionId: number; summary: PreviewResponse['summary']; warning: string | null };

/**
 * "Rebuild master": build the master from every stored source, show the
 * usual diff preview (with what the sources cover), then apply. Sources are
 * loaded beforehand, one card at a time (SourceUploadDialog).
 */
export default function MasterRebuildDialog({
  onClose,
  onApplied,
}: {
  onClose: () => void;
  onApplied: () => Promise<void>;
}): React.JSX.Element {
  const [step, setStep] = useState<Step>({ kind: 'building' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await fetch(`${BASE}/sources/rebuild`, { method: 'POST' });
      const body = (await r.json().catch(() => ({}))) as { error?: string; issues?: TransformIssue[]; uploadId?: string };
      if (cancelled) return;
      if (!r.ok) {
        setStep({ kind: 'blocked', issues: body.issues ?? [{ code: 'error', message: body.error ?? `HTTP ${r.status}` }] });
        return;
      }
      const pr = await fetch(`${BASE}/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uploadId: body.uploadId, decisions: NO_DECISIONS }),
      });
      if (cancelled) return;
      if (!pr.ok) {
        const pb = (await pr.json().catch(() => ({}))) as { error?: string };
        setStep({ kind: 'blocked', issues: [{ code: 'preview_failed', message: pb.error ?? `Preview failed (HTTP ${pr.status})` }] });
        return;
      }
      setStep({ kind: 'preview', uploadId: body.uploadId!, preview: (await pr.json()) as PreviewResponse });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      setError(body.error === 'upload_expired' ? 'The preview expired — close and click Rebuild master… again.' : (body.error ?? `HTTP ${r.status}`));
      setStep(prev);
      return;
    }
    setStep({ kind: 'done', versionId: body.versionId!, summary: body.summary!, warning: body.blobWarning ?? null });
  };

  if (step.kind === 'building') {
    return (
      <Modal title="Rebuilding the master…" onClose={onClose}>
        Building from the stored sources and comparing with the live version…
      </Modal>
    );
  }

  if (step.kind === 'blocked') {
    return (
      <Modal title="Can't rebuild yet" onClose={onClose}>
        <div style={{ padding: '8px 10px', background: '#fff7e0', color: '#a37800', fontSize: 12, borderRadius: 4 }}>
          <TransformIssueList issues={step.issues} />
        </div>
      </Modal>
    );
  }

  if (step.kind === 'preview') {
    return (
      <DiffPreview
        preview={step.preview}
        filename="rebuild from stored sources"
        backLabel="Close"
        onBack={onClose}
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

  return (
    <Modal
      title={`Applied — v${step.versionId}`}
      onClose={() => void onApplied()}
      footer={
        <button
          type="button"
          onClick={() => void onApplied()}
          style={{ background: '#027BC0', color: '#fff', border: 0, borderRadius: 4, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          Done
        </button>
      }
    >
      <p style={{ marginTop: 0 }}>
        Version <strong>v{step.versionId}</strong> is live.
      </p>
      <ul style={{ fontSize: 13, color: '#5a6e85' }}>
        <li>{step.summary.added} new rows</li>
        <li>{step.summary.updated} updated rows</li>
        <li>{step.summary.unchanged} unchanged</li>
        <li>{step.summary.newVersionRowCount} total in the new version</li>
      </ul>
      {step.warning ? (
        <div style={{ padding: '8px 10px', background: '#fff7e0', color: '#a37800', fontSize: 12, borderRadius: 4 }}>{step.warning}</div>
      ) : null}
    </Modal>
  );
}
