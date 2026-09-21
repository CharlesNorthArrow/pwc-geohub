/**
 * School-master source workflow, in two explicit steps:
 *
 *  1. storeSourceFiles — the admin uploads the file(s) for ONE source card.
 *     Each file is recognized, checked to really be that source, parsed and
 *     stored in `school_master_sources`. The live master does not change.
 *  2. buildFromStored — "Rebuild master" builds from every stored source;
 *     the result goes through the regular preview → apply routes.
 */

import { parseMasterSourceFile } from '../admin/schoolMaster/parseSources';
import { buildMaster, coverageNotes, type MasterBuildResult } from '../admin/schoolMaster/build';
import type { SourceKind, SourceRecord } from '../admin/schoolMaster/types';
import type { RawFile, TransformIssue } from '../admin/rawTransforms/types';
import { getSources, saveSources } from './schoolMasterSourcesDb';
import { pool } from './db';

/** Source cards in the admin panel → the source kinds each accepts. */
export const CARD_KINDS: Record<string, { label: string; kinds: readonly SourceKind[] }> = {
  snapshot: { label: 'Demographic Snapshot', kinds: ['snapshot'] },
  directory: { label: 'Directory Data', kinds: ['directory'] },
  lcgms: { label: 'LCGMS school data', kinds: ['lcgms_geo', 'lcgms_beds'] },
  community_schools: { label: 'Community Schools list', kinds: ['community_schools'] },
};

const KIND_LABEL: Record<SourceKind, string> = {
  snapshot: 'the Demographic Snapshot',
  directory: 'a Directory Data file',
  lcgms_geo: 'the LCGMS geocoded CSV',
  lcgms_beds: 'the LCGMS School Data export',
  community_schools: 'the Community Schools list',
};

export interface StoredFileResult {
  file: string;
  slot: string | null;
  summary: string | null;
  /** Filename of the stored source this file replaced (null = new slot). */
  replaced: string | null;
}

export type StoreResult =
  | { ok: false; issues: TransformIssue[]; warnings: TransformIssue[]; files: StoredFileResult[] }
  | { ok: true; warnings: TransformIssue[]; files: StoredFileResult[] };

/** A replacement this much smaller than what's stored is worth a second look. */
const SHRINK_WARN = 0.8;

export async function storeSourceFiles(files: readonly RawFile[], card: string, by: string): Promise<StoreResult> {
  const accepts = CARD_KINDS[card];
  if (!accepts) throw new Error(`unknown source card: ${card}`);
  const stored = await getSources(pool());
  const storedBySlot = new Map(stored.map((s) => [s.slot, s]));
  const issues: TransformIssue[] = [];
  const warnings: TransformIssue[] = [];
  const results: StoredFileResult[] = [];
  const staged = new Map<string, SourceRecord>();

  for (const f of files) {
    const parsed = await parseMasterSourceFile(f);
    let rec = parsed.record;
    issues.push(...parsed.errors);
    warnings.push(...parsed.warnings);
    if (rec && !accepts.kinds.includes(rec.kind)) {
      issues.push({
        code: 'wrong_source',
        file: f.name,
        message: `This looks like ${KIND_LABEL[rec.kind]}, not ${accepts.label}. Upload it on its own card.`,
      });
      rec = null;
    }
    if (rec && staged.has(rec.slot)) {
      issues.push({
        code: 'duplicate_source',
        file: f.name,
        message: `"${f.name}" and "${staged.get(rec.slot)!.filename}" are the same file (${rec.summary}). Upload only one of them.`,
      });
      rec = null;
    }
    results.push({
      file: f.name,
      slot: rec?.slot ?? null,
      summary: rec?.summary ?? null,
      replaced: rec ? (storedBySlot.get(rec.slot)?.filename ?? null) : null,
    });
    if (!rec) continue;
    staged.set(rec.slot, rec);
    const prev = storedBySlot.get(rec.slot);
    if (prev && rec.rowCount < prev.rowCount * SHRINK_WARN) {
      warnings.push({
        code: 'source_shrank',
        file: f.name,
        message: `Much smaller than the file it replaces: ${rec.rowCount.toLocaleString('en-US')} vs ${prev.rowCount.toLocaleString('en-US')} rows (${prev.filename}).`,
      });
    }
  }
  if (issues.length > 0) return { ok: false, issues, warnings, files: results };
  await saveSources(pool(), [...staged.values()], by);
  return { ok: true, warnings, files: results };
}

export type RebuildResult =
  | { ok: false; issues: TransformIssue[] }
  | { ok: true; build: MasterBuildResult; notes: string[]; sourceFiles: string[] };

export async function buildFromStored(): Promise<RebuildResult> {
  const stored = await getSources(pool());
  const build = buildMaster(stored);
  if (build.errors.length > 0) return { ok: false, issues: build.errors };
  return { ok: true, build, notes: coverageNotes(build.coverage!), sourceFiles: stored.map((s) => s.filename) };
}
