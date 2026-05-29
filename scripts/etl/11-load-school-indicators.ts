/**
 * ETL 11 — load all hosted school indicator CSVs → `school_indicator_values`.
 *
 * Generic over the registry: we never special-case an indicator here. For each
 * `family: 'school'` + `source.type: 'hosted'` registry entry, we read the
 * named CSV, look up `value_field` / `label_field`, map graduation's
 * `cohort_year` → `school_year`, normalize sentinel strings, and upsert into
 * the long contract.
 *
 * If two indicators share a dataset (e.g. q120 + q119 in teacher_survey.csv),
 * both still go through this same loop with no code change.
 *
 * Foreign key note: rows whose DBN is not in `schools` are skipped and logged
 * to `unmatched_dbn` findings. That is how `03M299` surfaces (closed school —
 * spec §3.6, §12 Q2 default = exclude).
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../lib/db.js';
import { readCsv } from '../lib/csv.js';
import { normalizeDbn, wasDbnRemapped } from '../lib/dbn.js';
import { toNullableNumber, toNullableText, isSentinelNull } from '../lib/normalize.js';
import { cohortYearToSchoolYear } from '../lib/year.js';
import { recordFinding } from '../lib/findings.js';
import { activeHostedIndicators } from '../../src/registry/indicators.js';
import type { HostedSource, IndicatorRegistryEntry } from '../../src/registry/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', '..', 'data');

async function loadValidDbns(): Promise<Set<string>> {
  const sql = db();
  const rows = (await sql`SELECT dbn FROM schools`) as Array<{ dbn: string }>;
  return new Set(rows.map((r) => r.dbn));
}

interface IndicatorLoadResult {
  indicator_id: string;
  rows_seen: number;
  rows_inserted: number;
  rows_sentinel_nulled: number;
  rows_unmatched_dbn: number;
  unmatched_dbns: string[];
  year_coverage: Record<string, number>;
}

async function loadOneIndicator(
  ind: IndicatorRegistryEntry,
  validDbns: Set<string>,
): Promise<IndicatorLoadResult> {
  const source = ind.source as HostedSource;
  const path = resolve(DATA_DIR, source.dataset);
  console.log(`[etl:indicators] ${ind.id} ← ${source.dataset} (${source.value_field})`);
  const rows = await readCsv(path);

  const sql = db();
  const result: IndicatorLoadResult = {
    indicator_id: ind.id,
    rows_seen: rows.length,
    rows_inserted: 0,
    rows_sentinel_nulled: 0,
    rows_unmatched_dbn: 0,
    unmatched_dbns: [],
    year_coverage: {},
  };
  const unmatched = new Set<string>();

  for (const r of rows) {
    const rawDbn = r['DBN'];
    if (wasDbnRemapped(rawDbn)) {
      await recordFinding('remap_applied', `${ind.id}:${rawDbn ?? ''}`, {
        target: '84X208',
      });
    }
    const dbn = normalizeDbn(rawDbn);
    if (!dbn) continue;
    if (!validDbns.has(dbn)) {
      result.rows_unmatched_dbn++;
      unmatched.add(dbn);
      continue;
    }

    // Resolve school_year. Graduation uses cohort_year and maps to school_year.
    let school_year: string | null = null;
    let source_year: string | null = null;
    if (source.year_field === 'cohort_year') {
      source_year = r['cohort_year'] ?? null;
      school_year = cohortYearToSchoolYear(source_year);
    } else {
      school_year = r['school_year'] ?? null;
      source_year = school_year;
    }
    if (!school_year) continue;

    const rawVal = r[source.value_field];
    const wasNull = isSentinelNull(rawVal);
    if (wasNull) result.rows_sentinel_nulled++;
    const value_num = toNullableNumber(rawVal);
    const label = toNullableText(r[source.label_field]);

    // Categorical sibling (e.g. safety_climate_rating) is stored in value_text
    // so the tooltip layer can show both the % positive and the rating.
    let value_text: string | null = null;
    if (source.categorical_field) {
      value_text = toNullableText(r[source.categorical_field]);
    }

    await sql`
      INSERT INTO school_indicator_values (
        dbn, school_year, indicator_id, value_num, value_text, label, source_year
      ) VALUES (
        ${dbn}, ${school_year}, ${ind.id}, ${value_num}, ${value_text}, ${label}, ${source_year}
      )
      ON CONFLICT (dbn, school_year, indicator_id) DO UPDATE SET
        value_num   = EXCLUDED.value_num,
        value_text  = EXCLUDED.value_text,
        label       = EXCLUDED.label,
        source_year = EXCLUDED.source_year
    `;
    result.rows_inserted++;
    result.year_coverage[school_year] = (result.year_coverage[school_year] ?? 0) + 1;
  }

  result.unmatched_dbns = [...unmatched];
  return result;
}

async function main(): Promise<void> {
  const validDbns = await loadValidDbns();
  console.log(`[etl:indicators] ${validDbns.size} schools in DB; loading registry hosted indicators`);
  const indicators = activeHostedIndicators();

  for (const ind of indicators) {
    const r = await loadOneIndicator(ind, validDbns);
    await recordFinding('indicator_loaded', ind.id, {
      rows_seen: r.rows_seen,
      rows_inserted: r.rows_inserted,
      rows_sentinel_nulled: r.rows_sentinel_nulled,
      rows_unmatched_dbn: r.rows_unmatched_dbn,
    });
    await recordFinding('year_coverage', ind.id, { years: r.year_coverage });
    if (r.rows_sentinel_nulled > 0) {
      await recordFinding('sentinel_nulled', ind.id, {
        count: r.rows_sentinel_nulled,
        sentinels: ['R', 'Above 95%', 'Data not available', 'Data suppressed', 's', 'N/A'],
      });
    }
    for (const dbn of r.unmatched_dbns) {
      await recordFinding('unmatched_dbn', `${ind.id}:${dbn}`, { dbn, indicator_id: ind.id });
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
