'use client';

import { useEffect, useState } from 'react';
import Modal from './Modal';

interface SchemaField {
  id: string;
  type: string;
  isKey: boolean;
  description: string;
  aliases: string[];
}

interface SchemaResponse {
  fields: SchemaField[];
  keyFields: string[];
  currentVersion: number | null;
  rowCount: number;
  updatedAt: string | null;
}

export default function ViewSchemaDialog({
  onClose,
  basePath = '/api/admin/pwc',
  datasetLabel = 'pwc_schools',
}: {
  onClose: () => void;
  basePath?: string;
  datasetLabel?: string;
}): React.JSX.Element {
  const [data, setData] = useState<SchemaResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${basePath}/schema`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setData((await r.json()) as SchemaResponse);
      })
      .catch((e) => setErr((e as Error).message));
  }, [basePath]);

  return (
    <Modal title={`${datasetLabel} schema`} onClose={onClose} width={720}>
      {err ? (
        <div style={{ color: '#c0392b' }}>Failed to load: {err}</div>
      ) : !data ? (
        <div>Loading…</div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: '#5a6e85', marginBottom: 16 }}>
            Active version: {data.currentVersion == null ? '—' : `v${data.currentVersion}`} ·{' '}
            {data.rowCount} rows · keyed by ({data.keyFields.join(', ')})
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f6f8fb', textAlign: 'left' }}>
                <th style={th}>Column</th>
                <th style={th}>Type</th>
                <th style={th}>Description</th>
              </tr>
            </thead>
            <tbody>
              {data.fields.map((f) => (
                <tr key={f.id} style={{ borderTop: '1px solid #e1e8ef' }}>
                  <td style={td}>
                    <code style={{ fontWeight: f.isKey ? 700 : 400 }}>{f.id}</code>
                    {f.isKey ? <KeyBadge /> : null}
                    {f.aliases.length > 0 ? (
                      <div style={{ fontSize: 10, color: '#9aa9ba', marginTop: 2 }}>
                        aliases: {f.aliases.join(', ')}
                      </div>
                    ) : null}
                  </td>
                  <td style={td}>{f.type}</td>
                  <td style={{ ...td, color: '#5a6e85' }}>{f.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}

function KeyBadge(): React.JSX.Element {
  return (
    <span style={{ marginLeft: 6, fontSize: 9, background: '#027BC0', color: '#fff', padding: '2px 5px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      Key
    </span>
  );
}

const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '10px', verticalAlign: 'top' };
