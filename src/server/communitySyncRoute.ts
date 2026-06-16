/**
 * Shared logic for the per-provider sync routes — the preview + apply path.
 *
 * Both endpoints run the same pipeline:
 *   1. Probe the source to determine the latest vintage + (CDC) updatedAt.
 *   2. Compare with the loaded state. If already at latest → "no-op".
 *   3. Fetch the new vintage's normalized rows (forceFresh).
 *   4. Read the current version's row set; mergeCommunity.
 *   5. preview: return the diff.
 *      apply:   write a new version + atomic swap + clear flag.
 */

import { probeAcs, probeCdcPlaces } from '../admin/communityProbe';
import { fetchAcsVintage, fetchCdcVintage, indicatorsForProvider, type Provider } from '../admin/communitySync';
import { mergeCommunity, type IncomingRow } from '../admin/communityMerge';
import {
  applyCommunityVersion,
  getCurrentVersionId,
  getStatus,
  getVersionRows,
} from './communityAdminDb';

export interface SyncPreview {
  provider: Provider;
  alreadyLatest: boolean;
  targetVintage: string;
  cdcRowsUpdatedAt: string | null;
  loadedVintage: string | null;
  loadedCdcUpdatedAt: string | null;
  diff: {
    added: number;
    updated: number;
    unchanged: number;
    retained: number;
    newRowCount: number;
    byIndicator: Record<string, { added: number; updated: number; unchanged: number; retained: number }>;
  };
  updatedSample: Array<{ key: string; changed: string[]; before: unknown; after: unknown }>;
}

export async function computePreview(provider: Provider): Promise<SyncPreview> {
  const probe = provider === 'acs' ? await probeAcs() : await probeCdcPlaces();
  const status = await getStatus(provider);
  const loadedVintage = status.loaded_vintage;
  const loadedCdcUpd = status.cdc_loaded_updated_at;

  const cdcUpd = provider === 'cdc_places' ? (probe as { rowsUpdatedAt: string }).rowsUpdatedAt : null;
  const newer =
    loadedVintage == null ||
    compareVintage(probe.latestVintage, loadedVintage) > 0 ||
    (provider === 'cdc_places' && loadedCdcUpd !== cdcUpd);

  if (!newer) {
    return emptyPreview({
      provider,
      targetVintage: probe.latestVintage,
      cdcRowsUpdatedAt: cdcUpd,
      loadedVintage,
      loadedCdcUpdatedAt: loadedCdcUpd,
    });
  }

  // Fetch the new vintage's rows. For ACS: that's only the target vintage.
  // For CDC: we re-fetch the whole feed (Socrata has no per-year filter
  // that's both efficient and complete) and update on every (area, ind, year).
  const indicators = indicatorsForProvider(provider);
  const fetched =
    provider === 'acs'
      ? await fetchAcsVintage(probe.latestVintage, indicators, /*forceFresh*/ true)
      : await (async (): Promise<IncomingRow[]> => {
          // CDC: pull the whole feed and use ALL vintages — this is the
          // "feed is canonical" semantics; the merge layer keeps anything
          // CDC no longer reports.
          const { fetchCdcAllVintages } = await import('../admin/communitySync');
          const byYear = await fetchCdcAllVintages(indicators, /*forceFresh*/ true);
          const all: IncomingRow[] = [];
          for (const rows of byYear.values()) {
            for (const r of rows) {
              all.push({ ...r });
            }
          }
          return all;
        })();

  const currentVersionId = await getCurrentVersionId(provider);
  const currentRows = currentVersionId == null ? [] : await getVersionRows(currentVersionId);
  const merge = mergeCommunity(currentRows, fetched);

  // Per-indicator breakdown for the preview UI.
  const byIndicator: Record<string, { added: number; updated: number; unchanged: number; retained: number }> = {};
  const ensure = (id: string): { added: number; updated: number; unchanged: number; retained: number } => {
    if (!byIndicator[id]) byIndicator[id] = { added: 0, updated: 0, unchanged: 0, retained: 0 };
    return byIndicator[id]!;
  };
  // For added/updated/retained we walk newVersionRows + diff; ETL-style
  // counters via the merge's primitives are O(n) but we already have them
  // by overall total; per-indicator we tally from incoming + current sets.
  const currentKeys = new Set(currentRows.map((r) => `${r.area_id}|${r.geo_layer}|${r.indicator_id}|${r.year}`));
  const incomingKeys = new Set(fetched.map((r) => `${r.area_id}|${r.geo_layer}|${r.indicator_id}|${r.year}`));
  const updatedKeys = new Set(merge.updated.map((u) => u.key));
  for (const r of fetched) {
    const cell = ensure(r.indicator_id);
    const k = `${r.area_id}|${r.geo_layer}|${r.indicator_id}|${r.year}`;
    if (!currentKeys.has(k)) cell.added++;
    else if (updatedKeys.has(k)) cell.updated++;
    else cell.unchanged++;
  }
  for (const r of currentRows) {
    if (!incomingKeys.has(`${r.area_id}|${r.geo_layer}|${r.indicator_id}|${r.year}`)) {
      ensure(r.indicator_id).retained++;
    }
  }

  // Build the vintages index for the new version row.
  const vintages: Record<string, Set<string>> = {};
  let maxVintage = '';
  for (const r of merge.newVersionRows) {
    if (!vintages[r.indicator_id]) vintages[r.indicator_id] = new Set();
    vintages[r.indicator_id]!.add(r.year);
    if (compareVintage(r.year, maxVintage) > 0) maxVintage = r.year;
  }
  const vintagesIndex: Record<string, string[]> = {};
  for (const k of Object.keys(vintages)) vintagesIndex[k] = [...vintages[k]!].sort();

  return {
    provider,
    alreadyLatest: false,
    targetVintage: probe.latestVintage,
    cdcRowsUpdatedAt: cdcUpd,
    loadedVintage,
    loadedCdcUpdatedAt: loadedCdcUpd,
    diff: {
      added: merge.added,
      updated: merge.updated.length,
      unchanged: merge.unchanged,
      retained: merge.retained,
      newRowCount: merge.newVersionRows.length,
      byIndicator,
    },
    updatedSample: merge.updated.slice(0, 25).map((u) => ({
      key: u.key,
      changed: u.changedFields,
      before: pick(u.before as unknown as Record<string, unknown>, u.changedFields),
      after: pick(u.after as unknown as Record<string, unknown>, u.changedFields),
    })),
  };
}

