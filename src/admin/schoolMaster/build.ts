/**
 * Build the school master from the stored source extracts. Pure — the
 * caller supplies every current extract (stored ones overridden by any just
 * uploaded). Output rows are canonical MASTER_FIELDS-shaped CSV cells, fed
 * into the existing preview → apply pipeline (which applies the DBN remap,
 * the merge and the data-quality checks).
 *
 * Rules:
 *  1. The Demographic Snapshot is the spine: one row per (DBN, school_year).
 *  2. Directory data only ADDS real schools (numeric school code — pre-K
 *     centers like 01MATK are left out) that the snapshot is missing for the
 *     same year. Fall Y ⇒ school year Y-(Y+1). Files are read ES → MS → HS;
 *     the first occurrence of a DBN wins. A fall year the snapshot doesn't
 *     cover yet is stored but unused (no demographics to pair it with).
 *  3. LCGMS geocoded CSV (by DBN): borough, address, location category/type,
 *     managed by, grades (falling back to the directory gradespan),
 *     coordinates. Borough falls back to the DBN's borough letter.
 *  4. LCGMS School Data export (by DBN): 12-digit BEDS number.
 *  5. community_school = 1 when the BEDS number is on the NYSED Community
 *     Schools list, else 0.
 */

import { MASTER_FIELDS } from '../schoolMasterSchema';
import type { CanonicalRow, TransformIssue } from '../rawTransforms/types';
import { isRealSchoolDbn } from './parseSources';
import {
  LCGMS_GEO_FIELDS,
  LEVEL_LABEL,
  type CommunitySchoolsExtract,
  type DirectoryExtract,
  type DirectoryLevel,
  type LcgmsBedsExtract,
  type LcgmsGeoExtract,
  type SnapshotExtract,
  type SourceKind,
  type SourceRecord,
  type SourceValue,
} from './types';

export interface MasterCoverage {
  snapshotYears: string[];
  /** School years whose directory files were used. */
  directoryYearsUsed: string[];
  /** Fall years stored but waiting for the snapshot to cover them. */
  directoryYearsWaiting: string[];
  /** School year → schools added from directory data. */
  directoryAdded: Record<string, number>;
  lcgmsExportDate: string | null;
  communityListYear: string | null;
  rowCount: number;
  withBeds: number;
  communitySchoolDbns: number;
  missingCoordinates: number;
}

export interface MasterBuildResult {
  rows: CanonicalRow[];
  errors: TransformIssue[];
  warnings: TransformIssue[];
  coverage: MasterCoverage | null;
}

const REQUIRED: ReadonlyArray<[SourceKind, string]> = [
  ['snapshot', 'Demographic Snapshot'],
  ['lcgms_geo', 'LCGMS geocoded school data (CSV)'],
  ['lcgms_beds', 'LCGMS School Data export (.xls)'],
  ['community_schools', 'NYSED Community Schools list (PDF)'],
];

const BOROUGHS: Record<string, string> = { M: 'Manhattan', X: 'Bronx', K: 'Brooklyn', Q: 'Queens', R: 'Staten Island' };
const LEVEL_ORDER: readonly DirectoryLevel[] = ['es', 'ms', 'hs'];

const schoolYearOfFall = (fall: number): string => `${fall}-${String((fall + 1) % 100).padStart(2, '0')}`;

const cell = (v: SourceValue | undefined): string => (v == null ? '' : String(v));

