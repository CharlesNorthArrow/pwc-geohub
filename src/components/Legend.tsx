'use client';

import type { IndicatorPublic } from '../contract/types';
import type { SliderYear } from '../contract/year';
import { colorBinsFor, ENROLLMENT_BINS, type ColorBins } from '../map/encoding';
import { useHubStore } from '../store/useHubStore';
import YearBadge from './YearBadge';

interface Props {
  schoolIndicator: IndicatorPublic | null;
  schoolDomain: { min: number; max: number } | null;
  /** Full numeric value distribution — fed to `colorBinsFor` so quantile bins
   *  in the legend match the map. */
  schoolValues: ReadonlyArray<number>;
  /** Resolved school year (or null = no data for slider year). */
  schoolYear: string | null;
  communityIndicator: IndicatorPublic | null;
  communityDomain: { min: number; max: number } | null;
  communityValues: ReadonlyArray<number>;
  /** Resolved community year (or null = no data for slider year). */
  communityYear: string | null;
  /** Current slider position — drives "no YYYY-YY data" copy when missing. */
  sliderYear: SliderYear;
}

/**
 * Legend reads ONLY the active encoding — spec §6.6 matrix, "Legend" column.
 * The bin scales it shows are the same ones `<MapView/>` paints with, because
 * both call into `colorBinsFor` (see src/map/encoding.ts).
 */
export default function Legend({
  schoolIndicator,
  schoolDomain,
  schoolValues,
  schoolYear,
  communityIndicator,
  communityDomain,
  communityValues,
  communityYear,
  sliderYear,
}: Props): React.JSX.Element {
  // Pulled from the store so YearBadge can offer one-click "jump to nearest
  // available year" without prop-drilling through every legend section.
  const setYear = useHubStore((s) => s.setYear);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {schoolIndicator ? (
        <SchoolLegend
          indicator={schoolIndicator}
          bins={colorBinsFor(schoolIndicator, schoolDomain, schoolValues)}
          displayYear={schoolYear}
          sliderYear={sliderYear}
          onJump={setYear}
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
          bins={colorBinsFor(communityIndicator, communityDomain, communityValues)}
          displayYear={communityYear}
          sliderYear={sliderYear}
          onJump={setYear}
        />
      ) : null}
    </div>
  );
}

/* PWC brand palette — sourced from CLAUDE.md and `MapView`. Kept here so the
 * legend stays in lockstep with what the map actually paints. */
/** Muted slate-blue (paired with 0.4 opacity) — matches the map's
 *  baseline non-PWC dots. */
const BASELINE_FILL = '#7BA7C9';
const BASELINE_NONPWC_OPACITY = 0.4;
const PWC_MAGENTA = '#903090';  // Anchor (star)
const PWC_GREEN = '#A0B000';    // Healing Arts (diamond)
const PWC_BLUE = '#027BC0';     // pwc_other (circle with blue halo)
/** Community-family accent — distinct from Healing Arts. Stays orange. */
const COMMUNITY_ACCENT = '#F0901F';

/** Tiny ALL-CAPS family label (School / Community). Colored per family so
 *  the legend's accent matches the per-family slider dots above. */
