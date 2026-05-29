/**
 * US Census ACS 5-year API client.
 *
 * Two responsibilities:
 *   1. Build the right URL for an ACS endpoint + table + geography.
 *   2. Cache the raw response in `api_cache` so the ETL is replayable
 *      without re-hitting Census.
 *
 * Geography note: we always request all NY-state (FIPS 36) tracts — Census
 * supports `for=tract:*&in=state:36`, which is more efficient than looping
 * per-county. NYC tracts are filtered downstream via county FIPS in the
 * tract GEOID prefix.
 */

import { db } from './db.js';

export type AcsEndpoint = 'acs5' | 'acs5/subject' | 'acs5/profile';

interface AcsFetchOptions {
  year: string;
  endpoint: AcsEndpoint;
  fields: string[];
  /** Default: `for=tract:*&in=state:36`. */
  geo?: string;
}

export async function acsFetch(
  opts: AcsFetchOptions,
): Promise<Array<Record<string, string>>> {
  const cacheKey = buildCacheKey(opts);
  const cached = await readCache(cacheKey);
  if (cached) return cached;

  const url = buildUrl(opts);
  const key = process.env.CENSUS_API_KEY;
  if (key) url.searchParams.set('key', key);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `ACS fetch failed (${res.status}) for ${url.toString()}: ${body.slice(0, 200)}`,
    );
  }
  const payload = (await res.json()) as string[][];
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error(`ACS empty response for ${url.toString()}`);
  }
  const objects = matrixToObjects(payload);
  await writeCache(cacheKey, objects);
  return objects;
}

function buildUrl(opts: AcsFetchOptions): URL {
  const base = `https://api.census.gov/data/${opts.year}/${opts.endpoint}`;
  const url = new URL(base);
  url.searchParams.set('get', ['NAME', ...opts.fields].join(','));
  const [forKv, inKv] = (opts.geo ?? 'for=tract:*&in=state:36').split('&');
  if (forKv) {
    const [k, v] = forKv.split('=');
    if (k && v) url.searchParams.set(k, v);
  }
  if (inKv) {
    const [k, v] = inKv.split('=');
    if (k && v) url.searchParams.set(k, v);
  }
  return url;
}

function buildCacheKey(opts: AcsFetchOptions): string {
  return `acs:${opts.year}:${opts.endpoint}:${opts.fields.slice().sort().join('+')}:${opts.geo ?? 'tract:36'}`;
}

function matrixToObjects(matrix: string[][]): Array<Record<string, string>> {
  const [header, ...rest] = matrix;
  if (!header) return [];
  return rest.map((row) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      const key = header[i]!;
      const val = row[i] ?? '';
      obj[key] = val;
    }
    return obj;
  });
}

async function readCache(key: string): Promise<Array<Record<string, string>> | null> {
  try {
    const sql = db();
    const rows = (await sql`SELECT payload FROM api_cache WHERE cache_key = ${key}`) as Array<{
      payload: Array<Record<string, string>>;
    }>;
    return rows[0]?.payload ?? null;
  } catch {
    return null;
  }
}

async function writeCache(
  key: string,
  payload: Array<Record<string, string>>,
): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO api_cache (cache_key, payload, fetched_at)
    VALUES (${key}, ${JSON.stringify(payload)}::jsonb, now())
    ON CONFLICT (cache_key) DO UPDATE
      SET payload = EXCLUDED.payload,
          fetched_at = EXCLUDED.fetched_at
  `;
}

/**
 * Compute a tract GEOID (11-char) from ACS's state/county/tract triple.
 * Census returns state="36", county="005", tract="000100" etc.
 */
export function buildTractGeoid(state: string, county: string, tract: string): string {
  return `${state.padStart(2, '0')}${county.padStart(3, '0')}${tract.padStart(6, '0')}`;
}
