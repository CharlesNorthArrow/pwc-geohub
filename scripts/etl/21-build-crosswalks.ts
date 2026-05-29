/**
 * ETL 21 — build school↔geography crosswalks in PostGIS.
 *
 * Required by Phase 0 acceptance tests:
 *   - school_district (used by §5.6 aggregation toggle)
 *   - nta_2020       (used by §5.6 aggregation toggle)
 *
 * Implemented as a single ST_Within insert per layer. The table is general by
 * `geo_layer`, so when later phases enable Council / Assembly / Senate /
 * Community District / Congressional / NDA, we drop them into the same loop
 * with zero DDL.
 */

import { db } from '../lib/db.js';
import { recordFinding } from '../lib/findings.js';

const PHASE0_LAYERS = ['school_district', 'nta_2020'] as const;

async function buildOne(layer: string): Promise<void> {
  const sql = db();
  console.log(`[etl:crosswalks] computing school↔${layer}`);

  // Replace existing rows for this layer (idempotent + cheap on a few-thousand row table).
  await sql`DELETE FROM school_geo_crosswalk WHERE geo_layer = ${layer}`;

  await sql`
    INSERT INTO school_geo_crosswalk (dbn, geo_layer, area_id)
    SELECT s.dbn, g.geo_layer, g.area_id
      FROM schools s
      JOIN geographies g
        ON g.geo_layer = ${layer}
       AND s.geom IS NOT NULL
       AND ST_Within(s.geom, g.geom)
  `;

  const matched = (await sql`
    SELECT COUNT(*)::int AS n FROM school_geo_crosswalk WHERE geo_layer = ${layer}
  `) as Array<{ n: number }>;
  const unmatched = (await sql`
    SELECT s.dbn
      FROM schools s
     WHERE s.geom IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM school_geo_crosswalk c
          WHERE c.dbn = s.dbn AND c.geo_layer = ${layer}
       )
  `) as Array<{ dbn: string }>;

  console.log(
    `[etl:crosswalks] ${layer}: matched=${matched[0]?.n ?? 0}, ` +
      `unmatched (plottable, no polygon)=${unmatched.length}`,
  );

  await recordFinding('crosswalk_unmatched', layer, {
    unmatched_count: unmatched.length,
    sample_dbns: unmatched.slice(0, 25).map((u) => u.dbn),
  });
  await recordFinding('ingestion_summary', `crosswalk:${layer}`, {
    matched: matched[0]?.n ?? 0,
    unmatched: unmatched.length,
  });
}

async function main(): Promise<void> {
  for (const layer of PHASE0_LAYERS) {
    await buildOne(layer);
  }
  console.log('[etl:crosswalks] done.');
}

main().catch((err) => {
  console.error('[etl:crosswalks] failed:', err);
  process.exit(1);
});
