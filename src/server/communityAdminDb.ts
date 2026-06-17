/**
 * Postgres helpers for the community admin surfaces. Mirrors src/server/adminDb.ts.
 *
 * Two write paths:
 *   - applyCommunityVersion: single tx that inserts version + rows, replaces
 *     the live community_indicator_values slice for the provider, updates
 *     the current pointer, and updates the status row.
 *   - recordCheck (success): writes latest_vintage + last_checked_at and
 *     RECOMPUTES update_available against loaded_vintage. Does NOT touch
 *     loaded_vintage or cdc_loaded_updated_at.
 *   - recordCheckFailure: writes ONLY last_checked_at + last_check_ok=false
 *     + last_check_error. Touches nothing else. FAIL-SAFE.
 */

import { pool } from './db';
import { indicatorsForProvider, type Provider } from '../admin/communitySync';
import type { Payload, CurrentRow } from '../admin/communityMerge';

export interface CommunityVersionRow {
  version_id: number;
  provider: Provider;
  created_at: string;
  created_by: string;
  source: string;
  notes: string | null;
  row_count: number;
  vintages: Record<string, string[]>;
  is_current: boolean;
}

export interface CommunityStatusRow {
  provider: Provider;
  loaded_vintage: string | null;
  cdc_loaded_updated_at: string | null;
  latest_vintage: string | null;
  cdc_latest_updated_at: string | null;
  last_checked_at: string | null;
  last_check_ok: boolean;
  last_check_error: string | null;
  update_available: boolean;
}

/** Always returns a row per provider (synthesizes a "never checked" record
 *  when the table is empty for that provider). */
export async function getStatus(provider: Provider): Promise<CommunityStatusRow> {
  const r = await pool().query(
    `SELECT provider, loaded_vintage, cdc_loaded_updated_at, latest_vintage,
            cdc_latest_updated_at, last_checked_at, last_check_ok,
            last_check_error, update_available
       FROM community_provider_status
      WHERE provider = $1`,
    [provider],
  );
  if (r.rows.length === 0) {
    return {
      provider,
      loaded_vintage: null,
      cdc_loaded_updated_at: null,
      latest_vintage: null,
      cdc_latest_updated_at: null,
      last_checked_at: null,
      last_check_ok: false,
      last_check_error: null,
      update_available: false,
    };
  }
  return r.rows[0] as CommunityStatusRow;
}

export async function getAllStatus(): Promise<CommunityStatusRow[]> {
  return Promise.all([getStatus('acs'), getStatus('cdc_places')]);
}

export async function getCurrentVersionId(provider: Provider): Promise<number | null> {
  const r = await pool().query(
    `SELECT version_id FROM community_provider_current WHERE provider = $1`,
    [provider],
  );
  return r.rows[0]?.version_id ?? null;
}

export async function getVersionRows(versionId: number): Promise<CurrentRow[]> {
  const r = await pool().query(
    `SELECT area_id, geo_layer, indicator_id, year, payload
       FROM community_provider_version_rows
      WHERE version_id = $1`,
    [versionId],
  );
  return r.rows.map((row) => ({
    area_id: row.area_id,
    geo_layer: row.geo_layer,
    indicator_id: row.indicator_id,
    year: row.year,
    payload: row.payload as Payload,
  }));
}

export async function listVersions(provider: Provider): Promise<CommunityVersionRow[]> {
  const currentId = await getCurrentVersionId(provider);
  const r = await pool().query(
    `SELECT version_id, provider, created_at, created_by, source, notes, row_count, vintages
       FROM community_provider_versions
      WHERE provider = $1
   ORDER BY version_id DESC`,
    [provider],
  );
  return r.rows.map((row) => ({
    version_id: row.version_id,
    provider: row.provider,
    created_at: row.created_at,
    created_by: row.created_by,
    source: row.source,
    notes: row.notes,
    row_count: row.row_count,
    vintages: row.vintages,
    is_current: row.version_id === currentId,
  }));
}

