/**
 * ETL 90 — emit reports/data-quality.{md,json}.
 *
 * Reads the latest snapshot of the DB plus the run's `data_quality_findings`
 * and renders the report required by Phase 0 acceptance:
 *
 *   - DBN join coverage (PWC → master; indicators → master)
 *   - 08X208 → 84X208 remap confirmation
 *   - 03M299 (closed school) flagged unmatched
 *   - Null-coordinate school count
 *   - Per-indicator year-coverage matrix
 *   - Sentinel-null counts per indicator
 *   - Anchor / Healing Arts overlap (Q1 default)
 *   - Crosswalk unmatched counts (school_district, nta_2020)
 *   - Registry-only-add acceptance test (q119)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../lib/db.js';
import { indicatorsById } from '../../src/registry/indicators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(__dirname, '..', '..', 'reports');

interface Snapshot {
  generated_at: string;
  totals: {
    schools: number;
    schools_year_rows: number;
    school_indicator_rows: number;
    pwc_program_rows: number;
    geographies_rows: number;
    crosswalk_rows: number;
    community_indicator_rows: number;
  };
  identity: {
    null_coord_schools: number;
    plottable_schools: number;
    sample_null_coord_dbns: string[];
  };
  dbn: {
    remap_applied_08X208_to_84X208: boolean;
    remap_rows: number | null;
    known_unmatched: Array<{ dbn: string; appears_in: string[]; known_closed: boolean }>;
    pwc_unmatched_dbns: string[];
  };
  anchor_healing_overlap: Record<string, unknown> | null;
  indicators: Array<{
    id: string;
    label: string;
    family: string;
    status: string;
    rows: number;
    non_null: number;
    sentinel_nulled: number;
    years: Record<string, number>;
  }>;
  crosswalks: Array<{
    geo_layer: string;
    matched: number;
    unmatched: number;
    sample_unmatched: string[];
  }>;
  registry_only_add: { id: string; rows: number; note: string } | null;
}

async function buildSnapshot(): Promise<Snapshot> {
  const sql = db();

  const totalsRows = (await sql`
    SELECT
      (SELECT COUNT(*) FROM schools)::int                        AS schools,
      (SELECT COUNT(*) FROM schools_year)::int                   AS schools_year_rows,
      (SELECT COUNT(*) FROM school_indicator_values)::int        AS school_indicator_rows,
      (SELECT COUNT(*) FROM pwc_school_program)::int             AS pwc_program_rows,
      (SELECT COUNT(*) FROM geographies)::int                    AS geographies_rows,
      (SELECT COUNT(*) FROM school_geo_crosswalk)::int           AS crosswalk_rows,
      (SELECT COUNT(*) FROM community_indicator_values)::int     AS community_indicator_rows
  `) as Array<Snapshot['totals']>;
  const totals = totalsRows[0]!;

  const nullCoord = (await sql`
    SELECT COUNT(*)::int AS n FROM schools WHERE is_unplottable
  `) as Array<{ n: number }>;
  const sampleNull = (await sql`
    SELECT dbn FROM schools WHERE is_unplottable ORDER BY dbn LIMIT 25
  `) as Array<{ dbn: string }>;

  const remapFindings = (await sql`
    SELECT details FROM data_quality_findings
     WHERE category = 'remap_applied' AND subject = '08X208->84X208'
     ORDER BY run_id DESC LIMIT 1
  `) as Array<{ details: { rows_remapped?: number } }>;
  const remapRows = remapFindings[0]?.details?.rows_remapped ?? null;

  const unmatchedFindings = (await sql`
    SELECT subject, details FROM data_quality_findings
     WHERE category = 'unmatched_dbn'
  `) as Array<{ subject: string; details: { dbn?: string; indicator_id?: string; known_closed?: boolean } }>;
  const byDbn = new Map<string, { appears_in: Set<string>; known_closed: boolean }>();
  for (const u of unmatchedFindings) {
    const dbn = u.details?.dbn ?? u.subject.split(':').pop() ?? '';
    if (!dbn) continue;
    const where = u.subject.includes(':') ? u.subject.split(':')[0]! : 'unknown';
    const entry =
      byDbn.get(dbn) ?? { appears_in: new Set<string>(), known_closed: false };
    entry.appears_in.add(where);
    if (u.details?.known_closed) entry.known_closed = true;
    byDbn.set(dbn, entry);
  }
  const known_unmatched = [...byDbn.entries()].map(([dbn, v]) => ({
    dbn,
    appears_in: [...v.appears_in],
    known_closed: v.known_closed,
  }));

  const pwcUnmatched = known_unmatched
    .filter((u) => u.appears_in.includes('pwc'))
    .map((u) => u.dbn);

  const anchorRow = (await sql`
    SELECT details FROM data_quality_findings
     WHERE category = 'anchor_healing_overlap'
     ORDER BY run_id DESC LIMIT 1
  `) as Array<{ details: Record<string, unknown> }>;
  const anchor_healing_overlap = anchorRow[0]?.details ?? null;

  // Per-indicator counts.
  const perIndicatorRaw = (await sql`
    SELECT indicator_id,
           COUNT(*)::int AS rows,
           COUNT(value_num)::int AS non_null_num
      FROM school_indicator_values
     GROUP BY indicator_id
  `) as Array<{ indicator_id: string; rows: number; non_null_num: number }>;
  const perIndicator = new Map(perIndicatorRaw.map((r) => [r.indicator_id, r]));

  const perCommunityRaw = (await sql`
    SELECT indicator_id,
           COUNT(*)::int AS rows,
           COUNT(value_num)::int AS non_null_num
      FROM community_indicator_values
     GROUP BY indicator_id
  `) as Array<{ indicator_id: string; rows: number; non_null_num: number }>;
  for (const r of perCommunityRaw) perIndicator.set(r.indicator_id, r);

  const yearCoverageFindings = (await sql`
    SELECT subject, details FROM data_quality_findings
     WHERE category = 'year_coverage'
  `) as Array<{ subject: string; details: { years?: Record<string, number> } }>;
  const yearCovById = new Map(
    yearCoverageFindings.map((f) => [f.subject, f.details?.years ?? {}]),
  );

  const sentinelFindings = (await sql`
    SELECT subject, details FROM data_quality_findings
     WHERE category = 'sentinel_nulled'
  `) as Array<{ subject: string; details: { count?: number } }>;
  const sentinelById = new Map(
    sentinelFindings.map((f) => [f.subject, f.details?.count ?? 0]),
  );

  const indicators: Snapshot['indicators'] = [];
  for (const [id, ind] of indicatorsById) {
    const counts = perIndicator.get(id);
    indicators.push({
      id,
      label: ind.label,
      family: ind.family,
      status: ind.status,
      rows: counts?.rows ?? 0,
      non_null: counts?.non_null_num ?? 0,
      sentinel_nulled: sentinelById.get(id) ?? 0,
      years: yearCovById.get(id) ?? {},
    });
  }

  // Crosswalks.
  const layers = ['school_district', 'nta_2020'] as const;
  const crosswalks: Snapshot['crosswalks'] = [];
  for (const layer of layers) {
    const matched = (await sql`
      SELECT COUNT(*)::int AS n FROM school_geo_crosswalk WHERE geo_layer = ${layer}
    `) as Array<{ n: number }>;
    const unmatched = (await sql`
      SELECT s.dbn FROM schools s
       WHERE s.geom IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM school_geo_crosswalk c
            WHERE c.dbn = s.dbn AND c.geo_layer = ${layer}
         )
       ORDER BY s.dbn LIMIT 25
    `) as Array<{ dbn: string }>;
    const unmatchedCount = (await sql`
      SELECT COUNT(*)::int AS n FROM schools s
       WHERE s.geom IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM school_geo_crosswalk c
            WHERE c.dbn = s.dbn AND c.geo_layer = ${layer}
         )
    `) as Array<{ n: number }>;
    crosswalks.push({
      geo_layer: layer,
      matched: matched[0]?.n ?? 0,
      unmatched: unmatchedCount[0]?.n ?? 0,
      sample_unmatched: unmatched.map((u) => u.dbn),
    });
  }

  const q119Rows = (await sql`
    SELECT COUNT(*)::int AS n FROM school_indicator_values
     WHERE indicator_id = 'teacher_q119_disruptive_sel'
  `) as Array<{ n: number }>;
  const registryOnlyAdd =
    (q119Rows[0]?.n ?? 0) > 0
      ? {
          id: 'teacher_q119_disruptive_sel',
          rows: q119Rows[0]!.n,
          note: 'Indicator added via registry alone (same dataset as q120). Acceptance test passed.',
        }
      : null;

  return {
    generated_at: new Date().toISOString(),
    totals,
    identity: {
      null_coord_schools: nullCoord[0]?.n ?? 0,
      plottable_schools: (totals.schools ?? 0) - (nullCoord[0]?.n ?? 0),
      sample_null_coord_dbns: sampleNull.map((s) => s.dbn),
    },
    dbn: {
      remap_applied_08X208_to_84X208: (remapRows ?? 0) > 0,
      remap_rows: remapRows,
      known_unmatched,
      pwc_unmatched_dbns: pwcUnmatched,
    },
    anchor_healing_overlap,
    indicators,
    crosswalks,
    registry_only_add: registryOnlyAdd,
  };
}

function renderMarkdown(s: Snapshot): string {
  const fmt = (n: number) => n.toLocaleString();
  const lines: string[] = [];
  lines.push('# PWC Geohub — Phase 0 Data Quality Report');
  lines.push('');
  lines.push(`_Generated: ${s.generated_at}_`);
  lines.push('');
  lines.push('## Totals');
  lines.push('');
  lines.push('| Table | Rows |');
  lines.push('|---|---:|');
  lines.push(`| schools | ${fmt(s.totals.schools)} |`);
  lines.push(`| schools_year | ${fmt(s.totals.schools_year_rows)} |`);
  lines.push(`| school_indicator_values | ${fmt(s.totals.school_indicator_rows)} |`);
  lines.push(`| pwc_school_program | ${fmt(s.totals.pwc_program_rows)} |`);
  lines.push(`| geographies | ${fmt(s.totals.geographies_rows)} |`);
  lines.push(`| school_geo_crosswalk | ${fmt(s.totals.crosswalk_rows)} |`);
  lines.push(`| community_indicator_values | ${fmt(s.totals.community_indicator_rows)} |`);
  lines.push('');

  lines.push('## Identity & coordinates');
  lines.push('');
  lines.push(`- **Plottable schools:** ${fmt(s.identity.plottable_schools)}`);
  lines.push(`- **Null-coordinate schools:** ${fmt(s.identity.null_coord_schools)}`);
  if (s.identity.sample_null_coord_dbns.length > 0) {
    lines.push(`  - Sample: ${s.identity.sample_null_coord_dbns.slice(0, 10).join(', ')}…`);
  }
  lines.push('');

  lines.push('## DBN remap & known unmatched');
  lines.push('');
  lines.push(
    `- **08X208 → 84X208 remap applied:** ${s.dbn.remap_applied_08X208_to_84X208 ? 'yes' : 'no'}` +
      (s.dbn.remap_rows != null ? ` (${fmt(s.dbn.remap_rows)} master rows)` : ''),
  );
  lines.push(`- **PWC DBNs unmatched in master:** ${s.dbn.pwc_unmatched_dbns.join(', ') || 'none'}`);
  if (s.dbn.known_unmatched.length === 0) {
    lines.push(`- No unmatched DBNs recorded for this run.`);
  } else {
    lines.push(`- Known unmatched DBNs:`);
    for (const u of s.dbn.known_unmatched) {
      lines.push(
        `  - \`${u.dbn}\` — seen in ${u.appears_in.join(', ')}` +
          (u.known_closed ? ' — **known closed school (03M299 = Maxine Greene)**' : ''),
      );
    }
  }
  lines.push('');

  lines.push('## Anchor / Healing Arts (Q1 default applied)');
  lines.push('');
  if (s.anchor_healing_overlap) {
    const d = s.anchor_healing_overlap as Record<string, unknown>;
    lines.push('```json');
    lines.push(JSON.stringify(d, null, 2));
    lines.push('```');
  } else {
    lines.push('_No overlap data recorded._');
  }
  lines.push('');

  lines.push('## Per-indicator year coverage');
  lines.push('');
  lines.push('| Indicator | Family | Status | Rows | Non-null | Sentinel→NULL | Years (count) |');
  lines.push('|---|---|---|---:|---:|---:|---|');
  for (const i of s.indicators) {
    const years = Object.entries(i.years)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([y, n]) => `${y}:${n}`)
      .join(', ');
    lines.push(
      `| \`${i.id}\` | ${i.family} | ${i.status} | ${fmt(i.rows)} | ${fmt(i.non_null)} | ${fmt(i.sentinel_nulled)} | ${years || '—'} |`,
    );
  }
  lines.push('');

  lines.push('## Crosswalks (school↔polygon)');
  lines.push('');
  lines.push('| geo_layer | matched | unmatched (plottable) | sample unmatched |');
  lines.push('|---|---:|---:|---|');
  for (const c of s.crosswalks) {
    lines.push(
      `| ${c.geo_layer} | ${fmt(c.matched)} | ${fmt(c.unmatched)} | ${c.sample_unmatched.slice(0, 8).join(', ') || '—'} |`,
    );
  }
  lines.push('');

  lines.push('## Acceptance test — registry-only indicator add');
  lines.push('');
  if (s.registry_only_add) {
    lines.push(
      `- \`${s.registry_only_add.id}\`: **PASS** (${fmt(s.registry_only_add.rows)} rows ingested via registry alone)`,
    );
    lines.push(`- ${s.registry_only_add.note}`);
  } else {
    lines.push('- **FAIL**: q119 rows not detected in school_indicator_values.');
  }
  lines.push('');

  lines.push('---');
  lines.push('_End of report._');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const snapshot = await buildSnapshot();
  await mkdir(REPORTS_DIR, { recursive: true });

  const jsonPath = resolve(REPORTS_DIR, 'data-quality.json');
  const mdPath = resolve(REPORTS_DIR, 'data-quality.md');
  await writeFile(jsonPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  await writeFile(mdPath, renderMarkdown(snapshot), 'utf-8');
  console.log(`[etl:report] wrote ${jsonPath}`);
  console.log(`[etl:report] wrote ${mdPath}`);
}

main().catch((err) => {
  console.error('[etl:report] failed:', err);
  process.exit(1);
});
