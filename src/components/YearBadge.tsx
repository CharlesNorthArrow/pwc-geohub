'use client';

import { useHubStore } from '../store/useHubStore';
import type { IndicatorPublic } from '../contract/types';

interface Props {
  family: 'school' | 'community';
  indicator: IndicatorPublic;
  /** The year currently being shown (may be the latest or a URL override). */
  displayYear: string;
  /** True if the active indicator has no value for `displayYear`. */
  noData: boolean;
}

/**
 * Discreet "Showing 2024-25" affordance — spec §6.5. Until the Phase 4 time
 * slider exists, this also exposes a small dropdown of the indicator's
 * available years so we can verify the no-data branch (acceptance test:
 * "switching to a year with no data shows the 🗓️ notice").
 */
export default function YearBadge({
  family,
  indicator,
  displayYear,
  noData,
}: Props): React.JSX.Element {
  const setSchoolYear = useHubStore((s) => s.setSchoolYearOverride);
  const setCommunityYear = useHubStore((s) => s.setCommunityYearOverride);
  const setYear = family === 'school' ? setSchoolYear : setCommunityYear;

  const latest = indicator.years[indicator.years.length - 1] ?? '';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10,
        color: noData ? '#a82255' : '#467c9d',
      }}
    >
      <span>{family === 'school' ? 'Pts' : 'Tracts'}:</span>
      <select
        value={displayYear}
        onChange={(e) => setYear(e.target.value === latest ? null : e.target.value)}
        style={{
          fontSize: 10,
          padding: '1px 2px',
          background: 'transparent',
          color: noData ? '#a82255' : '#467c9d',
          border: '1px solid rgba(70,124,157,0.3)',
          borderRadius: 3,
        }}
      >
        {indicator.years.map((y) => (
          <option key={y} value={y}>
            {y}
            {y === latest ? ' (latest)' : ''}
          </option>
        ))}
        {indicator.years.includes(displayYear) ? null : (
          <option value={displayYear}>{displayYear} (none)</option>
        )}
      </select>
    </div>
  );
}