/**
 * Record a SUCCESSFUL availability check. We always set last_check_ok=true,
 * last_check_error=null, and the freshly-found upstream values. The
 * `update_available` flag is recomputed against `loaded_vintage` (which we
 * do NOT touch here — only sync updates loaded_vintage).
 */
export async function recordCheckSuccess(args: {
  provider: Provider;
  latestVintage: string;
  cdcLatestUpdatedAt: string | null;
}): Promise<void> {
  const p = pool();
  // Read the current loaded state so we can re-compute update_available
  // against today's probe.
  const cur = await p.query(
    `SELECT loaded_vintage, cdc_loaded_updated_at FROM community_provider_status WHERE provider = $1`,
    [args.provider],
  );
  const loadedVintage = (cur.rows[0]?.loaded_vintage as string | null) ?? null;
  const loadedUpd = (cur.rows[0]?.cdc_loaded_updated_at as string | null) ?? null;
  const newer = isNewerThanLoaded(
    { vintage: loadedVintage, cdcUpdatedAt: loadedUpd },
    { provider: args.provider, latestVintage: args.latestVintage, cdcUpdatedAt: args.cdcLatestUpdatedAt },
  );

  await p.query(
    `INSERT INTO community_provider_status
       (provider, latest_vintage, cdc_latest_updated_at, last_checked_at,
        last_check_ok, last_check_error, update_available)
     VALUES ($1, $2, $3, now(), TRUE, NULL, $4)
     ON CONFLICT (provider) DO UPDATE SET
       latest_vintage = EXCLUDED.latest_vintage,
       cdc_latest_updated_at = EXCLUDED.cdc_latest_updated_at,
       last_checked_at = EXCLUDED.last_checked_at,
       last_check_ok = EXCLUDED.last_check_ok,
       last_check_error = EXCLUDED.last_check_error,
       update_available = EXCLUDED.update_available`,
    [args.provider, args.latestVintage, args.cdcLatestUpdatedAt, newer],
  );
}

/**
 * FAIL-SAFE: a failed availability check only writes the failure markers.
 * `loaded_vintage`, `latest_vintage`, `update_available`, and the CDC fields
 * are explicitly NOT touched here. A transient blip can never flip a true
 * "update available" into a false "up to date" — and never the other way.
 */
export async function recordCheckFailure(args: {
  provider: Provider;
  error: string;
}): Promise<void> {
  const short = args.error.length > 500 ? args.error.slice(0, 497) + '...' : args.error;
  await pool().query(
    `INSERT INTO community_provider_status
       (provider, last_checked_at, last_check_ok, last_check_error)
     VALUES ($1, now(), FALSE, $2)
     ON CONFLICT (provider) DO UPDATE SET
       last_checked_at = EXCLUDED.last_checked_at,
       last_check_ok = EXCLUDED.last_check_ok,
       last_check_error = EXCLUDED.last_check_error`,
    [args.provider, short],
  );
}

/** Pure newer-than test. Mirrors communityProbe.isNewer; duplicated here
 *  because this layer doesn't import from the probe module to avoid pulling
 *  fetch logic into routes that just read status. */
function isNewerThanLoaded(
  loaded: { vintage: string | null; cdcUpdatedAt: string | null },
  probe: { provider: Provider; latestVintage: string; cdcUpdatedAt: string | null },
): boolean {
  if (loaded.vintage == null) return true;
  if (compareVintage(probe.latestVintage, loaded.vintage) > 0) return true;
  // Only flip "newer" on a CDC re-issue when we have a baseline to compare
  // against. NULL loaded.cdcUpdatedAt means "never recorded" (e.g. seed) —
  // treat as unknown, NOT as automatically stale.
  if (
    probe.provider === 'cdc_places' &&
    loaded.cdcUpdatedAt != null &&
    loaded.cdcUpdatedAt !== probe.cdcUpdatedAt
  ) return true;
  return false;
}

function compareVintage(a: string, b: string): number {
  const an = Number(a);
  const bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return a.localeCompare(b);
}

