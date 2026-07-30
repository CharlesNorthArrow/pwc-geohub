/**
 * ETL 11 — load all hosted school indicator CSVs → `school_indicator_values`.
 *
 * Generic over the dataset configs (src/admin/indicatorDatasets.ts): for each
 * of the 11 hosted datasets we read the CSV once, coerce it into version-row
 * shape, and derive the long-format rows for EVERY indicator the dataset
 * powers (q120 + q119 share teacher_survey.csv with no code change).
 *
 * The row transform lives in src/admin/indicatorTransform.ts and is shared
 * with the Admin Panel upload path, so an admin apply and this loader write
 * byte-identical values.
 *
 * Foreign key note: rows whose DBN is not in `schools` are skipped and logged
 * to `unmatched_dbn` findings. That is how `03M299` surfaces (closed school —
 * spec §3.6, §12 Q2 default = exclude).
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, bulkUpsert } from '../lib/db.js';
import { readCsv } from '../lib/csv.js';
import { wasDbnRemapped } from '../../src/lib/dbn';
import { isSentinelNull } from '../../src/lib/normalize';
import { recordFinding } from '../lib/findings.js';
import { INDICATOR_DATASETS, hostedSourceOf } from '../../src/admin/indicatorDatasets';
import { indicatorCsvToVersionRows, deriveIndicatorValues } from '../../src/admin/indicatorTransform';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', '..', 'data');

async function loadValidDbns(): Promise<Set<string>> {
  const sql = db();
  const rows = (await sql`SELECT dbn FROM schools`) as Array<{ dbn: string }>;
  return new Set(rows.map((r) => r.dbn));
}

async function main(): Promise<void> {
  const validDbns = await loadValidDbns();
  console.log(`[etl:indicators] ${validDbns.size} schools in DB; loading hosted datasets`);

  for (const cfg of INDICATOR_DATASETS) {
    const path = resolve(DATA_DIR, cfg.csvFile);
    console.log(`[etl:indicators] ${cfg.id} ← ${cfg.csvFile} (${cfg.indicatorIds.join(', ')})`);
    const rawRows = (await readCsv(path)) as Array<Record<string, string>>;

    // Remap findings — per indicator per remapped source row, matching the
    // original loader's grain so the DQ report stays comparable.
    for (const raw of rawRows) {
      if (!wasDbnRemapped(raw.DBN)) continue;
      for (const indicatorId of cfg.indicatorIds) {
        await recordFinding('remap_applied', `${indicatorId}:${raw.DBN ?? ''}`, {
          target: '84X208',
        });
      }
    }

    const { rows } = indicatorCsvToVersionRows(rawRows, cfg);
    const derived = deriveIndicatorValues(rows, cfg);

    for (const indicatorId of cfg.indicatorIds) {
      const source = hostedSourceOf(indicatorId);
      const mine = derived.filter((d) => d.indicator_id === indicatorId);
      const known = mine.filter((d) => validDbns.has(d.dbn));
      const unmatched = new Set(mine.filter((d) => !validDbns.has(d.dbn)).map((d) => d.dbn));

      let sentinelNulled = 0;
      for (const raw of rawRows) {
        const v = raw[source.value_field];
        if (v != null && v !== '' && isSentinelNull(v)) sentinelNulled++;
      }

      const yearCoverage: Record<string, number> = {};
      for (const d of known) {
        yearCoverage[d.school_year] = (yearCoverage[d.school_year] ?? 0) + 1;
      }

      const inserted = await bulkUpsert({
        table: 'school_indicator_values',
        columns: ['dbn', 'school_year', 'indicator_id', 'value_num', 'value_text', 'label', 'source_year'],
        rows: known.map((d) => [d.dbn, d.school_year, d.indicator_id, d.value_num, d.value_text, d.label, d.source_year]),
        conflictKeys: ['dbn', 'school_year', 'indicator_id'],
      });

      await recordFinding('indicator_loaded', indicatorId, {
        rows_seen: rawRows.length,
        rows_inserted: inserted,
        rows_sentinel_nulled: sentinelNulled,
        rows_unmatched_dbn: mine.length - known.length,
      });
      await recordFinding('year_coverage', indicatorId, { years: yearCoverage });
      if (sentinelNulled > 0) {
        await recordFinding('sentinel_nulled', indicatorId, {
          count: sentinelNulled,
          sentinels: ['R', 'Above 95%', 'Data not available', 'Data suppressed', 's', 'N/A'],
        });
      }
      for (const dbn of unmatched) {
        await recordFinding('unmatched_dbn', `${indicatorId}:${dbn}`, { dbn, indicator_id: indicatorId });
      }
    }
  }

  // §10 Phase 0 acceptance test marker — q119 was added via registry only.
  await recordFinding('registry_only_add', 'teacher_q119_disruptive_sel', {
    note: 'Added via registry; no ETL code change needed. Demonstrates spec §11.2.',
  });

  console.log('[etl:indicators] done.');
}

main().catch((err) => {
  console.error('[etl:indicators] failed:', err);
  process.exit(1);
});
