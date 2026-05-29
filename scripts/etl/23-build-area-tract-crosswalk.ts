/**
 * ETL 23 — build the area→tract crosswalk powering §5.4 community aggregation.
 *
 * For each NYC School District + NTA polygon we record the census tracts that
 * are CONTAINED IN or OVERLAP it (ST_Intersects). At request time the right
 * panel reads this via a single GROUP BY instead of recomputing point-in-
 * polygon — spec §11.9 serverless-fit rules.
 *
 * Idempotent. Re-runs cheaply (~tens of thousands of rows, no transfer cost).
 */

import { db } from '../lib/db.js';
import { recordFinding } from '../lib/findings.js';

const AREA_LAYERS = ['school_district', 'nta_2020'] as const;

async function buildOne(layer: (typeof AREA_LAYERS)[number]): Promise<void> {
  const sql = db();
  console.log(`[etl:area-tracts] ${layer} ↔ tracts`);

  await sql`DELETE FROM area_tract_crosswalk WHERE area_layer = ${layer}`;
  await sql`
    INSERT INTO area_tract_crosswalk (area_layer, area_id, tract_geoid)
    SELECT a.geo_layer, a.area_id, t.area_id
      FROM geographies a
      JOIN geographies t
        ON t.geo_layer = 'tract' AND ST_Intersects(a.geom, t.geom)
     WHERE a.geo_layer = ${layer}
  `;

  const rows = await sql<{ areas: number; pairs: number }>`
    SELECT COUNT(DISTINCT area_id)::int AS areas, COUNT(*)::int AS pairs
    FROM area_tract_crosswalk
    WHERE area_layer = ${layer}
  `;
  const summary = rows[0];
  console.log(
    `[etl:area-tracts] ${layer}: ${summary?.areas} areas, ${summary?.pairs} (area, tract) pairs`,
  );
  await recordFinding('ingestion_summary', `area_tract_crosswalk:${layer}`, {
    areas: summary?.areas ?? 0,
    pairs: summary?.pairs ?? 0,
  });
}

async function main(): Promise<void> {
  for (const layer of AREA_LAYERS) {
    await buildOne(layer);
  }
  console.log('[etl:area-tracts] done.');
}

main().catch((err) => {
  console.error('[etl:area-tracts] failed:', err);
  process.exit(1);
});
