/**
 * Community provider probes — "what's the latest vintage upstream?"
 *
 * Used by:
 *   - the monthly cron (writes ONLY the status row)
 *   - the admin "Check now" button (same)
 *   - the sync preview path (re-runs the probe so we never sync stale info)
 *
 * Hard constraints:
 *   - NEVER fetches indicator data. These functions probe metadata only.
 *   - All network errors propagate as thrown exceptions. Callers MUST treat
 *     a throw as "couldn't check" and leave existing status flags alone
 *     (fail-safe — see communityAdminDb.recordCheckFailure).
 *   - No CENSUS_API_KEY is used here — the probe is keyless so it never
 *     gates on a missing env var.
 */

export type Provider = 'acs' | 'cdc_places';

export interface AcsProbe {
  provider: 'acs';
  latestVintage: string;          // "2024" — the highest ACS 5-yr year currently published
  probedYears: string[];          // ["2026","2025","2024"] — diagnostic trail
}

export interface CdcProbe {
  provider: 'cdc_places';
  latestVintage: string;          // max(year) in the dataset, as a string
  rowsUpdatedAt: string;          // Socrata `rowsUpdatedAt` (ISO; stringified epoch ok)
}

const ACS_PROBE_LOOKBACK = 5;     // how many calendar years back we'll walk before giving up
const ACS_PROBE_TIMEOUT_MS = 8_000;
const CDC_METADATA_URL = 'https://data.cdc.gov/api/views/cwsq-ngmh.json';
const CDC_RESOURCE_URL = 'https://data.cdc.gov/resource/cwsq-ngmh.json';

/**
 * Walk back from "this calendar year" probing the ACS 5-yr endpoint. The
 * highest year that returns a valid 200 JSON body is the latest vintage.
 *
 * We probe `acs/acs5/variables?get=NAME&for=us:1` — a one-row response that
 * costs Census almost nothing AND requires no API key.
 */
export async function probeAcs(now: Date = new Date()): Promise<AcsProbe> {
  const start = now.getUTCFullYear();
  const probed: string[] = [];
  let lastError: string | null = null;
  for (let i = 0; i < ACS_PROBE_LOOKBACK; i++) {
    const year = String(start - i);
    probed.push(year);
    try {
      const ok = await probeAcsYear(year);
      if (ok) {
        return { provider: 'acs', latestVintage: year, probedYears: probed };
      }
    } catch (err) {
      lastError = (err as Error).message;
      // network blip on this year — try the next one
    }
  }
  throw new Error(`No ACS 5-yr vintage answered within the last ${ACS_PROBE_LOOKBACK} years (probed ${probed.join(', ')})${lastError ? `: ${lastError}` : ''}`);
}

async function probeAcsYear(year: string): Promise<boolean> {
  const url = new URL(`https://api.census.gov/data/${year}/acs/acs5`);
  url.searchParams.set('get', 'NAME');
  url.searchParams.set('for', 'us:1');
  // Census now gates effectively every request behind an API key — keyless
  // requests return 200 OK with an HTML "Missing Key" page, which is
  // indistinguishable from "year doesn't exist" if we only look at status.
  // Use the existing server-side key (same one ETL uses) so the probe is
  // a single round-trip and produces a reliable JSON answer.
  const key = process.env.CENSUS_API_KEY;
  if (key) url.searchParams.set('key', key);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ACS_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: ctrl.signal });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`ACS probe ${year}: HTTP ${res.status}`);
    const body = await res.text();
    // Census happy responses are matrix-JSON: [["NAME","us"],["United States","1"]].
    if (body.startsWith('[')) return true;
    // Missing/invalid key path returns a 200 HTML page — surface as a probe
    // error (NOT "year doesn't exist") so the badge says "Couldn't check"
    // instead of silently walking past every vintage.
    if (body.includes('Missing Key') || body.includes('valid key') || body.includes('<html')) {
      throw new Error(`ACS probe ${year}: Census rejected request (missing/invalid CENSUS_API_KEY)`);
    }
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * CDC PLACES probe. Returns:
 *   - latestVintage = max(year) in the tract dataset
 *   - rowsUpdatedAt = the dataset's Socrata `rowsUpdatedAt` (kept stringified
 *     so we can do byte-equality compare without parsing)
 */
export async function probeCdcPlaces(): Promise<CdcProbe> {
  const [metadata, maxYear] = await Promise.all([
    fetchCdcMetadata(),
    fetchCdcMaxYear(),
  ]);
  return {
    provider: 'cdc_places',
    latestVintage: maxYear,
    rowsUpdatedAt: metadata.rowsUpdatedAt,
  };
}

async function fetchCdcMetadata(): Promise<{ rowsUpdatedAt: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ACS_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(CDC_METADATA_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`CDC metadata: HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    const raw = body.rowsUpdatedAt;
    if (raw == null) throw new Error('CDC metadata: missing rowsUpdatedAt');
    return { rowsUpdatedAt: String(raw) };
  } finally {
    clearTimeout(t);
  }
}

async function fetchCdcMaxYear(): Promise<string> {
  const url = `${CDC_RESOURCE_URL}?$select=year&$group=year&$order=year+DESC&$limit=1`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ACS_PROBE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    const token = process.env.CDC_APP_TOKEN;
    if (token) headers['X-App-Token'] = token;
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`CDC max(year): HTTP ${res.status}`);
    const rows = (await res.json()) as Array<{ year?: string }>;
    if (!Array.isArray(rows) || rows.length === 0 || !rows[0]!.year) {
      throw new Error('CDC max(year): empty response');
    }
    return String(rows[0]!.year);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Decide whether the upstream probe represents new data given what's loaded.
 * Pure — used by both the cron and the sync preview to phrase "already on
 * latest" vs "newer available" consistently.
 *
 * Returns:
 *   { newer: true }   if loaded < latest by vintage OR (CDC) the updatedAt
 *                     bytes changed.
 *   { newer: false }  otherwise (incl. when loaded > latest, which can happen
 *                     if a vintage was retracted — we never auto-roll back).
 */
export function isNewer(
  loaded: { vintage: string | null; cdcUpdatedAt: string | null },
  probe: AcsProbe | CdcProbe,
): { newer: boolean; reason: 'never_loaded' | 'newer_vintage' | 'cdc_reissue' | 'already_latest' } {
  if (loaded.vintage == null) return { newer: true, reason: 'never_loaded' };
  if (compareVintage(probe.latestVintage, loaded.vintage) > 0) {
    return { newer: true, reason: 'newer_vintage' };
  }
  // CDC re-issue check: only when BOTH sides have a recorded updatedAt and
  // they differ. NULL loaded.cdcUpdatedAt means we never recorded it (e.g.
  // initial seed pre-dates the admin sync path) — treat as "unknown" so the
  // badge doesn't claim a re-issue on every check just because the seed
  // didn't capture it.
  if (
    probe.provider === 'cdc_places' &&
    loaded.cdcUpdatedAt != null &&
    loaded.cdcUpdatedAt !== probe.rowsUpdatedAt
  ) {
    return { newer: true, reason: 'cdc_reissue' };
  }
  return { newer: false, reason: 'already_latest' };
}

/** Lex-compare vintage strings ("2024" > "2023"). */
function compareVintage(a: string, b: string): number {
  const an = Number(a);
  const bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return a.localeCompare(b);
}
