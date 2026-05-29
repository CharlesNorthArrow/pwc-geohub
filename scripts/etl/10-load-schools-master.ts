/**
 * ETL 10 — load schools_master.csv → `schools` + `schools_year`.
 *
 *  - Apply the 08X208→84X208 DBN remap.
 *  - Build one `schools` row per DBN, populated from the *latest* year that
 *    has a non-null name/coords (so identity is stable across years).
 *  - Fan out one `schools_year` row per (DBN, school_year).
 *  - Record findings: remap_applied counts, null_coords schools, ingestion summary.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bulkUpsert } from '../lib/db.js';
import { readCsv } from '../lib/csv.js';
import { normalizeDbn, wasDbnRemapped } from '../lib/dbn.js';
import { toNullableNumber, toNullableInt } from '../lib/normalize.js';
import { schoolYearEnd } from '../lib/year.js';
import { recordFinding } from '../lib/findings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', '..', 'data');
const MASTER_PATH = resolve(DATA_DIR, 'schools_master.csv');

interface MasterRow {
  DBN: string;
  school_name: string;
  school_year: string;
  borough: string;
  address: string;
  latitude: string;
  longitude: string;
  location_category: string;
  managed_by: string;
  location_type: string;
  grades: string;
  total_enrollment: string;
  n_students_with_disabilities: string;
  pct_students_with_disabilities: string;
  n_english_language_learners: string;
  pct_english_language_learners: string;
  n_poverty: string;
  pct_poverty: string;
  economic_need_index: string;
  n_asian: string;  pct_asian: string;
  n_black: string;  pct_black: string;
  n_hispanic: string; pct_hispanic: string;
  n_white: string;  pct_white: string;
  n_multi_racial: string; pct_multi_racial: string;
  n_female: string; pct_female: string;
  n_male: string;   pct_male: string;
}

async function main(): Promise<void> {
  console.log(`[etl:schools] reading ${MASTER_PATH}`);
  const rows = (await readCsv(MASTER_PATH)) as unknown as MasterRow[];
  console.log(`[etl:schools] ${rows.length} raw rows`);

  // ---------------------------------------------------------------------------
  // Pass 1: collect every (DBN, school_year) row and apply DBN remap.
  // ---------------------------------------------------------------------------
  let remapCount = 0;
  const perDbn = new Map<string, MasterRow[]>();
  for (const raw of rows) {
    if (wasDbnRemapped(raw.DBN)) remapCount++;
    const dbn = normalizeDbn(raw.DBN);
    if (!dbn) continue;
    if (!perDbn.has(dbn)) perDbn.set(dbn, []);
    perDbn.get(dbn)!.push(raw);
  }
  console.log(`[etl:schools] ${perDbn.size} unique DBNs after remap (remaps applied: ${remapCount})`);
  await recordFinding('remap_applied', '08X208->84X208', { rows_remapped: remapCount });

  // ---------------------------------------------------------------------------
  // Pass 2: upsert `schools` (identity from latest year with coords).
  // ---------------------------------------------------------------------------
  let nullCoordSchools = 0;
  const schoolRows: Array<{
    dbn: string;
    school_name: string | null;
    borough: string | null;
    address: string | null;
    managed_by: string | null;
    location_category: string | null;
    location_type: string | null;
    grades: string | null;
    latitude: number | null;
    longitude: number | null;
    identity_source_year: string | null;
  }> = [];

  for (const [dbn, rs] of perDbn) {
    const sorted = [...rs].sort(
      (a, b) => (schoolYearEnd(b.school_year) ?? 0) - (schoolYearEnd(a.school_year) ?? 0),
    );
    // Prefer the most recent year that has coordinates; fall back to most recent overall.
    const withCoords = sorted.find(
      (r) => toNullableNumber(r.latitude) != null && toNullableNumber(r.longitude) != null,
    );
    const identity = withCoords ?? sorted[0]!;
    const lat = toNullableNumber(identity.latitude);
    const lon = toNullableNumber(identity.longitude);
    if (lat == null || lon == null) {
      nullCoordSchools++;
      await recordFinding('null_coords', dbn, { school_name: identity.school_name });
    }
    schoolRows.push({
      dbn,
      school_name: identity.school_name || null,
      borough: identity.borough || null,
      address: identity.address || null,
      managed_by: identity.managed_by || null,
      location_category: identity.location_category || null,
      location_type: identity.location_type || null,
      grades: identity.grades || null,
      latitude: lat,
      longitude: lon,
      identity_source_year: identity.school_year || null,
    });
  }

  console.log(`[etl:schools] upserting ${schoolRows.length} schools (null-coord: ${nullCoordSchools})`);
  await bulkUpsert({
    table: 'schools',
    columns: [
      'dbn', 'school_name', 'borough', 'address', 'managed_by', 'location_category',
      'location_type', 'grades', 'latitude', 'longitude', 'geom', 'identity_source_year',
    ],
    rows: schoolRows.map((s) => [
      s.dbn, s.school_name, s.borough, s.address, s.managed_by, s.location_category,
      s.location_type, s.grades, s.latitude, s.longitude,
      s.latitude == null || s.longitude == null
        ? null
        : `SRID=4326;POINT(${s.longitude} ${s.latitude})`,
      s.identity_source_year,
    ]),
    conflictKeys: ['dbn'],
    valueExpressions: {
      geom: (n) => ({ expr: `ST_GeomFromEWKT($${n}::text)`, consumes: 1 }),
    },
  });

  // ---------------------------------------------------------------------------
  // Pass 3: load schools_year (wide demographics per year) via bulk upsert.
  // ---------------------------------------------------------------------------
  const yearRows: unknown[][] = [];
  for (const [dbn, rs] of perDbn) {
    for (const r of rs) {
      if (!r.school_year) continue;
      yearRows.push([
        dbn, r.school_year,
        toNullableInt(r.total_enrollment),
        toNullableInt(r.n_students_with_disabilities), toNullableNumber(r.pct_students_with_disabilities),
        toNullableInt(r.n_english_language_learners),  toNullableNumber(r.pct_english_language_learners),
        toNullableInt(r.n_poverty), toNullableNumber(r.pct_poverty), toNullableNumber(r.economic_need_index),
        toNullableInt(r.n_asian), toNullableNumber(r.pct_asian),
        toNullableInt(r.n_black), toNullableNumber(r.pct_black),
        toNullableInt(r.n_hispanic), toNullableNumber(r.pct_hispanic),
        toNullableInt(r.n_white), toNullableNumber(r.pct_white),
        toNullableInt(r.n_multi_racial), toNullableNumber(r.pct_multi_racial),
        toNullableInt(r.n_female), toNullableNumber(r.pct_female),
        toNullableInt(r.n_male), toNullableNumber(r.pct_male),
      ]);
    }
  }
  const yearRowCount = await bulkUpsert({
    table: 'schools_year',
    columns: [
      'dbn', 'school_year',
      'total_enrollment',
      'n_students_with_disabilities', 'pct_students_with_disabilities',
      'n_english_language_learners',  'pct_english_language_learners',
      'n_poverty', 'pct_poverty', 'economic_need_index',
      'n_asian', 'pct_asian', 'n_black', 'pct_black',
      'n_hispanic', 'pct_hispanic', 'n_white', 'pct_white',
      'n_multi_racial', 'pct_multi_racial',
      'n_female', 'pct_female', 'n_male', 'pct_male',
    ],
    rows: yearRows,
    conflictKeys: ['dbn', 'school_year'],
  });
  console.log(`[etl:schools] ${yearRowCount} schools_year rows upserted`);

  await recordFinding('ingestion_summary', 'schools_master', {
    csv_rows: rows.length,
    unique_dbns: perDbn.size,
    schools_year_rows: yearRowCount,
    null_coord_schools: nullCoordSchools,
    remaps_applied: remapCount,
  });

  console.log(`[etl:schools] done — ${perDbn.size} schools, ${yearRowCount} year rows.`);
}

main().catch((err) => {
  console.error('[etl:schools] failed:', err);
  process.exit(1);
});
