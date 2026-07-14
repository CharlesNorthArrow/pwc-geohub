/**
 * Shared shape for Admin Panel dataset schemas.
 *
 * Each uploadable dataset (pwc_schools, schools_master, …) declares its
 * canonical column list as `AdminField[]`. Column reconciliation, merge, and
 * the upload routes are all parameterized by that list — one implementation,
 * N datasets.
 */

export type AdminFieldType = 'text' | 'integer' | 'boolean' | 'number';

export interface AdminField {
  /** Column name as it must appear in the live table / CSV. */
  id: string;
  type: AdminFieldType;
  /** True for the composite primary key (DBN, school_year). */
  isKey: boolean;
  /** Plain-English description shown in the "View schema" dialog. */
  description: string;
  /** Optional historical aliases — if the new CSV uses an old header
   *  name (e.g. `school_type` → `governance_school_type`), classification
   *  treats it as an EXACT match rather than asking the admin to map it. */
  aliases?: readonly string[];
}

export function dataFieldsOf(fields: readonly AdminField[]): string[] {
  return fields.filter((f) => !f.isKey).map((f) => f.id);
}

export function keyFieldsOf(fields: readonly AdminField[]): string[] {
  return fields.filter((f) => f.isKey).map((f) => f.id);
}
