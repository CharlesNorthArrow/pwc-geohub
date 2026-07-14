'use client';

import { useState } from 'react';
import Modal from './Modal';
import type { PreviewResponse } from './UploadFlow';

export default function DiffPreview({
  preview,
  filename,
  onBack,
  onCancel,
  onConfirm,
  error,
}: {
  preview: PreviewResponse;
  filename: string;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: (notes: string) => Promise<void> | void;
  error: string | null;
}): React.JSX.Element {
  const [notes, setNotes] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Modal
      title={`Diff preview — ${filename}`}
      onClose={onCancel}
      width={820}
      footer={
        <>
          <button type="button" onClick={onBack} style={ghostBtn}>← Back to mapping</button>
          <button type="button" onClick={onCancel} style={ghostBtn}>Cancel</button>
          <button
            type="button"
            disabled={!preview.canApply}
            onClick={() => void onConfirm(notes)}
            style={{
              background: '#1f7a3a',
              color: '#fff',
              border: 0,
              borderRadius: 4,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: preview.canApply ? 'pointer' : 'not-allowed',
              opacity: preview.canApply ? 1 : 0.5,
            }}
          >
            Apply (write new version)
          </button>
        </>
      }
    >
      <SummaryRow s={preview.summary} />

      {preview.warnings.retainedFromCurrent > 0 ? (
        <Banner tone="info" title={`${preview.warnings.retainedFromCurrent} rows retained from current`}>
          Some (DBN, school_year) pairs in the active version are not in your upload. They will be
          kept as-is — the merge never deletes. If that's what you expected, no action is needed.
          {preview.retainedSample.length > 0 ? (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer' }}>Show sample ({preview.retainedSample.length})</summary>
              <SampleList rows={preview.retainedSample} />
            </details>
          ) : null}
        </Banner>
      ) : null}

      {preview.warnings.unknownDbnCount > 0 ? (
        <Banner tone="error" title={`${preview.warnings.unknownDbnCount} unknown DBN${preview.warnings.unknownDbnCount > 1 ? 's' : ''}`}>
          These DBNs aren't in the schools master, so they would fail to import:
          <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 11 }}>{preview.warnings.unknownDbns.join(', ')}</div>
          <div style={{ marginTop: 8 }}>Apply is disabled until these are removed or corrected in your file.</div>
        </Banner>
      ) : null}

      {(preview.warnings.duplicateRowCount ?? 0) > 0 ? (
        <Banner tone="warn" title={`${preview.warnings.duplicateRowCount} duplicate (DBN, school_year) rows in the upload`}>
          When the same key appears more than once, the LAST row in the file wins. If that's not
          intended, dedupe the source and re-upload.
        </Banner>
      ) : null}

      {(preview.warnings.fractionSuspectCount ?? 0) > 0 ? (
        <Banner tone="warn" title={`${preview.warnings.fractionSuspectCount} rows have percent-looking values in fraction columns`}>
          <code>pct_*</code> and <code>economic_need_index</code> are expected as fractions between
          0 and 1 (e.g. 0.85, not 85). Values above 1.5 were found in these rows — the dashboard
          would display them wrong. Double-check the source before applying.
          {(preview.warnings.fractionSuspectSample?.length ?? 0) > 0 ? (
            <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 11 }}>
              {preview.warnings.fractionSuspectSample!.join(', ')}
            </div>
          ) : null}
        </Banner>
      ) : null}

      {(preview.warnings.remappedDbnCount ?? 0) > 0 ? (
        <Banner tone="info" title={`${preview.warnings.remappedDbnCount} rows remapped 08X208 → 84X208`}>
          The charter-district DBN recode was applied automatically (same school, canonical code).
        </Banner>
      ) : null}

      {(preview.warnings.unplottableCount ?? 0) > 0 ? (
        <Banner tone="info" title={`${preview.warnings.unplottableCount} schools without coordinates`}>
          These schools have no latitude/longitude in any year, so they won't plot on the map
          (they still appear in lists and analytics). Historically ~5% of the master lacks
          coordinates — only worry if this number jumped.
          {(preview.warnings.unplottableSample?.length ?? 0) > 0 ? (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer' }}>Show sample ({preview.warnings.unplottableSample!.length})</summary>
              <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 11 }}>
                {preview.warnings.unplottableSample!.join(', ')}
              </div>
            </details>
          ) : null}
        </Banner>
      ) : null}

      {preview.updates.length > 0 ? (
        <Section title={`${preview.summary.updated} updated rows`}>
          <div style={{ border: '1px solid #e1e8ef', borderRadius: 6, maxHeight: 280, overflow: 'auto' }}>
            {preview.updates.slice(0, 200).map((u) => {
              const key = `${u.dbn}|${u.school_year}`;
              const isOpen = expanded === key;
              return (
                <div key={key} style={{ borderBottom: '1px solid #eef2f7' }}>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : key)}
                    style={{ width: '100%', textAlign: 'left', background: '#fff', border: 0, padding: '8px 10px', cursor: 'pointer', fontSize: 12 }}
                  >
                    <span style={{ fontFamily: 'monospace' }}>{u.dbn}</span> · {u.school_year} — {u.changedColumns.length} column{u.changedColumns.length > 1 ? 's' : ''}
                    <span style={{ float: 'right', color: '#5a6e85' }}>{isOpen ? '▾' : '▸'}</span>
                  </button>
                  {isOpen ? (
                    <table style={{ width: '100%', fontSize: 11, borderTop: '1px solid #eef2f7' }}>
                      <thead>
                        <tr style={{ background: '#f6f8fb' }}>
                          <th style={th}>Column</th>
                          <th style={th}>Before</th>
                          <th style={th}>After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {u.changedColumns.map((c) => (
                          <tr key={c} style={{ borderTop: '1px solid #eef2f7' }}>
                            <td style={td}><code>{c}</code></td>
                            <td style={td}>{fmtCell(u.before[c])}</td>
                            <td style={td}>{fmtCell(u.after[c])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>
              );
            })}
            {preview.summary.updated > Math.min(preview.updates.length, 200) ? (
              <div style={{ padding: '8px 10px', fontSize: 11, color: '#5a6e85' }}>
                Showing first {Math.min(preview.updates.length, 200)} of {preview.summary.updated}.
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {preview.addedSample.length > 0 ? (
        <Section title={`${preview.summary.added} new rows (sample)`}>
          <SampleList rows={preview.addedSample} />
        </Section>
      ) : null}

      <Section title="Notes (optional)">
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Why are you applying this update?"
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #c7d3e0', borderRadius: 4, boxSizing: 'border-box' }}
        />
      </Section>

      {error ? <Banner tone="error" title="Apply failed">{error}</Banner> : null}
    </Modal>
  );
}

function SummaryRow({ s }: { s: PreviewResponse['summary'] }): React.JSX.Element {
  const items: Array<[string, number, string]> = [
    ['new', s.added, '#1f7a3a'],
    ['updated', s.updated, '#a37800'],
    ['unchanged', s.unchanged, '#5a6e85'],
    ['retained', s.retained, '#5a6e85'],
    ['total in new version', s.newVersionRowCount, '#002040'],
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

function SampleList({ rows }: { rows: Array<{ dbn: string; school_year: string }> }): React.JSX.Element {
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#5a6e85', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {rows.map((r) => <span key={`${r.dbn}|${r.school_year}`}>{r.dbn}/{r.school_year}</span>)}
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

function Banner({ tone, title, children }: { tone: 'error' | 'warn' | 'info' | 'ok'; title: string; children: React.ReactNode }): React.JSX.Element {
  const palette = {
    error: { bg: '#fdecea', fg: '#c0392b' },
    warn: { bg: '#fff7e0', fg: '#a37800' },
    info: { bg: '#eaf3fb', fg: '#027BC0' },
    ok: { bg: '#e8f6ee', fg: '#1f7a3a' },
  }[tone];
  return (
    <div style={{ marginTop: 14, background: palette.bg, color: palette.fg, padding: 12, borderRadius: 6, fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

function fmtCell(v: unknown): string {
  if (v == null) return '∅';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left' };
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top', fontFamily: 'monospace' };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#5a6e85', border: '1px solid #c7d3e0', borderRadius: 4, padding: '8px 14px', fontSize: 13, cursor: 'pointer' };
