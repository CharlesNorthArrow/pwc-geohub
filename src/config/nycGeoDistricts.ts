/**
 * Typed loader for `nycGeoDistricts.json`. The Geo filter dialog uses these
 * allow-lists to hide non-NYC districts from the Congressional / NYS Senate /
 * NYS Assembly option lists. All other geo layers are unaffected.
 *
 * Source of truth = the JSON. Edit + redeploy to change the lists.
 */
// Authoritative file lives at the repo-root `config/` so non-developers can
// edit it without spelunking through `src/`. The loader here just shapes
// the JSON into `Set<number>` for O(1) lookups in the Geo filter dialog.
import raw from '../../config/nycGeoDistricts.json';

export type AllowListLayer = 'congressional' | 'senate' | 'assembly';

export interface NycGeoDistrictsConfig {
  congressional: ReadonlySet<number>;
  senate: ReadonlySet<number>;
  assembly: ReadonlySet<number>;
}

function toSet(arr: unknown): Set<number> {
  if (!Array.isArray(arr)) return new Set();
  const out = new Set<number>();
  for (const v of arr) {
    if (typeof v === 'number' && Number.isFinite(v)) out.add(v);
  }
  return out;
}

export const NYC_GEO_DISTRICTS: NycGeoDistrictsConfig = {
  congressional: toSet((raw as { congressional?: unknown }).congressional),
  senate: toSet((raw as { senate?: unknown }).senate),
  assembly: toSet((raw as { assembly?: unknown }).assembly),
};
