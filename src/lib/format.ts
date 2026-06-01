/**
 * Indicator value + delta formatters.
 *
 * Centralized so KPI cards, Detail Panel, Scorecard, and future tables all
 * render the same value in the same way. The format strings track each
 * indicator's `format` field from the registry — never hardcoded per call site.
 */

import type { Format } from '../registry/types';

/** Render an indicator value (positive, no sign prefix). */
export function formatValue(v: number, format: Format): string {
  switch (format) {
    case 'percent':
    case 'rate_per_100':
      return `${v.toFixed(1)}%`;
    case 'integer':
    case 'count':
      return v.toFixed(0);
    case 'index':
      return v.toFixed(2);
    case 'categorical':
      // Numeric formatter shouldn't be called on categorical indicators — but
      // if it ever is, fall back to one decimal so the page doesn't break.
      return v.toFixed(1);
    default:
      return v.toFixed(1);
  }
}

/**
 * Render a signed delta in the indicator's natural unit. Percent and
 * rate-per-100 → percentage points ("pp"); integer/count → integer
 * difference; index → 2 decimals; default → 1 decimal. Sign is ALWAYS
 * explicit (`+` for positive, U+2212 minus for negative) so a delta is never
 * mistaken for a value.
 */
export function formatDelta(delta: number, format: Format): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const mag = Math.abs(delta);
  switch (format) {
    case 'percent':
    case 'rate_per_100':
      return `${sign}${mag.toFixed(1)} pp`;
    case 'integer':
    case 'count':
      return `${sign}${mag.toFixed(0)}`;
    case 'index':
      return `${sign}${mag.toFixed(2)}`;
    default:
      return `${sign}${mag.toFixed(1)}`;
  }
}

/** Compute the unweighted mean of `values`. Returns null when empty. */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}
