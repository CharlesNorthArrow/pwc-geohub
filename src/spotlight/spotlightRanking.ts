/**
 * Spotlight outlier ranking — pure module, no React, no fetches.
 *
 * Given the selected school's value, a benchmark, and the PWC-peer value
 * distribution for each candidate indicator, produce the ordered candidate
 * list per section (school / community) per mode (case / celebrate).
 *
 * Scoring (spec):
 *   g = polarity * (value - benchmark) / peerStd     // signed goodness
 *     (fallback: / |benchmark| when peerStd is 0/unavailable;
 *      raw diff when benchmark is 0 too — deterministic, never NaN)
 *   mode filter: case keeps g < 0, celebrate keeps g > 0
 *   score = |g| + MAGNITUDE_WEIGHT * normalizedMagnitude
 *   normalizedMagnitude = clamp(|value - benchmark| / magnitudeScale, 0, 1)
 *     magnitudeScale = peer IQR, falling back to |benchmark|
 *
 * Auto-selection applies the category-diversity rule (max one indicator per
 * parent category); the full ranked list is returned un-deduped so the
 * per-tile "swap" control can walk every next-ranked candidate, including
 * ones diversity skipped — a manual override is deliberate.
 */

import type { Format } from '../registry/types';

export type SpotlightMode = 'case' | 'celebrate';
export type BenchmarkSource = 'citywide' | 'anchor' | 'healingArts';

/* ------------------------------ tunables --------------------------------- */

export const BENCHMARK_SOURCE: BenchmarkSource = 'citywide';
export const MAGNITUDE_WEIGHT = 0.25;
export const ENFORCE_CATEGORY_DIVERSITY = true;
export const TILES_PER_SECTION = 3;
export const EXPORT_SIZES = {
  portrait: [1080, 1350],
  square: [1080, 1080],
} as const;

/* -------------------------------- types ---------------------------------- */

export interface CandidateSpec {
  /** Indicator id (or pseudo-id for profile fields, e.g. 'profile_pct_poverty'). */
  id: string;
  /** Display name (short_label preferred). */
  label: string;
  /** Parent category for the diversity rule (registry theme, or 'Profile'). */
  category: string;
  format: Format;
  /** +1 higher-is-better, -1 higher-is-worse. Candidates with no direction
   *  (registry good_direction 'none') must not be passed in at all. */
  polarity: 1 | -1;
  /** Selected school's value (latest year). Null → not a candidate. */
  value: number | null;
  /** Benchmark average per BENCHMARK_SOURCE. Null → not scoreable. */
  benchmark: number | null;
  /** Values across the peer set (all PWC schools with data, incl. self). */
  peerValues: number[];
}

export interface ScoredCandidate {
  id: string;
  label: string;
  category: string;
  format: Format;
  polarity: 1 | -1;
  value: number;
  benchmark: number;
  peerMean: number | null;
  peerStd: number | null;
  /** Signed goodness: + = better than benchmark, − = worse. */
  g: number;
  normalizedMagnitude: number;
  score: number;
  /** 1-based rank among peers, worst → best per polarity (competition
   *  ranking). Null when the school isn't in peerValues. */
  rankWorst: number | null;
  /** Peer cohort size (schools with data). */
  peerN: number;
  /** False when this candidate only qualified via the relaxed-direction
   *  fallback (wrong side of the benchmark for the mode). */
  directionMatched: boolean;
}

export interface SectionRanking {
  /** Every scoreable candidate, ordered: direction-correct by score desc,
   *  then relaxed-direction ones by |g| asc (closest to benchmark first).
   *  The swap control walks this list. */
  ranked: ScoredCandidate[];
  /** Auto-selected tile ids (≤ TILES_PER_SECTION) after the diversity rule. */
  defaultSelection: string[];
  /** True when direction-correct candidates alone couldn't fill the section. */
  directionRelaxed: boolean;
  /** Slots left unfilled even after relaxation → UI fills from the
   *  fallback pool (profile/program facts or neutral context). */
  shortfall: number;
  /** Celebrate-mode honesty flag: no candidate genuinely scored g > 0
   *  (community sections render neutral context instead of forced spin). */
  noGenuinePositives: boolean;
}

/* ------------------------------ statistics -------------------------------- */

export function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  let sum = 0;
  for (const v of values) sum += v;
  const m = sum / values.length;
  let sq = 0;
  for (const v of values) sq += (v - m) * (v - m);
  return Math.sqrt(sq / values.length);
}

/** Interquartile range with linear interpolation. Null when < 4 values. */
export function iqr(values: number[]): number | null {
  if (values.length < 4) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number): number => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const frac = idx - lo;
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
  };
  return q(0.75) - q(0.25);
}

/**
 * 1-based competition rank, worst → best per polarity: rank 1 = the worst
 * value in the peer set (highest when higher-is-worse, lowest when
 * higher-is-better). Ties share the lower rank.
 */