function FamilyTag({
  children,
  family = 'school',
}: {
  children: React.ReactNode;
  family?: 'school' | 'community';
}): React.JSX.Element {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: family === 'community' ? COMMUNITY_ACCENT : '#467c9d',
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
  onJump,
}: {
  family: 'school' | 'community';
  indicator: IndicatorPublic;
  displayYear: string | null;
  sliderYear: SliderYear;
  onJump?: (year: SliderYear) => void;
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
        onJump={onJump}
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
      <Caption>Symbol &amp; color</Caption>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <ShapeRow
          shape="circle"
          fill={BASELINE_FILL}
          opacity={BASELINE_NONPWC_OPACITY}
          label="Other NYC school"
        />
        <ShapeRow
          shape="star"
          fill={PWC_MAGENTA}
          strokeColor="#ffffff"
          strokeWidth={1.5}
          label="PWC Anchor school"
        />
        <ShapeRow
          shape="diamond"
          fill={PWC_GREEN}
          strokeColor="#ffffff"
          strokeWidth={1.5}
          label="PWC Healing Arts school"
        />
        <ShapeRow
          shape="circle"
          fill={PWC_BLUE}
          strokeColor={PWC_BLUE}
          strokeWidth={2}
          label="PWC (other program)"
        />
      </div>
      <Caption>Symbol size = total enrollment</Caption>
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
                opacity: BASELINE_NONPWC_OPACITY,
              }}
            />
            <span style={{ fontSize: 9, color: '#002040' }}>{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Inline SVG symbol — circle / star / diamond — rendered at a fixed 14 px box
 *  so the legend rows align cleanly regardless of which shape they show. */
function ShapeRow({
  shape,
  fill,
  opacity = 1,
  strokeColor,
  strokeWidth = 0,
  label,
}: {
  shape: 'circle' | 'star' | 'diamond';
  fill: string;
  opacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  label: string;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <ShapeIcon
        shape={shape}
        fill={fill}
        opacity={opacity}
        strokeColor={strokeColor}
        strokeWidth={strokeWidth}
      />
      <span style={{ fontSize: 11, color: '#002040' }}>{label}</span>
    </div>
  );
}

function ShapeIcon({
  shape,
  fill,
  opacity = 1,
  strokeColor,
  strokeWidth = 0,
  size = 16,
}: {
  shape: 'circle' | 'star' | 'diamond';
  fill: string;
  opacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  size?: number;
}): React.JSX.Element {
  const stroke = strokeWidth > 0 && strokeColor ? strokeColor : 'none';
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      width={size}
      height={size}
      style={{ overflow: 'visible', opacity, flex: 'none' }}
    >
      {shape === 'circle' ? (
        <circle cx={10} cy={10} r={7} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      ) : shape === 'star' ? (
        <polygon
          points="10,1 12.4,7.4 19,7.4 13.8,11.6 15.9,18 10,14 4.1,18 6.2,11.6 1,7.4 7.6,7.4"
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      ) : (
        <polygon
          points="10,2 18,10 10,18 2,10"
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function SchoolLegend({
  indicator,
  bins,
  displayYear,
  sliderYear,
  onJump,
}: {
  indicator: IndicatorPublic;
  bins: ColorBins;
  displayYear: string | null;
  sliderYear: SliderYear;
  onJump?: (year: SliderYear) => void;
}): React.JSX.Element {
  return (
    <div>
      <FamilyTag>School</FamilyTag>
      <IndicatorTitleRow
        family="school"
        indicator={indicator}
        displayYear={displayYear}
        sliderYear={sliderYear}
        onJump={onJump}
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

/** Hollow ring + label — mirrors MapView's no-data treatment in indicator
 *  mode (grey stroke, transparent fill, 1.5px width). */
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
          border: '1.5px solid #7a8896',
          boxSizing: 'border-box',
        }}
      />
      <span style={{ fontSize: 11, color: '#002040' }}>No data</span>
    </div>
  );
}

/**
 * Indicator-mode PWC legend — in this mode the symbol fill IS the indicator
 * color, and the outline retains the PWC group color so users can still spot
 * Anchor vs Healing Arts at a glance. We render the outlined-shape pattern.
 */
function PwcHaloLegend(): React.JSX.Element {
  return (
    <div style={{ marginTop: 12 }}>
      <Caption>PWC schools (outline)</Caption>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
        <ShapeRow
          shape="star"
          fill="#dde4ea"
          strokeColor={PWC_MAGENTA}
          strokeWidth={2}
          label="Anchor (core school)"
        />
        <ShapeRow
          shape="diamond"
          fill="#dde4ea"
          strokeColor={PWC_GREEN}
          strokeWidth={2}
          label="Healing Arts"
        />
        <ShapeRow
          shape="circle"
          fill="#dde4ea"
          strokeColor={PWC_BLUE}
          strokeWidth={2}
          label="PWC (other program)"
        />
      </div>
    </div>
  );
}

function CommunityLegend({
  indicator,
  bins,
  displayYear,
  sliderYear,
  onJump,
}: {
  indicator: IndicatorPublic;
  bins: ColorBins;
  displayYear: string | null;
  sliderYear: SliderYear;
  onJump?: (year: SliderYear) => void;
}): React.JSX.Element {
  return (
    <div>
      <FamilyTag family="community">Community</FamilyTag>
      <IndicatorTitleRow
        family="community"
        indicator={indicator}
        displayYear={displayYear}
        sliderYear={sliderYear}
        onJump={onJump}
      />
      <Caption>Tract color</Caption>
      <ColorSwatches bins={bins} />
      {bins.type === 'categorical' ? (
        <div style={{ fontSize: 10, color: '#467c9d', marginTop: 4, lineHeight: 1.35 }}>
          Color saturation reflects the predominant group's share of the
          tract — stronger color = larger majority.
        </div>
      ) : null}
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
