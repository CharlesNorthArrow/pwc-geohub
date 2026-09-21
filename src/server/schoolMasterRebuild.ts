/**
 * Stage a school-master rebuild from uploaded raw source files: parse each
 * file, lay the new extracts over the stored ones, build the master, and
 * report per-file results. Nothing is written — the extracts are only saved
 * when the resulting version is applied.
 */

import { parseMasterSourceFile } from '../admin/schoolMaster/parseSources';
import { buildMaster, coverageNotes, type MasterBuildResult } from '../admin/schoolMaster/build';
import type { SourceRecord } from '../admin/schoolMaster/types';
import type { RawFile, TransformIssue } from '../admin/rawTransforms/types';
import { getSources } from './schoolMasterSourcesDb';
import { pool } from './db';

export interface StagedFile {
  file: string;
  slot: string | null;
  summary: string | null;
  /** Filename of the stored source this file replaces (null = new slot). */
  replaces: string | null;
}

export type StageResult =
  | { ok: false; issues: TransformIssue[]; warnings: TransformIssue[]; files: StagedFile[] }
  | {
      ok: true;
      files: StagedFile[];
      staged: SourceRecord[];
      build: MasterBuildResult;
      warnings: TransformIssue[];
      notes: string[];
    };

/** A replacement this much smaller than what's stored is worth a second look. */
const SHRINK_WARN = 0.8;

export async function stageMasterRebuild(files: readonly RawFile[]): Promise<StageResult> {
  const stored = await getSources(pool());
  const storedBySlot = new Map(stored.map((s) => [s.slot, s]));
  const issues: TransformIssue[] = [];
  const warnings: TransformIssue[] = [];
  const out: StagedFile[] = [];
  const staged = new Map<string, SourceRecord>();

  for (const f of files) {
    const parsed = await parseMasterSourceFile(f);
    issues.push(...parsed.errors);
    warnings.push(...parsed.warnings);
    const rec = parsed.record;
    out.push({
      file: f.name,
      slot: rec?.slot ?? null,
      summary: rec?.summary ?? null,
      replaces: rec ? (storedBySlot.get(rec.slot)?.filename ?? null) : null,
    });
    if (!rec) continue;
    const dup = staged.get(rec.slot);
    if (dup) {
      issues.push({
        code: 'duplicate_source',
        file: f.name,
        message: `"${f.name}" and "${dup.filename}" are the same source (${rec.summary}). Upload only one of them.`,
      });
      continue;
    }
    staged.set(rec.slot, rec);
    const prev = storedBySlot.get(rec.slot);
    if (prev && rec.rowCount < prev.rowCount * SHRINK_WARN) {
      warnings.push({
        code: 'source_shrank',
        file: f.name,
        message: `Much smaller than the stored file it replaces: ${rec.rowCount.toLocaleString('en-US')} vs ${prev.rowCount.toLocaleString('en-US')} rows (${prev.filename}).`,
      });
    }
  }
  if (issues.length > 0) return { ok: false, issues, warnings, files: out };

  const combined = [...stored.filter((s) => !staged.has(s.slot)), ...staged.values()];
  const build = buildMaster(combined);
  if (build.errors.length > 0) return { ok: false, issues: build.errors, warnings, files: out };
  return {
    ok: true,
    files: out,
    staged: [...staged.values()],
    build,
    warnings: [...warnings, ...build.warnings],
    notes: coverageNotes(build.coverage!),
  };
}
