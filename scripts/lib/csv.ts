/**
 * CSV reader helper for ETL.
 *
 * - Uses csv-parse in streaming mode (memory-stable on the 9k-row master).
 * - Returns objects keyed by header, every value a string (caller decides
 *   how to coerce — see `normalize.ts`). This is what preserves the leading
 *   zeros on DBN columns.
 */

import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';

export type CsvRow = Record<string, string>;

export async function readCsv(path: string): Promise<CsvRow[]> {
  const rows: CsvRow[] = [];
  const parser = createReadStream(path).pipe(
    parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      cast: false,
    }),
  );
  for await (const record of parser) {
    rows.push(record as CsvRow);
  }
  return rows;
}

/** Streaming variant — yields rows one at a time for very large files. */
export async function* streamCsv(path: string): AsyncIterable<CsvRow> {
  const parser = createReadStream(path).pipe(
    parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      cast: false,
    }),
  );
  for await (const record of parser) {
    yield record as CsvRow;
  }
}
