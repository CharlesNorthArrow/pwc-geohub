'use client';

import { useCallback, useEffect, useState } from 'react';
import ProviderBadge from './ProviderBadge';
import CommunitySyncDialog from './CommunitySyncDialog';
import CommunityVersionHistory from './CommunityVersionHistory';

interface Status {
  provider: 'acs' | 'cdc_places';
  loaded_vintage: string | null;
  cdc_loaded_updated_at: string | null;
  latest_vintage: string | null;
  cdc_latest_updated_at: string | null;
  last_checked_at: string | null;
  last_check_ok: boolean;
  last_check_error: string | null;
  update_available: boolean;
}

const CARDS: Array<{ provider: 'acs' | 'cdc_places'; title: string; description: string }> = [
  {
    provider: 'acs',
    title: 'Census ACS 5-yr',
    description: '6 community indicators (child poverty, single-parent households, unemployment, single-young-adults, foreign-born children, racial predominance) at NYC tract grain. Pulled with the server-side CENSUS_API_KEY.',
  },
  {
    provider: 'cdc_places',
    title: 'CDC PLACES',
    description: '2 indicators — adult mental health (MHLTH) and housing insecurity (HOUSING) — modeled at tract grain by CDC.',
  },
];

export default function CommunitySection(): React.JSX.Element {
  const [statuses, setStatuses] = useState<Status[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [syncing, setSyncing] = useState<null | 'acs' | 'cdc_places'>(null);
  const [versionsRefreshKey, setVersionsRefreshKey] = useState(0);

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch('/api/admin/community/status');
      if (!r.ok) return;
      const body = (await r.json()) as { status: Status[] };
      setStatuses(body.status);
    } catch {
      // soft fail
    }
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const checkNow = async (): Promise<void> => {
    setChecking(true);
    try {
      const r = await fetch('/api/admin/community/check', { method: 'POST' });
      if (r.ok) {
        const body = (await r.json()) as { status: Status[] };
        setStatuses(body.status);
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ color: '#5a6e85', fontSize: 13, margin: 0 }}>
          Federal data sources — synced on schedule. Monthly cron checks for new vintages; "Check now" runs the same probe on demand.
        </p>
        <button
          type="button"
          disabled={checking}
          onClick={checkNow}
          style={{
            background: '#fff',
            color: '#027BC0',
            border: '1px solid #c7d3e0',
            borderRadius: 4,
            padding: '6px 12px',
            fontSize: 12,
            cursor: checking ? 'progress' : 'pointer',
          }}
        >
          {checking ? 'Checking…' : 'Check now (all providers)'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        {CARDS.map((c) => {
          const status = statuses?.find((s) => s.provider === c.provider) ?? null;
          return (
            <CommunityCard
              key={c.provider}
              provider={c.provider}
              title={c.title}
              description={c.description}
              status={status}
              versionsRefreshKey={versionsRefreshKey}
              onSync={() => setSyncing(c.provider)}
            />
          );
        })}
      </div>

      {syncing ? (
        <CommunitySyncDialog
          provider={syncing}
          onClose={() => setSyncing(null)}
          onApplied={async () => {
            setSyncing(null);
            await refreshStatus();
            setVersionsRefreshKey((k) => k + 1);
          }}
        />
      ) : null}
    </>
  );
}

function CommunityCard({
  provider,
  title,
  description,
  status,
  versionsRefreshKey,
  onSync,
}: {
  provider: 'acs' | 'cdc_places';
  title: string;
  description: string;
  status: Status | null;
  versionsRefreshKey: number;
  onSync: () => void;
}): React.JSX.Element {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 11, color: '#5a6e85', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Community sync
        </div>
        <span style={{ fontSize: 10, color: '#9aa9ba' }}>
          {status?.loaded_vintage ? `Loaded: ${status.loaded_vintage}` : 'Not yet loaded'}
        </span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
      <p style={{ fontSize: 12, color: '#5a6e85', margin: 0, lineHeight: 1.4 }}>{description}</p>
      <div>{status ? <ProviderBadge status={status} /> : <SkeletonPill />}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button
          type="button"
          onClick={onSync}
          style={{
            background: '#027BC0',
            color: '#fff',
            border: 0,
            borderRadius: 4,
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Sync…
        </button>
      </div>
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 11, color: '#5a6e85' }}>Version history</summary>
        <div style={{ marginTop: 8 }}>
          <CommunityVersionHistory provider={provider} refreshKey={versionsRefreshKey} />
        </div>
      </details>
    </div>
  );
}

function SkeletonPill(): React.JSX.Element {
  return (
    <span style={{ display: 'inline-block', width: 120, height: 18, background: '#eef2f7', borderRadius: 999 }} />
  );
}
