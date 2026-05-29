'use client';

import IndicatorSelector from './IndicatorSelector';
import InSchoolServicesStub from './InSchoolServicesStub';
import Legend from './Legend';
import Logo from './Logo';
import YearBadge from './YearBadge';
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
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        borderRight: '1px solid #e5e9ee',
        background: '#f2f8ee',
        overflowY: 'auto',
        minHeight: 0,
      }}
    >
      {/* Logo — top of panel, larger, no subtitle. */}
      <header style={{ paddingBottom: 8, borderBottom: '1px solid #dde4ea' }}>
        <Logo />
      </header>

      {/* Indicators */}
      <Section title="Indicators">
        <IndicatorSelector indicators={indicators} />
      </Section>

      {/* PWC entry-point stub */}
      <InSchoolServicesStub />

      {/* Legend — visually separated from Indicators */}
      <SectionDivider />
      <Section title="Legend">
        {schoolIndicator || communityIndicator ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {schoolIndicator ? (
              <YearBadge
                family="school"
                indicator={schoolIndicator}
                displayYear={schoolYear}
                sliderYear={sliderYear}
              />
            ) : null}
            {communityIndicator ? (
              <YearBadge
                family="community"
                indicator={communityIndicator}
                displayYear={communityYear}
                sliderYear={sliderYear}
              />
            ) : null}
          </div>
        ) : null}
        <div style={{ marginTop: 8 }}>
          <Legend
            schoolIndicator={schoolNoData ? null : schoolIndicator}
            schoolDomain={schoolDomain}
            communityIndicator={communityNoData ? null : communityIndicator}
            communityDomain={communityDomain}
          />
        </div>
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
      </Section>
    </aside>
  );
}

/** Small consistent section wrapper — heading + body. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: '#002040',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

function SectionDivider(): React.JSX.Element {
  return <div style={{ borderTop: '1px solid #dde4ea', margin: '4px 0' }} />;
}
