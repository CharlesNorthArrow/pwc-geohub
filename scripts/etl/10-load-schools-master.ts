/**
 * ETL 10 — load schools_master.csv → `schools` + `schools_year`.
 *
 *  - Apply the 08X208→84X208 DBN remap.
 *  - Build one `schools` row per DBN, populated from the *latest* year that
 *    has a non-null name/coords (so identity is stable across years).
 *  - Fan out one `schools_year` row per (DBN, school_year).
 *  - Record findings: remap_applied counts, null_coords schools, ingestion summary.
 *
 * Coercion + derivation are shared with the Admin Panel "School data master"
 * upload path (src/admin/merge.ts coerceRow + src/admin/schoolMasterTransform)
 * so a CSV loaded here and the same CSV uploaded through /admin produce
 * identical live tables.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bulkUpsert } from '../lib/db.js';
import { readCsv } from '../lib/csv.js';
import { recordFinding } from '../lib/findings.js';
import {
  deriveSchoolIdentities,
  deriveSchoolYearRecords,
  masterCsvToVersionRows,
  SCHOOLS_YEAR_COLUMNS,
} from '../../src/admin/schoolMasterTransform';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', '..', 'data');
const MASTER_PATH = resolve(DATA_DIR, 'schools_master.csv');

async function main(): Promise<void> {
  console.log(`[etl:schools] reading ${MASTER_PATH}`);
  const rawRows = (await readCsv(MASTER_PATH)) as Array<Record<string, string>>;
  console.log(`[etl:schools] ${rawRows.length} raw rows`);

  const { rows, remapCount } = masterCsvToVersionRows(rawRows);
  const identities = deriveSchoolIdentities(rows);
  console.log(`[etl:schools] ${identities.length} unique DBNs after remap (remaps applied: ${remapCount})`);
  await recordFinding('remap_applied', '08X208->84X208', { rows_remapped: remapCount });

  // ---------------------------------------------------------------------------
  // Upsert `schools` (identity from latest year with coords).
  // ---------------------------------------------------------------------------
  let nullCoordSchools = 0;
  for (const s of identities) {
    if (s.geom_ewkt == null) {
      nullCoordSchools++;
      await recordFinding('null_coords', s.dbn, { school_name: s.school_name });
    }
  }

  console.log(`[etl:schools] upserting ${identities.length} schools (null-coord: ${nullCoordSchools})`);
  await bulkUpsert({
    table: 'schools',
    columns: [
      'dbn', 'school_name', 'borough', 'address', 'managed_by', 'location_category',
      'location_type', 'grades', 'latitude', 'longitude', 'geom', 'identity_source_year',
    ],
    rows: identities.map((s) => [
      s.dbn, s.school_name, s.borough, s.address, s.managed_by, s.location_category,
      s.location_type, s.grades, s.latitude, s.longitude, s.geom_ewkt, s.identity_source_year,
    ]),
    conflictKeys: ['dbn'],
    valueExpressions: {
      geom: (n) => ({ expr: `ST_GeomFromEWKT($${n}::text)`, consumes: 1 }),
    },
  });

  // ---------------------------------------------------------------------------
  // Load schools_year (wide demographics per year) via bulk upsert.
  // ---------------------------------------------------------------------------
  const yearRecords = deriveSchoolYearRecords(rows);
  const yearRowCount = await bulkUpsert({
    table: 'schools_year',
    columns: ['dbn', 'school_year', ...SCHOOLS_YEAR_COLUMNS],
    rows: yearRecords.map((r) => [r.dbn, r.school_year, ...r.values]),
    conflictKeys: ['dbn', 'school_year'],
  });
  console.log(`[etl:schools] ${yearRowCount} schools_year rows upserted`);

  await recordFinding('ingestion_summary', 'schools_master', {
    csv_rows: rawRows.length,
    unique_dbns: identities.length,
    schools_year_rows: yearRowCount,
    null_coord_schools: nullCoordSchools,
    remaps_applied: remapCount,
  });

  console.log(`[etl:schools] done — ${identities.length} schools, ${yearRowCount} year rows.`);
}

main().catch((err) => {
  console.error('[etl:schools] failed:', err);
  process.exit(1);
});
