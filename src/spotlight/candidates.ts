/**
 * Spotlight candidate assembly — turns already-fetched app data (indicator
 * registry + analytics series + schools master + PWC membership) into the
 * CandidateSpec lists the ranking module scores. Pure; no fetching.
 *
 * Candidacy is registry-driven:
 *   - school section: every active school indicator with a direction
 *     (good_direction ≠ 'none'), plus the three profile need-fields
 *     (% poverty / % SWD / % ELL — polarity −1, framed as service need).
 *     Enrollment is never a candidate.
 *   - community section: every active community indicator with a direction.
 *     'none' indicators (racial_predominance, children_immigrant_families)
 *     are excluded from scoring; numeric ones surface via
 *     buildNeutralCommunityFacts as context.
 *
 * Community values are the per-school NTA aggregation the analytics series
 * already carries (§11.9 — crosswalks, not point-in-polygon), so "the
 * community benchmark" = mean of every school's surrounding-NTA value, and
 * the peer set = PWC schools' surrounding-NTA values.
 */

import type {
  AnalyticsSeriesRow,
  IndicatorPublic,
  SchoolMaster,
} from '../contract/types';
import type { BenchmarkSource, CandidateSpec } from './spotlightRanking';
import { mean } from '../lib/format';

export interface CandidateContext {
  dbn: string;
  indicators: IndicatorPublic[];
  /** indicator id → full analytics series (all years, all schools). */
  seriesById: Record<string, AnalyticsSeriesRow[]>;
  /** All PWC schools (the standardization peer set). */
  pwcDbns: Set<string>;
  /** PWC groups, for the configurable benchmark source. */
  anchorDbns: Set<string>;
  healingDbns: Set<string>;
  schoolsMaster: SchoolMaster[];
  benchmarkSource: BenchmarkSource;
}

/** Profile need-fields eligible as school-section candidates (spec). */
export const PROFILE_FIELDS: ReadonlyArray<{
  id: string;
  label: string;
  field: 'pct_poverty' | 'pct_students_with_disabilities' | 'pct_english_language_learners';
}> = [
  { id: 'profile_pct_poverty', label: '% Poverty', field: 'pct_poverty' },
  // SWD/ELL are service needs, not deficits — the label keeps that framing.
  { id: 'profile_pct_swd', label: '% Students with Disabilities (service need)', field: 'pct_students_with_disabilities' },
  { id: 'profile_pct_ell', label: '% English Language Learners (service need)', field: 'pct_english_language_learners' },
];

export function latestIndicatorYear(ind: IndicatorPublic): string | null {
  return ind.years.length > 0 ? ind.years[ind.years.length - 1]! : null;
}

/** dbn → value at the indicator's latest year. */
export function valuesAtLatestYear(
  ind: IndicatorPublic,
  series: AnalyticsSeriesRow[] | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  const latest = latestIndicatorYear(ind);
  if (!latest || !series) return out;
  for (const r of series) {
    if (r.year === latest && r.value_num != null) out.set(r.dbn, r.value_num);
  }
  return out;
}

function benchmarkOf(
  values: Map<string, number>,
  ctx: CandidateContext,
): number | null {
  if (ctx.benchmarkSource === 'anchor' || ctx.benchmarkSource === 'healingArts') {
    const set = ctx.benchmarkSource === 'anchor' ? ctx.anchorDbns : ctx.healingDbns;
    const vals: number[] = [];
    for (const [dbn, v] of values) if (set.has(dbn)) vals.push(v);
    return mean(vals);
  }
  // citywide — every school with a value, no filter.
  return mean([...values.values()]);
}

function peerValuesOf(values: Map<string, number>, ctx: CandidateContext): number[] {
  const vals: number[] = [];
  for (const [dbn, v] of values) if (ctx.pwcDbns.has(dbn)) vals.push(v);
  return vals;
}

function indicatorCandidate(ind: IndicatorPublic, ctx: CandidateContext): CandidateSpec | null {
  if (ind.scale.good_direction === 'none') return null;
  if (ind.format === 'categorical') return null;
  const values = valuesAtLatestYear(ind, ctx.seriesById[ind.id]);
  return {
    id: ind.id,
    label: ind.short_label ?? ind.label,
    category: ind.theme,
    format: ind.format,
    polarity: ind.scale.good_direction === 'high' ? 1 : -1,
    value: values.get(ctx.dbn) ?? null,
    benchmark: benchmarkOf(values, ctx),
    peerValues: peerValuesOf(values, ctx),
  };
}

export function buildSchoolCandidates(ctx: CandidateContext): CandidateSpec[] {
  const out: CandidateSpec[] = [];
  for (const ind of ctx.indicators) {
    if (ind.family !== 'school') continue;
    const c = indicatorCandidate(ind, ctx);
    if (c) out.push(c);
  }
  // Profile need-fields — per-school values live on the schools master.
  for (const pf of PROFILE_FIELDS) {
    const values = new Map<string, number>();
    for (const s of ctx.schoolsMaster) {
      const v = s[pf.field];
      if (v != null) values.set(s.dbn, v);
    }
    out.push({
      id: pf.id,
      label: pf.label,
      category: 'Profile',
      format: 'percent',
      polarity: -1,
      value: values.get(ctx.dbn) ?? null,
      benchmark: benchmarkOf(values, ctx),
      peerValues: peerValuesOf(values, ctx),
    });
  }
  return out;
}

export function buildCommunityCandidates(ctx: CandidateContext): CandidateSpec[] {
  const out: CandidateSpec[] = [];
  for (const ind of ctx.indicators) {
    if (ind.family !== 'community') continue;
    const c = indicatorCandidate(ind, ctx);
    if (c) out.push(c);
  }
  return out;
}

export interface NeutralFact {
  id: string;
  label: string;
  value: number;
  format: IndicatorPublic['format'];
}

/**
 * Context-only community facts (good_direction 'none', numeric) — the
 * honest fallback when Celebrate mode has no genuine community positives,
 * and the last resort of the fill chain. Never scored.
 */
export function buildNeutralCommunityFacts(ctx: CandidateContext): NeutralFact[] {
  const out: NeutralFact[] = [];
  for (const ind of ctx.indicators) {
    if (ind.family !== 'community') continue;
    if (ind.scale.good_direction !== 'none') continue;
    if (ind.format === 'categorical') continue;
    const values = valuesAtLatestYear(ind, ctx.seriesById[ind.id]);
    const v = values.get(ctx.dbn);
    if (v == null) continue;
    out.push({ id: ind.id, label: ind.short_label ?? ind.label, value: v, format: ind.format });
  }
  return out;
}
