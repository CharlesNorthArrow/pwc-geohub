'use client';

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

/**
 * Four states, computed purely from the status row:
 *   - last_check_ok=false                  → "Couldn't check"   (orange)
 *   - last_checked_at is null              → "Not yet checked"  (grey)
 *   - update_available=true                → "Update available" (highlighted)
 *   - else                                 → "Up to date"       (quiet)
 *
 * `last_check_ok=false` takes precedence over `update_available` so a
 * transient blip cannot present as either "up to date" OR "update available"
 * — the fail-safe invariant for the badge.
 */
export default function ProviderBadge({ status }: { status: Status }): React.JSX.Element {
  const checkedAt = status.last_checked_at ? fmtDate(status.last_checked_at) : null;
  if (!checkedAt) {
    return (
      <Pill tone="muted" title="Run 'Check now' to probe the source for newer data.">
        Not yet checked
      </Pill>
    );
  }
  if (!status.last_check_ok) {
    return (
      <Pill tone="warn" title={status.last_check_error ?? undefined}>
        Couldn't check · last attempt {checkedAt}
      </Pill>
    );
  }
  if (status.update_available) {
    const head = status.provider === 'acs'
      ? `Update available — ACS ${status.latest_vintage ?? '?'} 5-yr (you have ${status.loaded_vintage ?? '—'})`
      : describeCdcUpdate(status);
    return (
      <Pill tone="alert" title={`Checked ${checkedAt}`}>
        {head} · checked {checkedAt}
      </Pill>
    );
  }
  return (
    <Pill tone="ok">
      Up to date · checked {checkedAt}
    </Pill>
  );
}

function describeCdcUpdate(s: Status): string {
  // CDC re-issue with same year: "CDC re-issued the dataset (last sync: <date>)"
  if (s.latest_vintage === s.loaded_vintage) {
    return `Update available — CDC re-issued the dataset (loaded ${shortUpd(s.cdc_loaded_updated_at)})`;
  }
  return `Update available — CDC ${s.latest_vintage ?? '?'} (you have ${s.loaded_vintage ?? '—'})`;
}

function shortUpd(iso: string | null): string {
  if (!iso) return '—';
  // Socrata rowsUpdatedAt is sometimes a Unix epoch string. Normalize.
  const n = Number(iso);
  if (Number.isFinite(n) && n > 1e9) return fmtDate(new Date(n * 1000).toISOString());
  return fmtDate(iso);
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function Pill({
  children,
  tone,
  title,
}: {
  children: React.ReactNode;
  tone: 'ok' | 'warn' | 'alert' | 'muted';
  title?: string;
}): React.JSX.Element {
  const palette: Record<string, { bg: string; fg: string; border: string }> = {
    ok: { bg: '#eef2f7', fg: '#5a6e85', border: 'transparent' },
    warn: { bg: '#fff7e0', fg: '#a37800', border: '#f2dc8f' },
    alert: { bg: '#eaf3fb', fg: '#027BC0', border: '#9ed0ee' },
    muted: { bg: '#f6f8fb', fg: '#9aa9ba', border: 'transparent' },
  };
  const p = palette[tone]!;
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 10px',
        background: p.bg,
        color: p.fg,
        border: `1px solid ${p.border}`,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: tone === 'alert' ? 700 : 500,
        textTransform: tone === 'alert' ? undefined : 'uppercase',
        letterSpacing: tone === 'alert' ? undefined : '0.06em',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