/**
 * Apply a sync — single Postgres tx.
 *
 * Order:
 *   1. INSERT version row → version_id.
 *   2. Bulk INSERT version_rows (the merged set).
 *   3. DELETE community_indicator_values WHERE indicator_id IN <provider's>.
 *   4. INSERT community_indicator_values from the new version's rows.
 *   5. UPSERT community_provider_current.
 *   6. UPSERT community_provider_status:
 *        loaded_vintage = max vintage in new version
 *        cdc_loaded_updated_at = (CDC only) provided rowsUpdatedAt
 *        update_available = FALSE   ← sync clears the flag
 */
export async function applyCommunityVersion(args: {
  provider: Provider;
  source: string;
  notes: string | null;
  rows: CurrentRow[];
  vintages: Record<string, string[]>;
  newLoadedVintage: string;
  newCdcLoadedUpdatedAt: string | null;
}): Promise<{ versionId: number }> {
  const p = pool();
  const indicatorIds = indicatorsForProvider(args.provider).map((i) => i.id);
  await p.query('BEGIN');
  try {
    const verRes = await p.query(
      `INSERT INTO community_provider_versions (provider, created_by, source, notes, row_count, vintages)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING version_id`,
      [args.provider, 'admin', args.source, args.notes, args.rows.length, JSON.stringify(args.vintages)],
    );
    const versionId = (verRes.rows[0] as { version_id: number }).version_id;

    const CHUNK = 500;
    for (let i = 0; i < args.rows.length; i += CHUNK) {
      const chunk = args.rows.slice(i, i + CHUNK);
      const tuples: string[] = [];
      const params: unknown[] = [];
      let n = 1;
      for (const r of chunk) {
        tuples.push(`($${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}::jsonb)`);
        params.push(versionId, r.area_id, r.geo_layer, r.indicator_id, r.year, JSON.stringify(r.payload));
      }
      await p.query(
        `INSERT INTO community_provider_version_rows (version_id, area_id, geo_layer, indicator_id, year, payload)
         VALUES ${tuples.join(', ')}`,
        params,
      );
    }

    // Replace the provider's slice of community_indicator_values.
    await p.query(
      `DELETE FROM community_indicator_values WHERE indicator_id = ANY($1::text[])`,
      [indicatorIds],
    );
    for (let i = 0; i < args.rows.length; i += CHUNK) {
      const chunk = args.rows.slice(i, i + CHUNK);
      const tuples: string[] = [];
      const params: unknown[] = [];
      let n = 1;
      for (const r of chunk) {
        tuples.push(
          `($${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++})`,
        );
        params.push(
          r.area_id, r.geo_layer, r.year, r.indicator_id,
          r.payload.value_num, r.payload.value_text, r.payload.label, r.payload.source_year,
        );
      }
      await p.query(
        `INSERT INTO community_indicator_values
          (area_id, geo_layer, year, indicator_id, value_num, value_text, label, source_year)
         VALUES ${tuples.join(', ')}`,
        params,
      );
    }

    await p.query(
      `INSERT INTO community_provider_current (provider, version_id, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (provider) DO UPDATE SET version_id = EXCLUDED.version_id, updated_at = EXCLUDED.updated_at`,
      [args.provider, versionId],
    );

    await p.query(
      `INSERT INTO community_provider_status
        (provider, loaded_vintage, cdc_loaded_updated_at, last_check_ok, update_available)
       VALUES ($1, $2, $3, COALESCE((SELECT last_check_ok FROM community_provider_status WHERE provider = $1), FALSE), FALSE)
       ON CONFLICT (provider) DO UPDATE SET
         loaded_vintage = EXCLUDED.loaded_vintage,
         cdc_loaded_updated_at = EXCLUDED.cdc_loaded_updated_at,
         update_available = FALSE`,
      [args.provider, args.newLoadedVintage, args.newCdcLoadedUpdatedAt],
    );

    await p.query('COMMIT');
    return { versionId };
  } catch (err) {
    await p.query('ROLLBACK');
    throw err;
  }
}
