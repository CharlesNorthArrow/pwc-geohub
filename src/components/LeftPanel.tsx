'use client';

import IndicatorSelector from './IndicatorSelector';
import InSchoolServicesStub from './InSchoolServicesStub';
import Legend from './Legend';
import YearBadge from './YearBadge';
import NoDataNotice from './NoDataNotice';
import type { IndicatorPublic } from '../contract/types';

interface Props {
  indicators: IndicatorPublic[];
  schoolIndicator: IndicatorPublic | null;
  schoolYear: string | null;
  schoolDomain: { min: number; max: number } | null;
  schoolNoData: boolean;
  communityIndicator: IndicatorPublic | null;
  communityYear: string | null;
  communityDomain: { min: number; max: number } | null;
  communityNoData: boolean;
}

export default function LeftPanel({
  indicators,
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
        gap: 16,
        padding: 12,
        borderRight: '1px solid #e5e9ee',
        background: '#f2f8ee',
        overflowY: 'auto',
        minHeight: 0,
      }}
    >
      <IndicatorSelector indicators={indicators} />

      <InSchoolServicesStub />

      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            color: '#002040',
            marginBottom: 6,
          }}
        >
          Legend
        </div>
        {(schoolIndicator && schoolYear) || (communityIndicator && communityYear) ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {schoolIndicator && schoolYear ? (
              <YearBadge family="school" indicator={schoolIndicator} displayYear={schoolYear} noData={schoolNoData} />
            ) : null}
            {communityIndicator && communityYear ? (
              <YearBadge
                family="community"
                indicator={communityIndicator}
                displayYear={communityYear}
                noData={communityNoData}
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
          {schoolNoData && schoolIndicator && schoolYear ? (
            <NoDataNotice family="school" indicatorLabel={schoolIndicator.label} year={schoolYear} />
          ) : null}
          {communityNoData && communityIndicator && communityYear ? (
            <NoDataNotice family="community" indicatorLabel={communityIndicator.label} year={communityYear} />
          ) : null}
        </div>
      </div>
    </aside>
  );
}
