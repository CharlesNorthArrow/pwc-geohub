'use client';

import type { IndicatorPublic } from '../contract/types';
import { colorBinsFor, ENROLLMENT_BINS, type ColorBins } from '../map/encoding';
import YearBadge from './YearBadge';

interface Props {
  schoolIndicator: IndicatorPublic | null;
  schoolDomain: { min: number; max: number } | null;
  /** Resolved school year (or null = no data for slider year). */
  schoolYear: string | null;
  communityIndicator: IndicatorPublic | null;
  communityDomain: { min: number; max: number } | null;
  /** Resolved community year (or null = no data for slider year). */
  communityYear: string | null;
  /** Current slider position — drives "no YYYY-YY data" copy when missing. */
  sliderYear: string;
}

/**
 * Legend reads ONLY the active encoding — spec §6.6 matrix, "Legend" column.
 * The bin scales it shows are the same ones `<MapView/>` paints with, because
 * both call into `colorBinsFor` (see src/map/encoding.ts).
 */
export default function Legend({
  schoolIndicator,
  schoolDomain,
  schoolYear,
  communityIndicator,
  communityDomain,
  communityYear,
  sliderYear,
}: Props): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {schoolIndicator ? (
        <SchoolLegend
          indicator={schoolIndicator}
          bins={colorBinsFor(schoolIndicator, schoolDomain)}
          displayYear={schoolYear}
          sliderYear={sliderYear}
        />
      ) : (
        // No school indicator picked → the map renders the baseline (unicolor
        // dots sized by enrollment, with PWC dots filled in their category
        // color). Show that as the school-family legend.
        <BaselineSchoolLegend />
      )}
      {communityIndicator ? (
        <CommunityLegend
          indicator={communityIndicator}
          bins={colorBinsFor(communityIndicator, communityDomain)}
          displayYear={communityYear}
          sliderYear={sliderYear}
        />
      ) : null}
    </div>
  );
}

/* PWC brand palette — sourced from CLAUDE.md and `MapView`. Kept here so the
 * legend stays in lockstep with what the map actually paints. */
const BASELINE_FILL = '#467c9d';
const PWC_MAGENTA = '#903090';
const PWC_ORANGE = '#F0901F';
const PWC_BLUE = '#027BC0';

/** Tiny ALL-CAPS family label (School / Community). */
function FamilyTag({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: '#467c9d',
        marginBottom: 2,
      }}
    >
      {children}
    </div>
  );
}

/** Larger indicator title + inline year badge. */
function IndicatorTitleRow({
  family,
  indicator,
  displayYear,
  sliderYear,
}: {
  family: 'school' | 'community';
  indicator: IndicatorPublic;
  displayYear: string | null;
  sliderYear: string;
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        flexWrap: 'wrap',
        marginBottom: 6,
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: '#002040',
          lineHeight: 1.25,
        }}
      >
        {indicator.short_label ?? indicator.label}
      </span>
      <YearBadge
        family={family}
        indicator={indicator}
        displayYear={displayYear}
        sliderYear={sliderYear}
      />
    </div>
  );
}

/** Smaller subdued caption between the title and the swatches. */
function Caption({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ fontSize: 10, color: '#467c9d', marginTop: 8, marginBottom: 4 }}>
      {children}
    </div>
  );
}

function BaselineSchoolLegend(): React.JSX.Element {
  return (
    <div>
      <FamilyTag>School</FamilyTag>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: '#002040',
          lineHeight: 1.25,
          marginBottom: 6,
        }}
      >
        All NYC schools
      </div>
      <Caption>Circle color</Caption>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <BaselineDotRow color={BASELINE_FILL} label="Other NYC school" />
        <BaselineDotRow color={PWC_MAGENTA} label="PWC Anchor school" />
        <BaselineDotRow color={PWC_ORANGE} label="PWC Healing Arts school" />
        <BaselineDotRow
          color={PWC_MAGENTA}
          strokeColor={PWC_ORANGE}
          strokeWidth={2}
          label="Both (Anchor + Healing Arts)"
        />
        <BaselineDotRow color={PWC_BLUE} label="Other PWC program school" />
      </div>
      <Caption>Circle size = total enrollment</Caption>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
        {ENROLLMENT_BINS.map((b) => (
          <div
            key={b.label}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
          >
            <span
              style={{
                display: 'inline-block',
                width: b.radius * 2,
                height: b.radius * 2,
                borderRadius: '50%',
                background: BASELINE_FILL,
                opacity: 0.85,
              }}
            />
            <span style={{ fontSize: 9, color: '#002040' }}>{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BaselineDotRow({
  color,
  strokeColor,
  strokeWidth = 0,
  label,
}: {
  color: string;
  strokeColor?: string;
  strokeWidth?: number;
  label: string;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: color,
          border: strokeWidth > 0 && strokeColor ? `${strokeWidth}px solid ${strokeColor}` : 'none',
          boxSizing: 'content-box',
        }}
      />
      <span style={{ fontSize: 11, color: '#002040' }}>{label}</span>
    </div>
  );
}

function SchoolLegend({
  indicator,
  bins,
  displayYear,
  sliderYear,
}: {
  indicator: IndicatorPublic;
  bins: ColorBins;
  displayYear: string | null;
  sliderYear: string;
}): React.JSX.Element {
  return (
    <div>
      <FamilyTag>School</FamilyTag>
      <IndicatorTitleRow
        family="school"
        indicator={indicator}
        displayYear={displayYear}
        sliderYear={sliderYear}
      />
      <Caption>Circle color</Caption>
      <ColorSwatches bins={bins} />
      <NoDataRow />
      <Caption>Circle size = total enrollment</Caption>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
        {ENROLLMENT_BINS.map((b) => (
          <div
            key={b.label}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
          >
            <span
              style={{
                display: 'inline-block',
                width: b.radius * 2,
                height: b.radius * 2,
                borderRadius: '50%',
                background: '#467c9d',
                opacity: 0.7,
              }}
            />
            <span style={{ fontSize: 9, color: '#002040' }}>{b.label}</span>
          </div>
        ))}
      </div>
      <PwcHaloLegend />
    </div>
  );
}

/** Hollow ring + label — pairs with MapView's no-data treatment in
 *  indicator mode. Brand-blue stroke at the same width the map draws (1.5px). */
function NoDataRow(): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: 'transparent',
          border: '1.5px solid #467c9d',
          boxSizing: 'border-box',
        }}
      />
      <span style={{ fontSize: 11, color: '#002040' }}>No data</span>
    </div>
  );
}