export function rankWorstFirst(
  value: number,
  peerValues: number[],
  polarity: 1 | -1,
): number {
  let strictlyWorse = 0;
  for (const v of peerValues) {
    // v is WORSE than value when it sits further in the bad direction.
    if (polarity === 1 ? v < value : v > value) strictlyWorse++;
  }
  return strictlyWorse + 1;
}

/* ------------------------------- scoring ---------------------------------- */

function scoreCandidate(c: CandidateSpec): ScoredCandidate | null {
  if (c.value == null || c.benchmark == null) return null;
  const peerMean = c.peerValues.length > 0
    ? c.peerValues.reduce((a, b) => a + b, 0) / c.peerValues.length
    : null;
  const peerStd = stdDev(c.peerValues);

  const diff = c.value - c.benchmark;
  let g: number;
  if (peerStd != null && peerStd > 0) {
    g = (c.polarity * diff) / peerStd;
  } else if (Math.abs(c.benchmark) > 0) {
    g = (c.polarity * diff) / Math.abs(c.benchmark);
  } else {
    g = c.polarity * diff;
  }

  const scale = iqr(c.peerValues) ?? (Math.abs(c.benchmark) > 0 ? Math.abs(c.benchmark) : null);
  const normalizedMagnitude = scale != null && scale > 0
    ? Math.min(1, Math.abs(diff) / scale)
    : 0;

  const inPeers = c.peerValues.includes(c.value);
  return {
    id: c.id,
    label: c.label,
    category: c.category,
    format: c.format,
    polarity: c.polarity,
    value: c.value,
    benchmark: c.benchmark,
    peerMean,
    peerStd,
    g,
    normalizedMagnitude,
    score: Math.abs(g) + MAGNITUDE_WEIGHT * normalizedMagnitude,
    rankWorst: inPeers ? rankWorstFirst(c.value, c.peerValues, c.polarity) : null,
    peerN: c.peerValues.length,
    directionMatched: true, // adjusted by rankSection for relaxed fills
  };
}

/** score desc → larger |value−benchmark| → stable alphabetical by label. */
function bySpecOrder(a: ScoredCandidate, b: ScoredCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  const magA = Math.abs(a.value - a.benchmark);
  const magB = Math.abs(b.value - b.benchmark);
  if (magB !== magA) return magB - magA;
  return a.label.localeCompare(b.label);
}

export interface RankOptions {
  tilesPerSection?: number;
  enforceCategoryDiversity?: boolean;
}

export function rankSection(
  candidates: CandidateSpec[],
  mode: SpotlightMode,
  opts: RankOptions = {},
): SectionRanking {
  const tiles = opts.tilesPerSection ?? TILES_PER_SECTION;
  const diversity = opts.enforceCategoryDiversity ?? ENFORCE_CATEGORY_DIVERSITY;

  const scored: ScoredCandidate[] = [];
  for (const c of candidates) {
    const s = scoreCandidate(c);
    if (s) scored.push(s);
  }

  const keep = (s: ScoredCandidate): boolean => (mode === 'case' ? s.g < 0 : s.g > 0);
  const correct = scored.filter(keep).sort(bySpecOrder);
  // Relaxed pool: wrong side (or exactly at benchmark), closest to the
  // benchmark first — the least-wrong fills when the section runs short.
  const relaxed = scored
    .filter((s) => !keep(s))
    .sort((a, b) => Math.abs(a.g) - Math.abs(b.g) || a.label.localeCompare(b.label))
    .map((s) => ({ ...s, directionMatched: false }));

  // Auto-selection with the diversity rule (direction-correct first).
  const selection: string[] = [];
  const usedCategories = new Set<string>();
  for (const s of correct) {
    if (selection.length >= tiles) break;
    if (diversity && usedCategories.has(s.category)) continue;
    selection.push(s.id);
    usedCategories.add(s.category);
  }
  // Second pass without diversity if the rule itself starved the section
  // (fewer distinct categories than tiles) — diversity should never force
  // the relaxed/fallback path while direction-correct candidates exist.
  if (selection.length < tiles) {
    for (const s of correct) {
      if (selection.length >= tiles) break;
      if (!selection.includes(s.id)) selection.push(s.id);
    }
  }

  const directionRelaxed = selection.length < tiles && relaxed.length > 0;
  if (selection.length < tiles) {
    for (const s of relaxed) {
      if (selection.length >= tiles) break;
      if (diversity && usedCategories.has(s.category) && relaxed.length > tiles - selection.length) continue;
      selection.push(s.id);
      usedCategories.add(s.category);
    }
    // As above: fill regardless of diversity if still short.
    for (const s of relaxed) {
      if (selection.length >= tiles) break;
      if (!selection.includes(s.id)) selection.push(s.id);
    }
  }

  return {
    ranked: [...correct, ...relaxed],
    defaultSelection: selection,
    directionRelaxed,
    shortfall: Math.max(0, tiles - selection.length),
    noGenuinePositives: mode === 'celebrate' && correct.length === 0,
  };
}
