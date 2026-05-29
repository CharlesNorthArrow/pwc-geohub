'use client';

import { useHubStore } from '../store/useHubStore';
import { SLIDER_YEARS, type SliderYear } from '../contract/year';

/**
 * Spec §6.5 — 5-year time slider. Native `<input type="range">` for
 * accessibility (keyboard ←/→ + screen-reader value announcement) wrapped
 * in tick labels. Per Q5, the slider stops at 2024-25 for public indicators;
 * PWC program data reaches 2025-26 but isn't exposed via the slider in
 * Phase 4 (Phase 5 KPI cards will surface it independently).
 *
 * Single source of truth: writes only `year`. Both layers resolve
 * availability against the same value; the 🗓️ branch fires per layer.
 */
export default function TimeSlider(): React.JSX.Element {
  const year = useHubStore((s) => s.year);
  const setYear = useHubStore((s) => s.setYear);

  const idx = Math.max(0, SLIDER_YEARS.indexOf(year));

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
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#467c9d' }}>
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
