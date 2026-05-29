'use client';

import IndicatorSelector from './IndicatorSelector';
import Legend from './Legend';
import Logo from './Logo';
import NoDataNotice from './NoDataNotice';
import type { IndicatorPublic } from '../contract/types';

interface Props {
  indicators: IndicatorPublic[];
  /** Current slider position (always set; spec §6.5 default = 2024-25). */
  sliderYear: string;
  schoolIndicator: IndicatorPublic | null;
  /** School layer's resolved year, or null when the slider year has no school data. */
  schoolYear: string | null;
  schoolDomain: { min: number; max: number } | null;
  schoolNoData: boolean;
  communityIndicator: IndicatorPublic | null;
  /** Community layer's resolved year (calendar year), or null when missing. */
  communityYear: string | null;
  communityDomain: { min: number; max: number } | null;
  communityNoData: boolean;
}

export default function LeftPanel({
  indicators,
  sliderYear,
  schoolIndicator,
  schoolYear,
  schoolDomain,
  schoolNoData,
  communityIndicator,
  communityYear,
  communityDomain,
  communityNoData,
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
            // Always pass the indicator itself — the legend renders the title
            // and falls back to "No values in range" when the domain is null
            // (the no-data case). The NoDataNotice below the legend is the
            // explicit surface for "no YYYY-YY data".
            schoolIndicator={schoolIndicator}
            schoolDomain={schoolDomain}
            schoolYear={schoolYear}
            communityIndicator={communityIndicator}
            communityDomain={communityDomain}
            communityYear={communityYear}
            sliderYear={sliderYear}
          />
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {schoolNoData && schoolIndicator ? (
              <NoDataNotice
                family="school"
                indicatorLabel={schoolIndicator.label}
                year={sliderYear}
              />
            ) : null}
            {communityNoData && communityIndicator ? (
              <NoDataNotice
                family="community"
                indicatorLabel={communityIndicator.label}
                year={sliderYear}
              />
            ) : null}
          </div>
        </section>
      </div>
    </aside>
  );
}

function SectionDivider(): React.JSX.Element {
  return <div style={{ borderTop: '1px solid #dde4ea', margin: '4px 0' }} />;
}
