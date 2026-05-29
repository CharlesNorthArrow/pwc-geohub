'use client';

import type { IndicatorPublic } from '../contract/types';

interface Props {
  family: 'school' | 'community';
  indicator: IndicatorPublic;
  /** The year currently being shown for this layer, or null when missing. */
  displayYear: string | null;
  /** Slider year (for context when displayYear is null). */
  sliderYear: string;
}

/**
 * Spec §6.5 — discreet year affordance. Phase 4 makes this read-only; the
 * time slider in the header is the only year control. School and community
 * each get their own badge because their *available* years can differ:
 * school speaks school_year ("2024-25"), community speaks calendar year
 * ("2023") via `toCommunityYear`.
 */
export default function YearBadge({
  family,
  displayYear,
  sliderYear,
}: Props): React.JSX.Element {
  const missing = displayYear == null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10,
        color: missing ? '#a82255' : '#467c9d',
      }}
    >
      <span>{family === 'school' ? 'Points' : 'Tracts'}:</span>
      <span style={{ fontWeight: 600 }}>
        {missing ? `no ${sliderYear} data` : displayYear}
      </span>
    </div>
  );
}
