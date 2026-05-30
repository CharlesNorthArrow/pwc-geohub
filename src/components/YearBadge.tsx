'use client';

import type { IndicatorPublic } from '../contract/types';
import {
  indicatorSliderYears,
  nearestSliderYear,
  type SliderYear,
} from '../contract/year';

interface Props {
  family: 'school' | 'community';
  indicator: IndicatorPublic;
  /** The year currently being shown for this layer, or null when missing. */
  displayYear: string | null;
  /** Slider year (the user's current position, in school_year format). */
  sliderYear: SliderYear;
  /** Optional jump callback — when set, the missing-year state surfaces a
   *  one-click affordance to snap to the nearest available year. */
  onJump?: (year: SliderYear) => void;
}

/**
 * Year status for one indicator family, rendered as a small pill at the top
 * of its legend section.
 *
 *  - Has data       → muted-blue pill, "School · 2024-25" / "Community · 2024"
 *  - Missing data   → amber pill, "No 2024-25 data" with a "→ jump to YYYY-YY"
 *                     link when `onJump` is provided and a nearer year exists.
 *
 * Replaces the earlier 10px ghost text + bottom-of-panel notice; the warning
 * state now sits in the user's eye-line right next to the indicator name.
 */
export default function YearBadge({
  family,
  indicator,
  displayYear,
  sliderYear,
  onJump,
}: Props): React.JSX.Element {
  const familyLabel = family === 'school' ? 'School' : 'Community';
  if (displayYear) {
    return (
      <span style={pillStyle({ tone: 'ok' })}>
        <span style={{ opacity: 0.75 }}>{familyLabel}</span>
        <span style={separatorStyle}>·</span>
        <span style={{ fontWeight: 700 }}>{displayYear}</span>
      </span>
    );
  }

  // Warning state.
  const available = indicatorSliderYears(family, indicator.years);
  const nearest = nearestSliderYear(sliderYear, available);
  return (
    <span style={pillStyle({ tone: 'warn' })}>
      <span aria-hidden style={{ fontSize: 11, lineHeight: 1 }}>
        🗓️
      </span>
      <span>
        No <strong style={{ fontWeight: 700 }}>{sliderYear}</strong> data
      </span>
      {nearest && onJump ? (
        <>
          <span style={separatorStyle}>·</span>
          <button
            type="button"
            onClick={() => onJump(nearest)}
            style={jumpButtonStyle}
            title={`Jump to ${nearest}`}
          >
            jump to {nearest}
          </button>
        </>
      ) : null}
    </span>
  );
}

const separatorStyle: React.CSSProperties = {
  opacity: 0.5,
  fontWeight: 600,
};

function pillStyle({ tone }: { tone: 'ok' | 'warn' }): React.CSSProperties {
  if (tone === 'warn') {
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '2px 8px',
      borderRadius: 999,
      background: '#fff1e3',
      border: '1px solid #f3c89a',
      color: '#9a4a08',
      fontSize: 11,
      lineHeight: 1.4,
      whiteSpace: 'nowrap',
    };
  }
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '2px 8px',
    borderRadius: 999,
    background: '#eef4f8',
    border: '1px solid #cbd9e3',
    color: '#1a4a73',
    fontSize: 11,
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
  };
}

const jumpButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  color: '#9a4a08',
  textDecoration: 'underline',
  cursor: 'pointer',
  fontFamily: 'inherit',
  lineHeight: 'inherit',
};
