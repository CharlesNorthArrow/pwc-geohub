/**
 * Canonical schema for the schools_master dataset (the `schools` +
 * `schools_year` source panel).
 *
 * This file IS the schema — `View schema` reads from it; column matching
 * compares against it; the merge & upsert paths use the type tags. It mirrors
 * the 33-column contract of `data/schools_master.csv` (see
 * `scripts/etl/10-load-schools-master.ts` MasterRow) — one place to keep in
 * sync with `src/db/schema.sql` (schools / schools_year).
 *
 * Notes:
 *  - `pct_*` and `economic_need_index` are FRACTIONS in [0, 1] (the API layer
 *    scales ×100). An upload with 0–100 percentages is flagged at preview.
 *  - Count columns are typed `number` (not `integer`) so "1,234" and "540.0"
 *    coerce like the ETL does; they're rounded when written to the INTEGER
 *    live columns (schoolMasterTransform).
 *  - Unlike pwc_schools uploads, the 08X208→84X208 DBN remap IS applied on
 *    upload — matching the schools_master ETL semantics, so identity stays
 *    consistent with every table that joins on `schools.dbn`.
 */

import type { AdminField } from './schemaTypes';

export const MASTER_FIELDS: readonly AdminField[] = [
  // ---- keys ---------------------------------------------------------------
  { id: 'DBN',                            type: 'text',   isKey: true,  description: 'NYC DOE school code — composite key with school_year. Strings preserved exactly (leading zeros). 08X208 is remapped to 84X208 on upload, matching the ETL.' },
  { id: 'school_year',                    type: 'text',   isKey: true,  description: '"YYYY-YY" school year. Composite key with DBN.' },
  // ---- identity -----------------------------------------------------------
  { id: 'school_name',                    type: 'text',   isKey: false, description: 'School name (identity comes from the latest year with coordinates).' },
  { id: 'borough',                        type: 'text',   isKey: false, description: 'Borough (Manhattan / Bronx / Brooklyn / Queens / Staten Island).' },
  { id: 'address',                        type: 'text',   isKey: false, description: 'Street address.' },
  { id: 'latitude',                       type: 'number', isKey: false, description: 'WGS84 latitude. Missing on ~5% of rows → school is unplottable.' },
  { id: 'longitude',                      type: 'number', isKey: false, description: 'WGS84 longitude.' },
  { id: 'location_category',              type: 'text',   isKey: false, description: 'DOE location category (Elementary, High School, …).' },
  { id: 'managed_by',                     type: 'text',   isKey: false, description: 'Managing entity (DOE, Charter, …).' },
  { id: 'location_type',                  type: 'text',   isKey: false, description: 'DOE location type (General Academic, Special Education, …).' },
  { id: 'grades',                         type: 'text',   isKey: false, description: 'Grades served, free text (e.g. "PK,0K,01,…").' },
  // ---- enrollment + demographics (per year) --------------------------------
  { id: 'total_enrollment',               type: 'number', isKey: false, description: 'Total enrollment — drives circle size on the map.' },
  { id: 'n_students_with_disabilities',   type: 'number', isKey: false, description: 'Students with disabilities (count).' },
  { id: 'pct_students_with_disabilities', type: 'number', isKey: false, description: 'Students with disabilities (fraction 0–1).' },
  { id: 'n_english_language_learners',    type: 'number', isKey: false, description: 'English language learners (count).' },
  { id: 'pct_english_language_learners',  type: 'number', isKey: false, description: 'English language learners (fraction 0–1).' },
  { id: 'n_poverty',                      type: 'number', isKey: false, description: 'Students in poverty (count).' },
  { id: 'pct_poverty',                    type: 'number', isKey: false, description: 'Students in poverty (fraction 0–1; "Above 95%" → null).' },
  { id: 'economic_need_index',            type: 'number', isKey: false, description: 'Economic Need Index (fraction 0–1; "Above 95%" → null).' },
  { id: 'n_asian',                        type: 'number', isKey: false, description: 'Asian students (count).' },
  { id: 'pct_asian',                      type: 'number', isKey: false, description: 'Asian students (fraction 0–1).' },
  { id: 'n_black',                        type: 'number', isKey: false, description: 'Black students (count).' },
  { id: 'pct_black',                      type: 'number', isKey: false, description: 'Black students (fraction 0–1).' },
  { id: 'n_hispanic',                     type: 'number', isKey: false, description: 'Hispanic students (count).' },
  { id: 'pct_hispanic',                   type: 'number', isKey: false, description: 'Hispanic students (fraction 0–1).' },
  { id: 'n_white',                        type: 'number', isKey: false, description: 'White students (count).' },
  { id: 'pct_white',                      type: 'number', isKey: false, description: 'White students (fraction 0–1).' },
  { id: 'n_multi_racial',                 type: 'number', isKey: false, description: 'Multi-racial students (count).' },
  { id: 'pct_multi_racial',               type: 'number', isKey: false, description: 'Multi-racial students (fraction 0–1).' },
  { id: 'n_female',                       type: 'number', isKey: false, description: 'Female students (count).' },
  { id: 'pct_female',                     type: 'number', isKey: false, description: 'Female students (fraction 0–1).' },
  { id: 'n_male',                         type: 'number', isKey: false, description: 'Male students (count).' },
  { id: 'pct_male',                       type: 'number', isKey: false, description: 'Male students (fraction 0–1).' },
];

export const MASTER_KEY_FIELDS = MASTER_FIELDS.filter((f) => f.isKey).map((f) => f.id) as readonly string[];
export const MASTER_DATA_FIELDS = MASTER_FIELDS.filter((f) => !f.isKey).map((f) => f.id) as readonly string[];

/** The pct/fraction columns sanity-checked at preview (expected 0–1). */
export const MASTER_FRACTION_FIELDS = MASTER_DATA_FIELDS.filter(
  (id) => id.startsWith('pct_') || id === 'economic_need_index',
) as readonly string[];

export function getMasterField(id: string): AdminField | undefined {
  return MASTER_FIELDS.find((f) => f.id === id);
}
