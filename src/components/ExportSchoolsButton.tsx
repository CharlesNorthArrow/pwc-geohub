'use client';

import { useState } from 'react';
import { useHubStore } from '../store/useHubStore';

/**
 * "Download data" — CSV of every school in the current filtered universe:
 * identity, demographics, PWC program data, geo assignments, all school
 * indicators and all community indicators (averaged over the school's
 * District / NTA per the aggregation toggle). Years follow the dashboard:
 * Latest mode → each indicator's own latest year, else the slider year.
 */
export default function ExportSchoolsButton({ dbns }: { dbns: readonly string[] }): React.JSX.Element {
  const aggregationArea = useHubStore((s) => s.aggregationArea);
  const latestPerLayer = useHubStore((s) => s.latestPerLayer);
  const year = useHubStore((s) => s.year);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/export/schools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dbns, aggregationArea, year: latestPerLayer ? null : year, pwcYear: year }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'pwc-geohub-schools.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Download failed (${(err as Error).message})`);
    } finally {
      setBusy(false);
    }
  };

  const area = aggregationArea === 'nta_2020' ? 'NTA' : 'school district';
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy || dbns.length === 0}
        title={`CSV of the ${dbns.length.toLocaleString()} schools in the current filters — all school and community values (community = ${area} average), PWC programs and geographies. ${latestPerLayer ? 'Each indicator at its latest year.' : `Year ${year}.`}`}
        style={{
          background: 'white',
          border: '1px solid #c5d3df',
          borderRadius: 4,
          padding: '3px 8px',
          fontSize: 11,
          color: '#027BC0',
          fontWeight: 600,
          cursor: busy || dbns.length === 0 ? 'default' : 'pointer',
          opacity: dbns.length === 0 ? 0.5 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {busy ? 'Preparing…' : `⬇ Download data (${dbns.length.toLocaleString()})`}
      </button>
      {error ? <span style={{ fontSize: 10, color: '#a82255', marginTop: 2 }}>{error}</span> : null}
    </span>
  );
}
