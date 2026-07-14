/**
 * Spotlight framing — polarity-and-mode-aware one-liners and headline
 * suggestions. Pure string builders over ScoredCandidate; all numeric
 * rendering goes through the app-wide formatters (src/lib/format.ts) so
 * rounding matches every other view.
 *
 * Sentence patterns (spec):
 *   need, higher-is-worse : "{value} — {ordinal} highest of {N} PWC schools · {gap} above citywide ({benchmark})"
 *   need, higher-is-better: "{value} — {ordinal} lowest of {N} PWC schools · {gap} below citywide ({benchmark})"
 *   celebrate, hi-better  : "{value} — {ordinal} highest of {N} · {gap} above citywide"
 *   celebrate, hi-worse   : "{value} — among the lowest of {N} · {gap} below citywide"
 */

import type { Format } from '../registry/types';
import { formatValue } from '../lib/format';
import type { ScoredCandidate, SpotlightMode } from './spotlightRanking';

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Unsigned gap in the indicator's natural unit ("18.2 pp", "0.14", "312"). */
export function gapText(value: number, benchmark: number, format: Format): string {
  const mag = Math.abs(value - benchmark);
  switch (format) {
    case 'percent':
    case 'rate_per_100':
      return `${mag.toFixed(1)} pp`;
    case 'integer':
    case 'count':
      return mag.toFixed(0);
    case 'index':
      return mag.toFixed(2);
    default:
      return mag.toFixed(1);
  }
}

/**
 * The tile one-liner. `benchmarkLabel` defaults to "citywide";
 * `peerLabel` to "PWC schools".
 */
export function caseSentence(
  c: ScoredCandidate,
  mode: SpotlightMode,
  benchmarkLabel = 'citywide',
  peerLabel = 'PWC schools',
): string {
  const value = formatValue(c.value, c.format);
  const bench = formatValue(c.benchmark, c.format);
  const gap = gapText(c.value, c.benchmark, c.format);
  const n = c.peerN;

  // Which side of the benchmark the value actually sits on (framing must
  // stay truthful for relaxed-direction tiles too).
  const aboveBenchmark = c.value > c.benchmark;
  const sideWord = aboveBenchmark ? 'above' : 'below';

  if (mode === 'case') {
    if (c.polarity === -1) {
      // Need, higher-is-worse: rankWorst 1 = highest value.
      const rankPart = c.rankWorst != null ? `${ordinal(c.rankWorst)} highest of ${n} ${peerLabel}` : `of ${n} ${peerLabel}`;
      return `${value} — ${rankPart} · ${gap} ${sideWord} ${benchmarkLabel} (${bench})`;
    }
    // Need, higher-is-better: rankWorst 1 = lowest value.
    const rankPart = c.rankWorst != null ? `${ordinal(c.rankWorst)} lowest of ${n} ${peerLabel}` : `of ${n} ${peerLabel}`;
    return `${value} — ${rankPart} · ${gap} ${sideWord} ${benchmarkLabel} (${bench})`;
  }

  if (c.polarity === 1) {
    // Celebrate, higher-is-better: convert worst→best rank into a top rank.
    const topRank = c.rankWorst != null ? c.peerN - c.rankWorst + 1 : null;
    const rankPart = topRank != null ? `${ordinal(topRank)} highest of ${n}` : `of ${n}`;
    return `${value} — ${rankPart} · ${gap} ${sideWord} ${benchmarkLabel}`;
  }
  // Celebrate, higher-is-worse (low value is the strength). Rank from the
  // low side keeps the sentence truthful even for relaxed-direction tiles
  // that actually sit above the benchmark.
  const lowRank = c.rankWorst != null ? c.peerN - c.rankWorst + 1 : null;
  const rankPart = lowRank != null ? `${ordinal(lowRank)} lowest of ${n}` : `of ${n}`;
  return `${value} — ${rankPart} · ${gap} ${sideWord} ${benchmarkLabel}`;
}

/** Short clause for headline templates: "chronic absenteeism at 61.9% (18.2 pp above citywide)". */
export function factClause(c: ScoredCandidate, benchmarkLabel = 'citywide'): string {
  const side = c.value > c.benchmark ? 'above' : 'below';
  return `${c.label.toLowerCase()} at ${formatValue(c.value, c.format)} (${gapText(c.value, c.benchmark, c.format)} ${side} ${benchmarkLabel})`;
}

export interface HeadlineInput {
  mode: SpotlightMode;
  schoolName: string;
  ntaName: string | null;
  topSchool: ScoredCandidate | null;
  topCommunity: ScoredCandidate | null;
}

/**
 * Auto-suggested headline — a starting point, never a locked string. Two
 * templates per mode; the first with enough data wins.
 */
export function suggestHeadline({ mode, schoolName, ntaName, topSchool, topCommunity }: HeadlineInput): string {
  const place = ntaName ?? 'its community';
  if (mode === 'case') {
    if (topSchool && topCommunity) {
      return `At ${schoolName}, ${factClause(topSchool)} — in a community where ${factClause(topCommunity)}.`;
    }
    if (topSchool) {
      return `${schoolName} needs support: ${factClause(topSchool)}.`;
    }
    return `${schoolName} serves ${place}, a community that needs support.`;
  }
  if (topSchool) {
    return `${schoolName} students are beating the odds: ${factClause(topSchool)}.`;
  }
  return `Celebrating ${schoolName} and the ${place} community.`;
}
