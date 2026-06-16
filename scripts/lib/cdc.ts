/**
 * CDC PLACES (Socrata) client.
 *
 * Public dataset: `cwsq-ngmh` = PLACES Census Tract Data. We pull two measures
 * (MHLTH, HOUSING) for NY-state tracts.
 *
 * App token is optional; setting CDC_APP_TOKEN raises throttling limits.
 */

import { db } from './db.js';

interface CdcOptions {
  resource: 'cwsq-ngmh';
  measureId: string;
  stateAbbr?: string;
  /** Skip the api_cache read. Cache is still WRITTEN. Used by admin sync. */
  forceFresh?: boolean;
}

export interface CdcPlacesRow {
  stateabbr: string;
  countyname: string;
  countyfips: string;
  locationname: string;   // tract GEOID
  data_value: string;     // % estimate
  data_value_unit?: string;
  measureid: string;
  measure: string;
  year: string;
  short_question_text?: string;
}

const PAGE_SIZE = 50_000;

export async function fetchCdcPlaces(opts: CdcOptions): Promise<CdcPlacesRow[]> {
  const stateAbbr = opts.stateAbbr ?? 'NY';
  const cacheKey = `cdc:${opts.resource}:${opts.measureId}:${stateAbbr}`;
  if (!opts.forceFresh) {
    const cached = await readCache(cacheKey);
    if (cached) return cached;
  }

  const rows: CdcPlacesRow[] = [];
  let offset = 0;
  while (true) {
    const url = new URL(`https://data.cdc.gov/resource/${opts.resource}.json`);
    url.searchParams.set('$where', `measureid='${opts.measureId}' AND stateabbr='${stateAbbr}'`);
    url.searchParams.set('$limit', String(PAGE_SIZE));
    url.searchParams.set('$offset', String(offset));

    const headers: Record<string, string> = {};
    const token = process.env.CDC_APP_TOKEN;
    if (token) headers['X-App-Token'] = token;

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`CDC fetch failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const page = (await res.json()) as CdcPlacesRow[];
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += page.length;
  }

  await writeCache(cacheKey, rows);
  return rows;
}

async function readCache(key: string): Promise<CdcPlacesRow[] | null> {
  try {
    const sql = db();
    const r = (await sql`SELECT payload FROM api_cache WHERE cache_key = ${key}`) as Array<{
      payload: CdcPlacesRow[];
    }>;
    return r[0]?.payload ?? null;
  } catch {
    return null;
  }
}

async function writeCache(key: string, payload: CdcPlacesRow[]): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO api_cache (cache_key, payload, fetched_at)
    VALUES (${key}, ${JSON.stringify(payload)}::jsonb, now())
    ON CONFLICT (cache_key) DO UPDATE
      SET payload = EXCLUDED.payload,
          fetched_at = EXCLUDED.fetched_at
  `;
}
