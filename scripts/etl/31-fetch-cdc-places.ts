/**
 * ETL 31 — fetch the 2 active CDC PLACES community indicators → DB.
 *
 * Datasets:
 *   - measureid='MHLTH'   → adult_mental_health
 *   - measureid='HOUSING' → housing_insecurity
 *
 * The PLACES dataset is tract-keyed nationally; we filter to NY counties in
 * the NYC FIPS set and use `locationname` (11-char tract GEOID) as area_id.
 */

import { bulkUpsert } from '../lib/db.js';
import { fetchCdcPlaces, type CdcPlacesRow } from '../lib/cdc.js';
import { recordFinding } from '../lib/findings.js';
import { activeCdcIndicators, CDC_PLACES_YEAR_DEFAULT } from '../../src/registry/indicators.js';
import type { CdcPlacesSource, IndicatorRegistryEntry } from '../../src/registry/types.js';
import { NYC_COUNTY_FIPS } from '../../src/registry/geographies.js';

function nycOnly(rows: CdcPlacesRow[]): CdcPlacesRow[] {
  return rows.filter((r) => {
    // countyfips is the 5-digit FIPS (state+county). NYC are 36005/047/061/081/085.
    const fips = (r.countyfips ?? '').padStart(5, '0');
    const county = fips.slice(2);
    return county in NYC_COUNTY_FIPS;
  });
}

async function processIndicator(ind: IndicatorRegistryEntry): Promise<void> {
  const src = ind.source as CdcPlacesSource;
  const all = await fetchCdcPlaces({ resource: src.resource, measureId: src.measure_id });
  const rows = nycOnly(all);
  const releaseYear =
    rows.length > 0 ? rows[0]!.year ?? CDC_PLACES_YEAR_DEFAULT : CDC_PLACES_YEAR_DEFAULT;

  console.log(
    `[etl:cdc] ${ind.id}: ${all.length} NY rows → ${rows.length} NYC tract rows (year ${releaseYear})`,
  );

  let nonNull = 0;
  const toInsert: unknown[][] = [];
  for (const r of rows) {
    const geoid = r.locationname?.trim();
    if (!geoid) continue;
    const value = r.data_value != null && r.data_value !== '' ? Number(r.data_value) : null;
    const value_num = value != null && Number.isFinite(value) ? value : null;
    if (value_num != null) nonNull++;
    const label =
      value_num == null ? null : `${value_num.toFixed(1)}% ${r.short_question_text ?? r.measure}`;
    toInsert.push([geoid, 'tract', releaseYear, ind.id, value_num, null, label, r.year]);
  }

  const inserted = await bulkUpsert({
    table: 'community_indicator_values',
    columns: ['area_id', 'geo_layer', 'year', 'indicator_id', 'value_num', 'value_text', 'label', 'source_year'],
    rows: toInsert,
    conflictKeys: ['area_id', 'geo_layer', 'indicator_id', 'year'],
  });

  await recordFinding('indicator_loaded', ind.id, {
    rows_inserted: inserted,
    rows_with_value: nonNull,
    cdc_year: releaseYear,
    measure_id: src.measure_id,
  });
}

async function main(): Promise<void> {
  const indicators = activeCdcIndicators();
  console.log(`[etl:cdc] processing ${indicators.length} CDC PLACES indicators`);
  for (const ind of indicators) {
    await processIndicator(ind);
  }
  console.log('[etl:cdc] done.');
}

main().catch((err) => {
  console.error('[etl:cdc] failed:', err);
  process.exit(1);
});
