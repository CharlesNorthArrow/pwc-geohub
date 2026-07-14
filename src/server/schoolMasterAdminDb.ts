/**
 * SQL queries used by the "School data master" admin API routes.
 *
 * Mirrors src/server/adminDb.ts (the pwc_schools flow) with ONE deliberate
 * difference: `applyMasterVersion()` UPSERTS the live tables (`schools`,
 * `schools_year`) instead of delete-and-replace. Those tables are the FK
 * parents of pwc_school_program / school_indicator_values /
 * school_geo_crosswalk (all ON DELETE CASCADE) — a swap would wipe them.
 * The merge layer never deletes rows, so upsert keeps live tables and
 * version rows consistent.
 *
 * Crosswalk rebuild is separate (`rebuildSchoolGeoCrosswalks`) and runs
 * AFTER the version transaction commits — a rebuild failure leaves the map
 * with stale (not missing) geo assignments and is surfaced as a warning.
 */

import { pool } from './db';
import type { VersionRow, VersionPayloadRow } from './adminDb';
import { CROSSWALK_LAYERS } from '../lib/crosswalkLayers';
import {
  deriveSchoolIdentities,
  deriveSchoolYearRecords,
  SCHOOLS_YEAR_COLUMNS,
  type MasterVersionRow,
} from '../admin/schoolMasterTransform';
import type { Payload } from '../admin/merge';

export async function getCurrentMasterVersionId(): Promise<number | null> {
  const r = await pool().query(`SELECT version_id FROM school_master_current WHERE pin = 1`);
  if (r.rows.length === 0) return null;
  return (r.rows[0] as { version_id: number }).version_id;
}

export async function listMasterVersions(): Promise<VersionRow[]> {
  const currentId = await getCurrentMasterVersionId();
  const r = await pool().query(
    `SELECT version_id, created_at, created_by, source, notes, row_count, csv_url
       FROM school_master_versions
   ORDER BY version_id DESC`,
  );
  return r.rows.map((row) => ({
    version_id: row.version_id,
    created_at: row.created_at,
    created_by: row.created_by,
    source: row.source,
    notes: row.notes,
    row_count: row.row_count,
    csv_url: row.csv_url,
    is_current: row.version_id === currentId,
  }));
}

export async function getMasterVersionRows(versionId: number): Promise<VersionPayloadRow[]> {
  const r = await pool().query(
    `SELECT dbn, school_year, payload
       FROM school_master_version_rows
      WHERE version_id = $1
   ORDER BY dbn, school_year`,
    [versionId],
  );
  return r.rows.map((row) => ({
    dbn: row.dbn,
    school_year: row.school_year,
    payload: row.payload as Payload,
  }));
}

/**
 * Active-version summary for the section badge. Tolerates the versioning
 * tables not existing yet (fresh deploy before `etl:init` ran) so the /admin
 * page keeps rendering — the section then shows "No data yet".
 */
export async function getActiveMasterSchema(): Promise<{
  versionId: number | null;
  rowCount: number;
  updatedAt: string | null;
}> {
  try {
    const r = await pool().query(
      `SELECT c.version_id, v.row_count, c.updated_at
         FROM school_master_current c
         JOIN school_master_versions v ON v.version_id = c.version_id
        WHERE c.pin = 1`,
    );
    if (r.rows.length === 0) return { versionId: null, rowCount: 0, updatedAt: null };
    return {
      versionId: r.rows[0].version_id,
      rowCount: r.rows[0].row_count,
      updatedAt: r.rows[0].updated_at,
    };
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') {
      // undefined_table — schema migration hasn't run yet.
      return { versionId: null, rowCount: 0, updatedAt: null };
    }
    throw err;
  }
}

const CHUNK = 200;

/**
 * Atomic apply. Creates a new version, inserts its rows, UPSERTS the live
 * `schools` + `schools_year` tables from the transform derivation, and moves
 * the current pointer — all in one transaction. No DELETEs anywhere in here.
 */
