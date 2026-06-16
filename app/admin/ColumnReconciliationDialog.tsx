'use client';

import { useMemo, useState } from 'react';
import Modal from './Modal';
import type { Decisions } from './UploadFlow';

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

/**
 * Two responsibilities:
 *  - Collect a decision for every unmatched column (map → schema field OR ignore).
 *  - Collect explicit acknowledgments for missing DATA columns.
 *  - Hard block KEY-column-missing.
 *
 * The dialog never auto-applies suggestions — every unmatched row starts at
 * "Pending" and won't pass validation until the admin picks. The server
 * re-validates regardless.
 */
export default function ColumnReconciliationDialog({
  upload,
  onCancel,
  onSubmit,
  error,
}: {
  upload: UploadResponse;
  onCancel: () => void;
  onSubmit: (d: Decisions) => Promise<void> | void;
  error: string | null;
}): React.JSX.Element {
  const cls = upload.classification;

  // Map each unmatched header → { mode: 'pending'|'map'|'ignore', fieldId?: string }
  const [unmatched, setUnmatched] = useState<Record<string, { mode: 'pending' | 'map' | 'ignore'; fieldId?: string }>>(
    () => Object.fromEntries(cls.unmatched.map((u) => [u.csvHeader, { mode: 'pending' as const }])),
  );
  const [ack, setAck] = useState<Record<string, boolean>>({});

  const missingKeyHardBlock = cls.missing.some((m) => m.isKey);

  // Validation (client-side; server re-runs).
  const issues = useMemo<string[]>(() => {
    const out: string[] = [];
    if (missingKeyHardBlock) {
      out.push(
        `Hard block: missing key column${cls.missing.filter((m) => m.isKey).length > 1 ? 's' : ''} ${cls.missing.filter((m) => m.isKey).map((m) => m.fieldId).join(', ')}. Fix the source file before uploading.`,
      );
    }
    for (const u of cls.unmatched) {
      const d = unmatched[u.csvHeader];
      if (!d || d.mode === 'pending') out.push(`Decide what to do with "${u.csvHeader}".`);
      if (d?.mode === 'map' && !d.fieldId) out.push(`Pick a schema field for "${u.csvHeader}".`);
    }
    // Targets are unique (no two mappings hit the same field).
    const mappedTargets = new Map<string, string>();
    for (const [h, d] of Object.entries(unmatched)) {
      if (d.mode === 'map' && d.fieldId) {
        const prior = mappedTargets.get(d.fieldId);
        if (prior) out.push(`"${prior}" and "${h}" both map to ${d.fieldId}. Pick one.`);
        mappedTargets.set(d.fieldId, h);
      }
    }
    // Each missing DATA column needs ack OR a mapping that supplies it.
    const supplied = new Set<string>(Array.from(mappedTargets.keys()));
    for (const m of cls.missing) {
      if (m.isKey) continue;
      if (supplied.has(m.fieldId)) continue;
      if (!ack[m.fieldId]) out.push(`Acknowledge that "${m.fieldId}" will be NULL on every row, or fix the source.`);
    }
    return out;
  }, [unmatched, ack, cls, missingKeyHardBlock]);

  const canContinue = !missingKeyHardBlock && issues.length === 0;

  // Helper for the schema dropdown — every schema field minus matched ones
  // minus key fields (keys can't be mapping targets — the source file must
  // literally have a header named DBN / school_year).
  const fieldOptions = useMemo<string[]>(() => {
    const matchedFields = new Set(cls.matched.map((m) => m.fieldId));
    return cls.missing.filter((m) => !m.isKey && !matchedFields.has(m.fieldId)).map((m) => m.fieldId);
  }, [cls.matched, cls.missing]);

  const submit = (): void => {
    const decisions: Decisions = {
      unmatched: Object.entries(unmatched).map(([csvHeader, d]) => {
        if (d.mode === 'map' && d.fieldId) {
          return { kind: 'map', csvHeader, fieldId: d.fieldId };
        }
        return { kind: 'ignore', csvHeader };
      }),
      acknowledgedMissing: ack,
      ignoredExtra: Object.entries(unmatched).filter(([, d]) => d.mode === 'ignore').map(([h]) => h),
    };
    void onSubmit(decisions);
  };

  return (
    <Modal
      title={`Reconcile columns — ${upload.filename}`}
      onClose={onCancel}
      width={760}
      footer={
        <>
          <button type="button" onClick={onCancel} style={ghostBtn}>Cancel</button>
          <button
            type="button"
            disabled={!canContinue}
            onClick={submit}
            style={{ ...primaryBtn, opacity: canContinue ? 1 : 0.5, cursor: canContinue ? 'pointer' : 'not-allowed' }}
          >
            Preview diff →
          </button>
        </>
      }
    >
      <SummaryGrid cls={cls} rowCount={upload.rowCount} />

      {missingKeyHardBlock ? (
        <Banner tone="error" title="Hard block">
          Required key column{cls.missing.filter((m) => m.isKey).length > 1 ? 's are' : ' is'} missing:{' '}
          <code>{cls.missing.filter((m) => m.isKey).map((m) => m.fieldId).join(', ')}</code>.
          The upload can't proceed. Add the column to your source file and re-upload.
        </Banner>
      ) : null}

      {cls.unmatched.length > 0 ? (
        <Section title="Unmatched columns (review each)">
          <div style={{ fontSize: 12, color: '#5a6e85', marginBottom: 8 }}>
            These headers don't match the schema. They were probably renamed. Map each one to a schema field, or mark Ignore.
            Suggestions are ranked by name similarity — confirm by selecting, never auto-applied.
          </div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f6f8fb', textAlign: 'left' }}>
                <th style={th}>CSV column</th>
                <th style={th}>Decision</th>
                <th style={th}>Top suggestions</th>
              </tr>
            </thead>
            <tbody>
              {cls.unmatched.map((u) => {
                const d = unmatched[u.csvHeader]!;
                return (
                  <tr key={u.csvHeader} style={{ borderTop: '1px solid #e1e8ef' }}>
                    <td style={td}><code>{u.csvHeader}</code></td>
                    <td style={td}>
                      <select
                        value={d.mode === 'map' ? `map:${d.fieldId ?? ''}` : d.mode === 'ignore' ? 'ignore' : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '') setUnmatched({ ...unmatched, [u.csvHeader]: { mode: 'pending' } });
                          else if (v === 'ignore') setUnmatched({ ...unmatched, [u.csvHeader]: { mode: 'ignore' } });
                          else setUnmatched({ ...unmatched, [u.csvHeader]: { mode: 'map', fieldId: v.slice(4) } });
                        }}
                        style={selectStyle}
                      >
                        <option value="" disabled>Pending…</option>
                        <option value="ignore">Ignore (drop column)</option>
                        <optgroup label="Map to schema field">
                          {fieldOptions.map((f) => (
                            <option key={f} value={`map:${f}`}>{f}</option>
                          ))}
                        </optgroup>
                      </select>
                    </td>
                    <td style={{ ...td, color: '#5a6e85' }}>
                      {u.suggestions.length === 0 ? '—' : u.suggestions.map((s) => (
                        <span key={s.fieldId} style={{ marginRight: 8 }}>
                          <code>{s.fieldId}</code>
                          <span style={{ color: '#9aa9ba' }}> ({Math.round(s.score * 100)}%)</span>
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      ) : null}

      {cls.missing.filter((m) => !m.isKey).length > 0 ? (
        <Section title="Missing data columns">
          <div style={{ fontSize: 12, color: '#5a6e85', marginBottom: 8 }}>
            These schema columns don't appear in your file. Acknowledge each one to import every row with that field set to NULL — or cancel, add the column to your source, and re-upload. (Renamed columns? Map them above instead — they won't appear here once mapped.)
          </div>
          {cls.missing.filter((m) => !m.isKey).map((m) => (
            <label key={m.fieldId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={ack[m.fieldId] ?? false}
                onChange={(e) => setAck({ ...ack, [m.fieldId]: e.target.checked })}
              />
              <span><code>{m.fieldId}</code> — set to NULL on every row.</span>
            </label>
          ))}
        </Section>
      ) : null}

      {cls.unmatched.length === 0 && cls.missing.length === 0 ? (
        <Banner tone="ok" title="Exact match">
          Every CSV column matches the schema. No decisions needed.
        </Banner>
      ) : null}

      {issues.length > 0 && !missingKeyHardBlock ? (
        <Banner tone="warn" title="Resolve before continuing">
          <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
            {issues.map((i, idx) => <li key={idx}>{i}</li>)}
          </ul>
        </Banner>
      ) : null}

      {error ? <Banner tone="error" title="Server validation failed">{error}</Banner> : null}
    </Modal>
  );
}

function SummaryGrid({ cls, rowCount }: { cls: Classification; rowCount: number }): React.JSX.Element {
  const items: Array<[string, number, string]> = [
    ['rows', rowCount, '#5a6e85'],
    ['matched', cls.matched.length, '#1f7a3a'],
    ['unmatched', cls.unmatched.length, '#a37800'],
    ['missing', cls.missing.length, cls.missing.some((m) => m.isKey) ? '#c0392b' : '#a37800'],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
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

function Banner({ tone, title, children }: { tone: 'error' | 'warn' | 'ok'; title: string; children: React.ReactNode }): React.JSX.Element {
  const palette = {
    error: { bg: '#fdecea', fg: '#c0392b' },
    warn: { bg: '#fff7e0', fg: '#a37800' },
    ok: { bg: '#e8f6ee', fg: '#1f7a3a' },
  }[tone];
  return (
    <div style={{ marginTop: 14, background: palette.bg, color: palette.fg, padding: 12, borderRadius: 6, fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };
const selectStyle: React.CSSProperties = { width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #c7d3e0', borderRadius: 4 };
const primaryBtn: React.CSSProperties = { background: '#027BC0', color: '#fff', border: 0, borderRadius: 4, padding: '8px 14px', fontSize: 13, fontWeight: 600 };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#5a6e85', border: '1px solid #c7d3e0', borderRadius: 4, padding: '8px 14px', fontSize: 13, cursor: 'pointer' };
