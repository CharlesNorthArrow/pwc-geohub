/**
 * Stored school-master source extracts (`school_master_sources`). Reads are
 * used to rebuild the master on every update; writes happen only inside the
 * master apply (so a cancelled preview never changes what's stored) and in
 * the one-time seed (scripts/etl/44-init-school-master-sources.ts).
 */

import type { SourceKind, SourceRecord, SourceExtract } from '../admin/schoolMaster/types';

/** Anything with pg's `query(text, params)` — the API pool or the ETL pool. */
interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

interface Row {
  slot: string;
  kind: SourceKind;
  filename: string;
  row_count: number;
  summary: string;
  uploaded_at: Date | string;
  uploaded_by: string;
  extract?: SourceExtract;
}

const toRecord = (r: Row): SourceRecord => ({
  slot: r.slot,
  kind: r.kind,
  filename: r.filename,
  rowCount: r.row_count,
  summary: r.summary,
  uploadedAt: new Date(r.uploaded_at).toISOString(),
  uploadedBy: r.uploaded_by,
  extract: r.extract as SourceExtract,
});

const isMissingTable = (err: unknown): boolean => (err as { code?: string }).code === '42P01';

/** Every stored source WITH its extract — the input to a rebuild. */
export async function getSources(db: Queryable): Promise<SourceRecord[]> {
  try {
    const r = await db.query(`SELECT * FROM school_master_sources ORDER BY slot`);
    return (r.rows as Row[]).map(toRecord);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Stored sources WITHOUT extracts — for the admin checklist. */
export async function listSources(db: Queryable): Promise<Array<Omit<SourceRecord, 'extract'>>> {
  try {
    const r = await db.query(
      `SELECT slot, kind, filename, row_count, summary, uploaded_at, uploaded_by
         FROM school_master_sources ORDER BY slot`,
    );
    return (r.rows as Row[]).map((row) => {
      const { extract: _omit, ...rest } = toRecord(row);
      return rest;
    });
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Upsert extracts by slot (one statement per source — extracts are large). */
export async function saveSources(db: Queryable, records: readonly SourceRecord[], by: string): Promise<void> {
  for (const s of records) {
    await db.query(
      `INSERT INTO school_master_sources (slot, kind, filename, row_count, summary, uploaded_at, uploaded_by, extract)
       VALUES ($1, $2, $3, $4, $5, now(), $6, $7::jsonb)
       ON CONFLICT (slot) DO UPDATE SET
         kind = EXCLUDED.kind, filename = EXCLUDED.filename, row_count = EXCLUDED.row_count,
         summary = EXCLUDED.summary, uploaded_at = EXCLUDED.uploaded_at,
         uploaded_by = EXCLUDED.uploaded_by, extract = EXCLUDED.extract`,
      [s.slot, s.kind, s.filename, s.rowCount, s.summary, by, JSON.stringify(s.extract)],
    );
  }
}