/** Phase 2: explains the halo symbology so users can read the map. */
function PwcHaloLegend(): React.JSX.Element {
  return (
    <div style={{ marginTop: 12 }}>
      <Caption>PWC schools (halo)</Caption>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
        <HaloRow color="#903090" label="Anchor (core school)" rings={1} />
        <HaloRow color="#F0901F" label="Healing Arts" rings={1} />
        <HaloRow color="#903090" label="Both (Anchor ∩ Healing Arts)" rings={2} secondColor="#F0901F" />
      </div>
    </div>
  );
}

function HaloRow({
  color,
  secondColor,
  label,
  rings,
}: {
  color: string;
  secondColor?: string;
  label: string;
  rings: 1 | 2;
}): React.JSX.Element {
  // Stacked rings rendered with nested boxes so a single CSS rule handles both
  // the one-ring and two-ring case without an SVG.
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ position: 'relative', width: 22, height: 22, display: 'inline-block' }}>
        <span
          style={{
            position: 'absolute',
            inset: rings === 2 ? 1 : 4,
            borderRadius: '50%',
            border: `2px solid ${rings === 2 ? secondColor ?? color : color}`,
          }}
        />
        {rings === 2 ? (
          <span
            style={{
              position: 'absolute',
              inset: 5,
              borderRadius: '50%',
              border: `2px solid ${color}`,
            }}
          />
        ) : null}
        <span
          style={{
            position: 'absolute',
            inset: 8,
            borderRadius: '50%',
            background: '#467c9d',
            opacity: 0.5,
          }}
        />
      </span>
      <span style={{ color: '#002040' }}>{label}</span>
    </div>
  );
}

function CommunityLegend({
  indicator,
  bins,
  displayYear,
  sliderYear,
}: {
  indicator: IndicatorPublic;
  bins: ColorBins;
  displayYear: string | null;
  sliderYear: string;
}): React.JSX.Element {
  return (
    <div>
      <FamilyTag>Community</FamilyTag>
      <IndicatorTitleRow
        family="community"
        indicator={indicator}
        displayYear={displayYear}
        sliderYear={sliderYear}
      />
      <Caption>Tract color</Caption>
      <ColorSwatches bins={bins} />
    </div>
  );
}

/** Slightly-rounded swatch corners (per UX request — softens the legend). */
const SWATCH_RADIUS = 4;

function ColorSwatches({ bins }: { bins: ColorBins }): React.JSX.Element {
  if (bins.type === 'none') {
    return <div style={{ fontSize: 11, color: '#999' }}>No values in range.</div>;
  }
  if (bins.type === 'categorical') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {bins.categories.map((cat) => (
          <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                display: 'inline-block',
                width: 14,
                height: 14,
                background: bins.colorFor(cat),
                border: '1px solid rgba(0,0,0,0.1)',
                borderRadius: SWATCH_RADIUS,
              }}
            />
            <span style={{ fontSize: 11, color: '#002040' }}>{cat}</span>
          </div>
        ))}
      </div>
    );
  }
  const labels = [
    `≤ ${bins.format(bins.edges[0])}`,
    `${bins.format(bins.edges[0])} – ${bins.format(bins.edges[1])}`,
    `${bins.format(bins.edges[1])} – ${bins.format(bins.edges[2])}`,
    `${bins.format(bins.edges[2])} – ${bins.format(bins.edges[3])}`,
    `> ${bins.format(bins.edges[3])}`,
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {bins.ramp.map((color, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              display: 'inline-block',
              width: 14,
              height: 14,
              background: color,
              border: '1px solid rgba(0,0,0,0.1)',
              borderRadius: SWATCH_RADIUS,
            }}
          />
          <span style={{ fontSize: 11, color: '#002040' }}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}
