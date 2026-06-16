/**
 * Canonical schema for the pwc_school_program dataset.
 *
 * This file IS the schema — `View schema` reads from it; column matching
 * compares against it; the merge & insert paths use the type tags. One
 * place to keep in sync with `src/db/schema.sql` (pwc_school_program).
 *
 * Adding a column to the schema is OUT OF SCOPE for this Admin Panel round
 * — schema evolution still happens via a migration + code change. The Admin
 * Panel reconciles incoming files against THIS shape; it never mutates it.
 */

export type PwcFieldType = 'text' | 'integer' | 'boolean';

export interface PwcField {
  /** Column name as it must appear in the live table / CSV. */
  id: string;
  type: PwcFieldType;
  /** True for the composite primary key (dbn, school_year). */
  isKey: boolean;
  /** Plain-English description shown in the "View schema" dialog. */
  description: string;
  /** Optional historical aliases — if the new CSV uses an old header
   *  name (e.g. `school_type` → `governance_school_type`), classification
   *  treats it as an EXACT match rather than asking the admin to map it.
   *  Suggestions still surface to "View schema" so the rename is visible. */
  aliases?: readonly string[];
}

export const PWC_FIELDS: readonly PwcField[] = [
  // ---- keys ---------------------------------------------------------------
  { id: 'DBN',                              type: 'text',    isKey: true,  description: 'NYC DOE school code — composite key with school_year. Strings preserved exactly (leading zeros, charter prefixes). No 84X208 remap on upload — that happens at join time only.' },
  { id: 'school_year',                      type: 'text',    isKey: true,  description: '"YYYY-YY" school year. Composite key with DBN.' },
  // ---- program flags ------------------------------------------------------
  { id: 'core_school',                      type: 'boolean', isKey: false, description: 'Anchor school flag (Q1 default).' },
  { id: 'arts_program',                     type: 'boolean', isKey: false, description: 'Healing Arts flag (Q1 default).' },
  { id: 'social_work_program',              type: 'boolean', isKey: false, description: 'PWC social-work program active in this year.' },
  { id: 'community_school_program',         type: 'boolean', isKey: false, description: 'PWC community school program active.' },
  { id: 'community_school_program_status',  type: 'text',    isKey: false, description: 'Status of the community school program (free text).' },
  { id: 'arts_program_type',                type: 'text',    isKey: false, description: 'Healing Arts program type.' },
  { id: 'ost_program',                      type: 'boolean', isKey: false, description: 'Out-of-school-time program active.' },
  { id: 'ost_program_type',                 type: 'text',    isKey: false, description: 'OST program type.' },
  { id: 'food_pantry',                      type: 'boolean', isKey: false, description: 'Food pantry on site.' },
  { id: 'laundry',                          type: 'boolean', isKey: false, description: 'Laundry program on site.' },
  // ---- groupings ----------------------------------------------------------
  { id: 'cohort',                           type: 'text',    isKey: false, description: 'PWC geographic cohort (Brownsville, Morrisania, East Harlem, Fort Greene, …).' },
  { id: 'level',                            type: 'text',    isKey: false, description: 'School level (Elementary/Middle/HS/etc.).' },
  { id: 'grade_served',                     type: 'text',    isKey: false, description: 'Grades served, free text.' },
  { id: 'governance_school_type',           type: 'text',    isKey: false, description: 'DOE/Charter/D75 governance type. Distinct from the dashboard "School Type" filter.', aliases: ['school_type'] },
  { id: 'year_partnership_began',           type: 'integer', isKey: false, description: 'First year of PWC partnership.' },
  // ---- social-work counts -------------------------------------------------
  { id: 'sw_caseload_students',             type: 'integer', isKey: false, description: 'Social-work caseload count.' },
  { id: 'students_individual_contacts',     type: 'integer', isKey: false, description: 'Students reached via individual contacts.' },
  { id: 'number_individual_contacts',       type: 'integer', isKey: false, description: 'Total individual-contact events.' },
  { id: 'students_group_contacts',          type: 'integer', isKey: false, description: 'Students reached via group contacts.' },
  { id: 'number_group_contacts',            type: 'integer', isKey: false, description: 'Total group-contact events.' },
  { id: 'total_students_served_sw',         type: 'integer', isKey: false, description: 'Total students served by social work.' },
  { id: 'total_contacts_sw',                type: 'integer', isKey: false, description: 'Total social-work contacts.' },
  { id: 'school_enrollment_pwc',            type: 'integer', isKey: false, description: 'School enrollment as recorded by PWC.' },
];

export const PWC_KEY_FIELDS = PWC_FIELDS.filter((f) => f.isKey).map((f) => f.id) as readonly string[];
export const PWC_DATA_FIELDS = PWC_FIELDS.filter((f) => !f.isKey).map((f) => f.id) as readonly string[];
export const PWC_FIELD_IDS = PWC_FIELDS.map((f) => f.id) as readonly string[];

export function getPwcField(id: string): PwcField | undefined {
  return PWC_FIELDS.find((f) => f.id === id);
}