export async function applyMasterVersion(args: {
  createdBy: string;
  source: string;
  notes: string | null;
  rows: MasterVersionRow[];
}): Promise<{ versionId: number }> {
  const p = pool();
  await p.query('BEGIN');
  try {
    const verRes = await p.query(
      `INSERT INTO school_master_versions (created_by, source, notes, row_count, csv_url)
       VALUES ($1, $2, $3, $4, NULL)
       RETURNING version_id`,
      [args.createdBy, args.source, args.notes, args.rows.length],
    );
    const versionId = (verRes.rows[0] as { version_id: number }).version_id;

    // school_master_version_rows — chunked insert.
    for (let i = 0; i < args.rows.length; i += CHUNK) {
      const chunk = args.rows.slice(i, i + CHUNK);
      const tuples: string[] = [];
      const params: unknown[] = [];
      let n = 1;
      for (const r of chunk) {
        tuples.push(`($${n++}, $${n++}, $${n++}, $${n++}::jsonb)`);
        params.push(versionId, r.dbn, r.school_year, JSON.stringify(r.payload));
      }
      await p.query(
        `INSERT INTO school_master_version_rows (version_id, dbn, school_year, payload)
         VALUES ${tuples.join(', ')}`,
        params,
      );
    }

    // schools — identity upsert (same derivation as the ETL loader).
    const identities = deriveSchoolIdentities(args.rows);
    for (let i = 0; i < identities.length; i += CHUNK) {
      const chunk = identities.slice(i, i + CHUNK);
      const tuples: string[] = [];
      const params: unknown[] = [];
      let n = 1;
      for (const s of chunk) {
        tuples.push(
          `($${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, ST_GeomFromEWKT($${n++}::text), $${n++})`,
        );
        params.push(
          s.dbn, s.school_name, s.borough, s.address, s.managed_by, s.location_category,
          s.location_type, s.grades, s.latitude, s.longitude, s.geom_ewkt, s.identity_source_year,
        );
      }
      await p.query(
        `INSERT INTO schools (dbn, school_name, borough, address, managed_by, location_category,
                              location_type, grades, latitude, longitude, geom, identity_source_year)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (dbn) DO UPDATE SET
           school_name = EXCLUDED.school_name,
           borough = EXCLUDED.borough,
           address = EXCLUDED.address,
           managed_by = EXCLUDED.managed_by,
           location_category = EXCLUDED.location_category,
           location_type = EXCLUDED.location_type,
           grades = EXCLUDED.grades,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           geom = EXCLUDED.geom,
           identity_source_year = EXCLUDED.identity_source_year,
           updated_at = now()`,
        params,
      );
    }

    // schools_year — per-year upsert.
    const yearRecords = deriveSchoolYearRecords(args.rows);
    const yearCols = SCHOOLS_YEAR_COLUMNS;
    // 2 keys + 22 values = 24 params/row → 100-row chunks stay far under limits.
    const YEAR_CHUNK = 100;
    for (let i = 0; i < yearRecords.length; i += YEAR_CHUNK) {
      const chunk = yearRecords.slice(i, i + YEAR_CHUNK);
      const tuples: string[] = [];
      const params: unknown[] = [];
      let n = 1;
      for (const r of chunk) {
        const placeholders: string[] = [`$${n++}`, `$${n++}`];
        params.push(r.dbn, r.school_year);
        for (const v of r.values) {
          placeholders.push(`$${n++}`);
          params.push(v);
        }
        tuples.push(`(${placeholders.join(', ')})`);
      }
      await p.query(
        `INSERT INTO schools_year (dbn, school_year, ${yearCols.join(', ')})
         VALUES ${tuples.join(', ')}
         ON CONFLICT (dbn, school_year) DO UPDATE SET
           ${yearCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
        params,
      );
    }

    await p.query(
      `INSERT INTO school_master_current (pin, version_id, updated_at)
       VALUES (1, $1, now())
       ON CONFLICT (pin) DO UPDATE SET version_id = EXCLUDED.version_id, updated_at = EXCLUDED.updated_at`,
      [versionId],
    );
    await p.query('COMMIT');
    return { versionId };
  } catch (err) {
    await p.query('ROLLBACK');
    throw err;
  }
}

export async function updateMasterCsvUrl(versionId: number, csvUrl: string): Promise<void> {
  await pool().query(
    `UPDATE school_master_versions SET csv_url = $1 WHERE version_id = $2`,
    [csvUrl, versionId],
  );
}

/**
 * Rebuild the precomputed point-in-polygon crosswalk for every layer — the
 * same DELETE-then-ST_Within-INSERT as scripts/etl/21-build-crosswalks.ts.
 * Run after an apply/rollback so new or moved schools get geo assignments.
 * Layers are rebuilt one at a time; each layer's delete+insert runs in its
 * own transaction so a mid-way failure leaves whole layers either old or new.
 */
export async function rebuildSchoolGeoCrosswalks(): Promise<{ totalRows: number }> {
  const p = pool();
  let totalRows = 0;
  for (const layer of CROSSWALK_LAYERS) {
    await p.query('BEGIN');
    try {
      await p.query(`DELETE FROM school_geo_crosswalk WHERE geo_layer = $1`, [layer]);
      const ins = await p.query(
        `INSERT INTO school_geo_crosswalk (dbn, geo_layer, area_id)
         SELECT s.dbn, g.geo_layer, g.area_id
           FROM schools s
           JOIN geographies g
             ON g.geo_layer = $1
            AND s.geom IS NOT NULL
            AND ST_Within(s.geom, g.geom)`,
        [layer],
      );
      await p.query('COMMIT');
      totalRows += ins.rowCount ?? 0;
    } catch (err) {
      await p.query('ROLLBACK');
      throw err;
    }
  }
  return { totalRows };
}
