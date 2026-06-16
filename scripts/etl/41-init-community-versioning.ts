/**
 * ETL 41 — initialize Community-Indicator versioning + status rows.
 *
 * Idempotent. Two effects:
 *   1. Apply schema.sql (adds the community_provider_* tables; IF NOT EXISTS
 *      on everything else).
 *   2. For each provider in ['acs', 'cdc_places']:
 *        - if `community_provider_current[provider]` already points at a
 *          version, do nothing for that provider.
 *        - otherwise, seed v1 = current community_indicator_values rows for
 *          that provider's indicators (looked up via the registry); set the
 *          current pointer; UPSERT the status row with loaded_vintage = max
 *          year present, last_check_ok = FALSE (no upstream probe yet).
 *
 * Run AFTER etl:acs + etl:cdc, OR with empty community_indicator_values
 * (in which case the seed is a no-op and `community_provider_current`
 * stays empty until the first sync).
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execScript, pool } from '../lib/db.js';
import { activeAcsIndicators, activeCdcIndicators } from '../../src/registry/indicators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, '..', '..', 'src', 'db', 'schema.sql');

interface ProviderConfig {
  provider: 'acs' | 'cdc_places';
  indicatorIds: string[];
}

async function main(): Promise<void> {
  console.log(`[etl:community-init] applying schema from ${SCHEMA_PATH}`);
  const sqlText = await readFile(SCHEMA_PATH, 'utf-8');
  await execScript(sqlText);

  const providers: ProviderConfig[] = [
    { provider: 'acs', indicatorIds: activeAcsIndicators().map((i) => i.id) },
    { provider: 'cdc_places', indicatorIds: activeCdcIndicators().map((i) => i.id) },
  ];

  for (const cfg of providers) {
    await seedProvider(cfg);
  }
}

async function seedProvider(cfg: ProviderConfig): Promise<void> {
  const p = pool();
  const existing = await p.query(
    `SELECT version_id FROM community_provider_current WHERE provider = $1`,
    [cfg.provider],
  );
  if (existing.rows.length > 0) {
    console.log(`[etl:community-init] ${cfg.provider}: already at v${existing.rows[0].version_id}, skipping seed`);
    return;
  }

  if (cfg.indicatorIds.length === 0) {
    console.log(`[etl:community-init] ${cfg.provider}: no active indicators, skipping`);
    return;
  }

  const rowsRes = await p.query(
    `SELECT area_id, geo_layer, indicator_id, year, value_num, value_text, label, source_year
       FROM community_indicator_values
      WHERE indicator_id = ANY($1::text[])`,
    [cfg.indicatorIds],
  );
  const rows = rowsRes.rows;

  if (rows.length === 0) {
    console.log(`[etl:community-init] ${cfg.provider}: no live rows yet — skipping (re-run after etl:${cfg.provider === 'acs' ? 'acs' : 'cdc'})`);
    return;
  }

  console.log(`[etl:community-init] ${cfg.provider}: seeding v1 from ${rows.length} live rows`);

  // Build vintages index for the metadata column.
  const vintages: Record<string, Set<string>> = {};
  let maxVintage = '';
  for (const r of rows) {
    if (!vintages[r.indicator_id]) vintages[r.indicator_id] = new Set();
    vintages[r.indicator_id]!.add(r.year);
    if (r.year > maxVintage) maxVintage = r.year;
  }
  const vintagesIndex: Record<string, string[]> = {};
  for (const k of Object.keys(vintages)) {
    vintagesIndex[k] = [...vintages[k]!].sort();
  }

  await p.query('BEGIN');
  try {
    const verRes = await p.query(
      `INSERT INTO community_provider_versions (provider, created_by, source, notes, row_count, vintages)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING version_id`,
      [cfg.provider, 'system', 'seed', 'Initial seed from live community_indicator_values', rows.length, JSON.stringify(vintagesIndex)],
    );
    const versionId = (verRes.rows[0] as { version_id: number }).version_id;

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const tuples: string[] = [];
      const params: unknown[] = [];
      let n = 1;
      for (const r of chunk) {
        const payload = {
          value_num: r.value_num,
          value_text: r.value_text,
          label: r.label,
          source_year: r.source_year,
        };
        tuples.push(`($${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}::jsonb)`);
        params.push(versionId, r.area_id, r.geo_layer, r.indicator_id, r.year, JSON.stringify(payload));
      }
      await p.query(
        `INSERT INTO community_provider_version_rows (version_id, area_id, geo_layer, indicator_id, year, payload)
         VALUES ${tuples.join(', ')}`,
        params,
      );
    }

    await p.query(
      `INSERT INTO community_provider_current (provider, version_id, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (provider) DO UPDATE SET version_id = EXCLUDED.version_id, updated_at = EXCLUDED.updated_at`,
      [cfg.provider, versionId],
    );

    await p.query(
      `INSERT INTO community_provider_status (provider, loaded_vintage, last_check_ok, update_available)
       VALUES ($1, $2, FALSE, FALSE)
       ON CONFLICT (provider) DO UPDATE SET loaded_vintage = EXCLUDED.loaded_vintage`,
      [cfg.provider, maxVintage || null],
    );

    await p.query('COMMIT');
    console.log(`[etl:community-init] ${cfg.provider}: seeded v${versionId}, loaded_vintage=${maxVintage}`);
  } catch (err) {
    await p.query('ROLLBACK');
    throw err;
  }
}

main().catch((err) => {
  console.error('[etl:community-init] failed:', err);
  process.exit(1);
});
