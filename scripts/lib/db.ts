import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { Pool } from '@neondatabase/serverless';

/**
 * Neon access for ETL scripts.
 *
 * We route everything through the WebSocket-based `Pool` rather than the
 * HTTP `neon()` driver. The HTTP endpoint is blocked from this network, but
 * the WebSocket proxy (used by Pool) goes through fine.
 *
 * `db()` returns a tagged-template `sql` function (same ergonomics as the
 * HTTP driver), backed by `pool.query()`. ETL scripts use it as
 * `await sql\`SELECT ... WHERE x = ${val}\`` and get rows back.
 */

// Match Vercel/Next.js convention: `.env.local` overrides `.env`. Vercel CLI
// writes pulled vars to `.env.local`, so that file MUST take precedence.
for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnv({ path: file, override: false });
}

export type SqlFn = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...params: unknown[]
) => Promise<T[]>;

let cachedSql: SqlFn | null = null;
let cachedPool: Pool | null = null;

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Run `vercel env pull .env.local` after ' +
        'provisioning the Neon Marketplace integration.',
    );
  }
  return url;
}

export function pool(): Pool {
  if (cachedPool) return cachedPool;
  cachedPool = new Pool({ connectionString: getConnectionString() });
  return cachedPool;
}

/** Tagged-template SQL backed by Pool. Drop-in replacement for neon()'s API. */
export function db(): SqlFn {
  if (cachedSql) return cachedSql;
  const p = pool();
  cachedSql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...params: unknown[]
  ): Promise<T[]> => {
    let text = '';
    for (let i = 0; i < strings.length; i++) {
      text += strings[i];
      if (i < params.length) text += `$${i + 1}`;
    }
    const result = await p.query(text, params as unknown[]);
    return result.rows as T[];
  }) as SqlFn;
  return cachedSql;
}

/** Run a multi-statement SQL script (e.g., schema.sql). */
export async function execScript(sqlText: string): Promise<void> {
  const p = pool();
  const statements = splitSql(sqlText);
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    await p.query(trimmed);
  }
}

/**
 * Multi-row UPSERT helper for bulk loading.
 *
 * One round-trip per chunk instead of one per row — turns a 10-minute load
 * into a 10-second one. Generates parameterized
 * `INSERT INTO t (cols) VALUES (...), (...), ... ON CONFLICT (...) DO UPDATE SET ...`.
 *
 * `valueExpressions` lets a column's $-placeholder be wrapped in a SQL
 * expression — e.g. `geom` from `ST_SetSRID(ST_MakePoint($1, $2), 4326)`.
 * Each entry maps a column name to a function that takes a starting param
 * index and returns the SQL expression + how many params it consumed.
 */
export interface BulkUpsertOptions {
  table: string;
  columns: string[];
  rows: unknown[][];
  conflictKeys: string[];
  /** Columns to update on conflict. Defaults to all columns not in conflictKeys. */
  updateColumns?: string[];
  /** Optional per-column SQL expression overrides (e.g., PostGIS functions). */
  valueExpressions?: Record<string, (paramIndex: number) => { expr: string; consumes: number }>;
  /** Rows per round-trip. Default 100. */
  chunkSize?: number;
}

export async function bulkUpsert(opts: BulkUpsertOptions): Promise<number> {
  const p = pool();
  const chunkSize = opts.chunkSize ?? 100;
  const updateCols =
    opts.updateColumns ??
    opts.columns.filter((c) => !opts.conflictKeys.includes(c));
  const setClause =
    updateCols.length > 0
      ? `DO UPDATE SET ${updateCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`
      : 'DO NOTHING';

  let written = 0;
  for (let i = 0; i < opts.rows.length; i += chunkSize) {
    const chunk = opts.rows.slice(i, i + chunkSize);
    const rowSql: string[] = [];
    const params: unknown[] = [];
    let nextParam = 1;
    for (const row of chunk) {
      const cellSql: string[] = [];
      for (let c = 0; c < opts.columns.length; c++) {
        const col = opts.columns[c]!;
        const expr = opts.valueExpressions?.[col];
        if (expr) {
          const { expr: sql, consumes } = expr(nextParam);
          cellSql.push(sql);
          // The wrapper consumes `consumes` values from `row`; push them all.
          for (let k = 0; k < consumes; k++) params.push(row[c + k]);
          nextParam += consumes;
          c += consumes - 1; // advance past consumed input columns
        } else {
          cellSql.push(`$${nextParam}`);
          params.push(row[c]);
          nextParam += 1;
        }
      }
      rowSql.push(`(${cellSql.join(', ')})`);
    }
    const text =
      `INSERT INTO ${opts.table} (${opts.columns.join(', ')}) VALUES ${rowSql.join(', ')} ` +
      `ON CONFLICT (${opts.conflictKeys.join(', ')}) ${setClause}`;
    await p.query(text, params);
    written += chunk.length;
  }
  return written;
}

/**
 * Split a SQL script on `;` while respecting:
 *   - single-quoted strings (with escaped '')
 *   - line comments (-- ... \n)
 *   - block comments (/* ... *​/)
 *   - dollar-quoted strings ($tag$ ... $tag$)
 *
 * Good enough for DDL files we own; not a full parser.
 */
function splitSql(input: string): string[] {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  const n = input.length;

  type State =
    | { kind: 'normal' }
    | { kind: 'line_comment' }
    | { kind: 'block_comment' }
    | { kind: 'single_quote' }
    | { kind: 'dollar'; tag: string };

  let state: State = { kind: 'normal' };

  while (i < n) {
    const ch = input[i]!;
    const next = i + 1 < n ? input[i + 1]! : '';

    switch (state.kind) {
      case 'normal': {
        if (ch === '-' && next === '-') {
          state = { kind: 'line_comment' };
          buf += ch;
          i++;
          continue;
        }
        if (ch === '/' && next === '*') {
          state = { kind: 'block_comment' };
          buf += ch;
          i++;
          continue;
        }
        if (ch === "'") {
          state = { kind: 'single_quote' };
          buf += ch;
          i++;
          continue;
        }
        if (ch === '$') {
          const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(input.slice(i));
          if (m) {
            const tag = m[0];
            state = { kind: 'dollar', tag };
            buf += tag;
            i += tag.length;
            continue;
          }
        }
        if (ch === ';') {
          out.push(buf);
          buf = '';
          i++;
          continue;
        }
        buf += ch;
        i++;
        continue;
      }
      case 'line_comment': {
        buf += ch;
        if (ch === '\n') state = { kind: 'normal' };
        i++;
        continue;
      }
      case 'block_comment': {
        buf += ch;
        if (ch === '*' && next === '/') {
          buf += next;
          i += 2;
          state = { kind: 'normal' };
          continue;
        }
        i++;
        continue;
      }
      case 'single_quote': {
        buf += ch;
        if (ch === "'" && next === "'") {
          buf += next;
          i += 2;
          continue;
        }
        if (ch === "'") state = { kind: 'normal' };
        i++;
        continue;
      }
      case 'dollar': {
        const rest = input.slice(i);
        if (rest.startsWith(state.tag)) {
          buf += state.tag;
          i += state.tag.length;
          state = { kind: 'normal' };
          continue;
        }
        buf += ch;
        i++;
        continue;
      }
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/** Single timestamp string used to tag a Phase-0 ETL run end-to-end. */
export function runId(): string {
  return process.env.ETL_RUN_ID ?? new Date().toISOString();
}