export function buildMaster(sources: readonly SourceRecord[]): MasterBuildResult {
  const errors: TransformIssue[] = [];
  const warnings: TransformIssue[] = [];
  const byKind = <T>(kind: SourceKind): T[] => sources.filter((s) => s.kind === kind).map((s) => s.extract as T);

  for (const [kind, label] of REQUIRED) {
    if (byKind(kind).length === 0) {
      errors.push({ code: 'source_missing', message: `No ${label} has been uploaded yet — it is required to build the master.` });
    }
  }
  if (errors.length > 0) return { rows: [], errors, warnings, coverage: null };

  const snapshot = byKind<SnapshotExtract>('snapshot')[0]!;
  const geo = byKind<LcgmsGeoExtract>('lcgms_geo')[0]!;
  const bedsSrc = byKind<LcgmsBedsExtract>('lcgms_beds')[0]!;
  const cs = byKind<CommunitySchoolsExtract>('community_schools')[0]!;

  // 1. Snapshot spine.
  type Row = Record<string, SourceValue>;
  const rows: Row[] = snapshot.rows.map((r) => Object.fromEntries(snapshot.columns.map((c, i) => [c, r[i] ?? null])));
  const snapshotYears = new Set(rows.map((r) => String(r.school_year)));
  const existing = new Set(rows.map((r) => `${r.school_year}|${r.DBN}`));

  // 2. Directory union.
  const directoryAdded: Record<string, number> = {};
  const used: string[] = [];
  const waiting: string[] = [];
  const byFall = new Map<number, DirectoryExtract[]>();
  for (const d of byKind<DirectoryExtract>('directory')) {
    if (!byFall.has(d.fallYear)) byFall.set(d.fallYear, []);
    byFall.get(d.fallYear)!.push(d);
  }
  for (const fall of [...byFall.keys()].sort()) {
    const sy = schoolYearOfFall(fall);
    const files = byFall.get(fall)!;
    if (!snapshotYears.has(sy)) {
      waiting.push(String(fall));
      continue;
    }
    used.push(sy);
    const missing = LEVEL_ORDER.filter((l) => !files.some((f) => f.level === l));
    if (missing.length > 0) {
      warnings.push({
        code: 'directory_level_missing',
        message: `Fall ${fall}: no ${missing.map((l) => LEVEL_LABEL[l]).join(' / ')} directory file — schools only listed there won't be added for ${sy}.`,
      });
    }
    const seen = new Map<string, [string | null, string | null]>();
    for (const level of LEVEL_ORDER) {
      for (const f of files.filter((x) => x.level === level)) {
        for (const [dbn, name, grades] of f.schools) {
          if (!isRealSchoolDbn(dbn) || seen.has(dbn)) continue;
          seen.set(dbn, [name, grades]);
        }
      }
    }
    let added = 0;
    for (const [dbn, [name, grades]] of seen) {
      if (existing.has(`${sy}|${dbn}`)) continue;
      rows.push({ DBN: dbn, school_year: sy, school_name: name, grades });
      added++;
    }
    directoryAdded[sy] = added;
  }

  // 3–5. LCGMS + Community Schools joins.
  const geoByDbn = new Map(geo.schools.map((s) => [String(s[0]), s]));
  const bedsByDbn = new Map(bedsSrc.beds);
  const codes = new Set(cs.codes);
  const out: CanonicalRow[] = [];
  let withBeds = 0;
  let missingCoordinates = 0;
  const communityDbns = new Set<string>();
  for (const r of rows) {
    const dbn = String(r.DBN);
    const g = geoByDbn.get(dbn);
    const geoField = (f: (typeof LCGMS_GEO_FIELDS)[number]): SourceValue =>
      g ? (g[1 + LCGMS_GEO_FIELDS.indexOf(f)] ?? null) : null;
    const beds = bedsByDbn.get(dbn) ?? null;
    const isCommunity = beds != null && codes.has(beds);
    if (beds) withBeds++;
    if (isCommunity) communityDbns.add(dbn);
    const merged: Row = {
      ...r,
      borough: geoField('borough') ?? BOROUGHS[dbn[2]?.toUpperCase() ?? ''] ?? null,
      address: geoField('address'),
      location_category: geoField('location_category'),
      managed_by: geoField('managed_by'),
      location_type: geoField('location_type'),
      grades: geoField('grades') ?? r.grades ?? null,
      latitude: geoField('latitude'),
      longitude: geoField('longitude'),
      beds_number: beds,
      community_school: isCommunity ? '1' : '0',
    };
    if (merged.latitude == null || merged.longitude == null) missingCoordinates++;
    out.push(Object.fromEntries(MASTER_FIELDS.map((f) => [f.id, cell(merged[f.id])])));
  }

  return {
    rows: out,
    errors,
    warnings,
    coverage: {
      snapshotYears: [...snapshotYears].sort(),
      directoryYearsUsed: used,
      directoryYearsWaiting: waiting,
      directoryAdded,
      lcgmsExportDate: bedsSrc.exportDate,
      communityListYear: cs.listYear,
      rowCount: out.length,
      withBeds,
      communitySchoolDbns: communityDbns.size,
      missingCoordinates,
    },
  };
}