/**
 * Apply path: re-runs `computePreview` so server is the trust boundary —
 * the client never sends row data, just the provider + a notes string.
 * Returns the new version id.
 */
export async function applyProvider(provider: Provider, notes: string | null): Promise<{ versionId: number | null; alreadyLatest: boolean }> {
  const probe = provider === 'acs' ? await probeAcs() : await probeCdcPlaces();
  const status = await getStatus(provider);
  const loadedVintage = status.loaded_vintage;
  const loadedCdcUpd = status.cdc_loaded_updated_at;
  const cdcUpd = provider === 'cdc_places' ? (probe as { rowsUpdatedAt: string }).rowsUpdatedAt : null;
  const newer =
    loadedVintage == null ||
    compareVintage(probe.latestVintage, loadedVintage) > 0 ||
    (provider === 'cdc_places' && loadedCdcUpd !== cdcUpd);
  if (!newer) return { versionId: null, alreadyLatest: true };

  const indicators = indicatorsForProvider(provider);
  const fetched =
    provider === 'acs'
      ? await fetchAcsVintage(probe.latestVintage, indicators, true)
      : await (async (): Promise<IncomingRow[]> => {
          const { fetchCdcAllVintages } = await import('../admin/communitySync');
          const byYear = await fetchCdcAllVintages(indicators, true);
          const all: IncomingRow[] = [];
          for (const rows of byYear.values()) for (const r of rows) all.push({ ...r });
          return all;
        })();
  const currentVersionId = await getCurrentVersionId(provider);
  const currentRows = currentVersionId == null ? [] : await getVersionRows(currentVersionId);
  const merge = mergeCommunity(currentRows, fetched);

  const vintages: Record<string, Set<string>> = {};
  let maxVintage = '';
  for (const r of merge.newVersionRows) {
    if (!vintages[r.indicator_id]) vintages[r.indicator_id] = new Set();
    vintages[r.indicator_id]!.add(r.year);
    if (compareVintage(r.year, maxVintage) > 0) maxVintage = r.year;
  }
  const vintagesIndex: Record<string, string[]> = {};
  for (const k of Object.keys(vintages)) vintagesIndex[k] = [...vintages[k]!].sort();

  const result = await applyCommunityVersion({
    provider,
    source: `sync:${provider}:${probe.latestVintage}`,
    notes,
    rows: merge.newVersionRows,
    vintages: vintagesIndex,
    newLoadedVintage: maxVintage || probe.latestVintage,
    newCdcLoadedUpdatedAt: cdcUpd,
  });
  return { versionId: result.versionId, alreadyLatest: false };
}

function emptyPreview(args: {
  provider: Provider;
  targetVintage: string;
  cdcRowsUpdatedAt: string | null;
  loadedVintage: string | null;
  loadedCdcUpdatedAt: string | null;
}): SyncPreview {
  return {
    provider: args.provider,
    alreadyLatest: true,
    targetVintage: args.targetVintage,
    cdcRowsUpdatedAt: args.cdcRowsUpdatedAt,
    loadedVintage: args.loadedVintage,
    loadedCdcUpdatedAt: args.loadedCdcUpdatedAt,
    diff: { added: 0, updated: 0, unchanged: 0, retained: 0, newRowCount: 0, byIndicator: {} },
    updatedSample: [],
  };
}

function pick<T extends Record<string, unknown>>(o: T, keys: string[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) (out as Record<string, unknown>)[k] = o[k];
  return out;
}

function compareVintage(a: string, b: string): number {
  const an = Number(a);
  const bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return a.localeCompare(b);
}
