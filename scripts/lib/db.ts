import 'dotenv/config';
import {
  neon,
  neonConfig,
  Pool,
  type NeonQueryFunction,
} from '@neondatabase/serverless';

/**
 * Two Neon entry points:
 *   - `db()` returns the HTTP tagged-template function for ergonomic
 *     parameterized queries in ETL scripts (`sql\`...\``).
 *   - `pool()` returns a node-pg-compatible Pool used by `execScript()` to
 *     run multi-statement DDL files (schema.sql).
 */

neonConfig.fetchConnectionCache = true;

let cachedSql: NeonQueryFunction<false, false> | null = null;
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

export function db(): NeonQueryFunction<false, false> {
  if (cachedSql) return cachedSql;
  cachedSql = neon(getConnectionString());
  return cachedSql;
}

export function pool(): Pool {
  if (cachedPool) return cachedPool;
  cachedPool = new Pool({ connectionString: getConnectionString() });
  return cachedPool;
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
