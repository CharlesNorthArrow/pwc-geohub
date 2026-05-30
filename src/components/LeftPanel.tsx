'use client';

import IndicatorSelector from './IndicatorSelector';
import Legend from './Legend';
import Logo from './Logo';
import type { IndicatorPublic } from '../contract/types';
import type { SliderYear } from '../contract/year';

interface Props {
  indicators: IndicatorPublic[];
  /** Current slider position (always set; spec §6.5 default = 2024-25). */
  sliderYear: SliderYear;
  schoolIndicator: IndicatorPublic | null;
  /** School layer's resolved year, or null when the slider year has no school data. */
  schoolYear: string | null;
  schoolDomain: { min: number; max: number } | null;
  communityIndicator: IndicatorPublic | null;
  /** Community layer's resolved year (calendar year), or null when missing. */
  communityYear: string | null;
  communityDomain: { min: number; max: number } | null;
}

export default function LeftPanel({
  indicators,
  sliderYear,
  schoolIndicator,
  schoolYear,
  schoolDomain,
  communityIndicator,
  communityYear,
  communityDomain,
}: Props): React.JSX.Element {
  return (
    <aside
      style={{
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        background: '#f2f8ee',
        borderRight: '1px solid #e5e9ee',
        minHeight: 0,
      }}
    >
      {/* Logo — pinned (outside the scroll region). */}
      <Logo />

      {/* Scrollable content */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 12,
          overflowY: 'auto',
          minHeight: 0,
        }}
      >
        {/* Indicators — no section title; the two family headers inside the
         *  selector are already self-explanatory. */}
        <IndicatorSelector indicators={indicators} />

        {/* Legend — visually separated from Indicators */}
        <SectionDivider />
        <section>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: '#002040',
              marginBottom: 8,
            }}
          >
            Legend
          </div>
          <Legend
            // The YearBadge pill at the top of each family's legend section
            // is the explicit surface for "no YYYY-YY data" and offers the
            // jump-to-nearest affordance.
            schoolIndicator={schoolIndicator}
            schoolDomain={schoolDomain}
            schoolYear={schoolYear}
            communityIndicator={communityIndicator}
            communityDomain={communityDomain}
            communityYear={communityYear}
            sliderYear={sliderYear}
          />
        </section>
      </div>
    </aside>
  );
}

function SectionDivider(): React.JSX.Element {
  return <div style={{ borderTop: '1px solid #dde4ea', margin: '4px 0' }} />;
}
