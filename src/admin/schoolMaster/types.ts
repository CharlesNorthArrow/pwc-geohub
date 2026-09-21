/**
 * School master sources — the raw DOE / NYSED files the master is built from.
 *
 * Each uploaded file is recognized as one SOURCE SLOT and parsed into a
 * compact extract. The hub stores the latest extract per slot
 * (`school_master_sources`), so an update only needs the file(s) that
 * changed: the master is rebuilt from every stored extract, with the newly
 * uploaded ones taking precedence.
 *
 *   snapshot                    Demographic Snapshot (base: one row per DBN × year)
 *   directory:<fall>:<es|ms|hs> Directory data (adds schools the snapshot misses)
 *   lcgms_geo                   LCGMS geocoded CSV (location, type, coordinates)
 *   lcgms_beds                  LCGMS School Data export (exact BEDS numbers)
 *   community_schools           NYSED Community Schools list (SED codes)
 */

import type { TransformIssue } from '../rawTransforms/types';

export type SourceKind = 'snapshot' | 'directory' | 'lcgms_geo' | 'lcgms_beds' | 'community_schools';
export type DirectoryLevel = 'es' | 'ms' | 'hs';

/** Cell as stored: raw text/number from the source (coerced at merge time). */
export type SourceValue = string | number | null;

export interface SnapshotExtract {
  kind: 'snapshot';
  /** Canonical master columns present in the snapshot, in this order. */
  columns: string[];
  /** One array per row, aligned with `columns` (DBN, school_year first). */
  rows: SourceValue[][];
}

export interface DirectoryExtract {
  kind: 'directory';
  fallYear: number;
  level: DirectoryLevel;
  /** [DBN, cleaned name, gradespan] for DBNs with a valid borough code, file order. */
  schools: Array<[string, string | null, string | null]>;
}

export const LCGMS_GEO_FIELDS = [
  'borough',
  'address',
  'location_category',
  'managed_by',
  'location_type',
  'grades',
  'latitude',
  'longitude',
] as const;

export interface LcgmsGeoExtract {
  kind: 'lcgms_geo';
  /** [DBN, ...LCGMS_GEO_FIELDS] — first row per DBN. */
  schools: SourceValue[][];
}

export interface LcgmsBedsExtract {
  kind: 'lcgms_beds';
  /** "YYYY-MM-DD" from LCGMS_SchoolData_YYYYMMDD_*.xls, when present. */
  exportDate: string | null;
  /** [DBN, 12-digit BEDS or null] — first row per DBN. */
  beds: Array<[string, string | null]>;
}

export interface CommunitySchoolsExtract {
  kind: 'community_schools';
  /** e.g. "2023-24", from the list's title (or its filename). */
  listYear: string | null;
  /** 12-digit SED codes (= BEDS numbers). */
  codes: string[];
}

export type SourceExtract =
  | SnapshotExtract
  | DirectoryExtract
  | LcgmsGeoExtract
  | LcgmsBedsExtract
  | CommunitySchoolsExtract;

export interface SourceRecord {
  slot: string;
  kind: SourceKind;
  filename: string;
  /** Rows / schools / codes in the extract. */
  rowCount: number;
  /** One-line human summary, e.g. "2020-21 → 2024-25 · 9,373 rows". */
  summary: string;
  uploadedAt?: string;
  uploadedBy?: string;
  extract: SourceExtract;
}

/** Result of parsing one uploaded file. */
export interface ParsedFile {
  file: string;
  record: SourceRecord | null;
  errors: TransformIssue[];
  warnings: TransformIssue[];
}

export const directorySlot = (fallYear: number, level: DirectoryLevel): string => `directory:${fallYear}:${level}`;

export const LEVEL_LABEL: Record<DirectoryLevel, string> = {
  es: 'Elementary',
  ms: 'Middle School',
  hs: 'High School',
};
