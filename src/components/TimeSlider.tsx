'use client';

import { useMemo } from 'react';
import { useHubStore } from '../store/useHubStore';
import {
  indicatorSliderYears,
  SLIDER_YEARS,
  type SliderYear,
} from '../contract/year';
import type { IndicatorPublic } from '../contract/types';

interface Props {
  /** Active school indicator (or null) — drives the school-row availability dots. */
  schoolIndicator: IndicatorPublic | null;
  /** Active community indicator (or null) — drives the community-row dots. */
  communityIndicator: IndicatorPublic | null;
  /** Years with active PWC program data (from pwc history) — drives the
   *  always-on yellow-star row. Null while the history fetch is in flight. */
  pwcYears: Set<SliderYear> | null;
}

/* Brand colors used for the per-family availability indicators. */
const SCHOOL_DOT = '#027BC0';
const COMMUNITY_DOT = '#F0901F';
const PWC_STAR = '#f5c400';
const EMPTY_RING = '#c5cdd6';

/**
 * Spec §6.5 — 5-year time slider. Native `<input type="range">` for
 * accessibility (keyboard ←/→ + screen-reader value announcement) wrapped
 * in tick labels.
 *
 * Above each tick label we now render up to two small dots — one per active
 * indicator family — that fill when that indicator has data for that year
 * and stay hollow when it doesn't. This turns the slider itself into the
 * primary year-availability surface.
 */
export default function TimeSlider({
  schoolIndicator,
  communityIndicator,
  pwcYears,
}: Props): React.JSX.Element {
  const year = useHubStore((s) => s.year);
  const setYear = useHubStore((s) => s.setYear);

  const idx = Math.max(0, SLIDER_YEARS.indexOf(year));

  // SliderYear sets that each indicator has data for, in O(years) once per
  // indicator change.
  const schoolAvailable = useMemo(
    () =>
      schoolIndicator
        ? new Set(indicatorSliderYears('school', schoolIndicator.years))
        : null,
    [schoolIndicator],
  );
  const communityAvailable = useMemo(
    () =>
      communityIndicator
        ? new Set(indicatorSliderYears('community', communityIndicator.years))
        : null,
    [communityIndicator],
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 6px',
        minWidth: 260,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            color: '#467c9d',
          }}
        >
          Year
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#002040' }}>{year}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 180 }}>
        <input
          type="range"
          min={0}
          max={SLIDER_YEARS.length - 1}
          step={1}
          value={idx}
          onChange={(e) => {
            const i = Number(e.target.value);
            const next = SLIDER_YEARS[i];
            if (next) setYear(next as SliderYear);
          }}
          aria-label={`Year: ${year}`}
          aria-valuetext={year}
          style={{
            width: '100%',
            accentColor: '#027BC0',
          }}
        />
        {/* Per-family availability dots (rendered only when their indicator
         *  is active) + the always-on PWC-program star row. */}
        {schoolAvailable || communityAvailable || pwcYears ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '0 1px',
            }}
            aria-hidden
          >
            {SLIDER_YEARS.map((y) => (
              <div
                key={y}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                {schoolAvailable ? (
                  <AvailabilityDot
                    color={SCHOOL_DOT}
                    available={schoolAvailable.has(y)}
                  />
                ) : null}
                {communityAvailable ? (
                  <AvailabilityDot
                    color={COMMUNITY_DOT}
                    available={communityAvailable.has(y)}
                  />
                ) : null}
                {pwcYears ? <PwcStar available={pwcYears.has(y)} /> : null}
              </div>
            ))}
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 9,
            color: '#467c9d',
          }}
        >
          {SLIDER_YEARS.map((y) => (
            <span
              key={y}
              style={{
                fontWeight: y === year ? 700 : 400,
                color: y === year ? '#002040' : '#467c9d',
              }}
            >
              {y.replace(/^20/, "'")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Tiny five-point star — filled gold when PWC program data exists for the
 *  year, hollow otherwise. Sits under the family dots. */
function PwcStar({ available }: { available: boolean }): React.JSX.Element {
  return (
    <svg width={7} height={7} viewBox="0 0 16 16" aria-hidden style={{ display: 'block' }}>
      <path
        d="M 8 1 L 10 6 L 15.2 6.3 L 11.1 9.5 L 12.5 14.6 L 8 11.7 L 3.5 14.6 L 4.9 9.5 L 0.8 6.3 L 6 6 Z"
        fill={available ? PWC_STAR : 'transparent'}
        stroke={available ? PWC_STAR : EMPTY_RING}
        strokeWidth={available ? 0 : 1.6}
      />
    </svg>
  );
}

function AvailabilityDot({
  color,
  available,
}: {
  color: string;
  available: boolean;
}): React.JSX.Element {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 5,
        height: 5,
        borderRadius: '50%',
        background: available ? color : 'transparent',
        border: available ? 'none' : `1px solid ${EMPTY_RING}`,
        boxSizing: 'border-box',
      }}
    />
  );
}
