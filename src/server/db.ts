/**
 * Neon connection for Next.js API routes.
 *
 * Mirrors `scripts/lib/db.ts` but tailored for the Next runtime:
 *  - No dotenv load (Next reads `.env.local` automatically).
 *  - Single shared `Pool`; reuse across function invocations on the same
 *    Fluid Compute instance.
 *
 * We use the WebSocket-backed `Pool` rather than the HTTP `neon()` driver
 * because the HTTP endpoint is blocked behind the developer's TLS proxy
 * (the same constraint that drove the ETL choice).
 */

import { Pool } from '@neondatabase/serverless';

let cachedPool: Pool | null = null;

export function pool(): Pool {
  if (cachedPool) return cachedPool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Run `vercel env pull .env.local`.');
  }
  cachedPool = new Pool({ connectionString: url });
  return cachedPool;
}

/** Tagged-template SQL helper — same ergonomics as the ETL `db()`. */
export async function sql<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...params: unknown[]
): Promise<T[]> {
  let text = '';
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < params.length) text += `$${i + 1}`;
  }
  const result = await pool().query(text, params);
  return result.rows as T[];
}
