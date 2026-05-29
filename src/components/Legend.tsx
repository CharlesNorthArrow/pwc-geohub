'use client';

import type { IndicatorPublic } from '../contract/types';
import { colorBinsFor, ENROLLMENT_BINS, type ColorBins } from '../map/encoding';

interface Props {
  schoolIndicator: IndicatorPublic | null;
  schoolDomain: { min: number; max: number } | null;
  communityIndicator: IndicatorPublic | null;
  communityDomain: { min: number; max: number } | null;
}

/**
 * Legend reads ONLY the active encoding — spec §6.6 matrix, "Legend" column.
 * The bin scales it shows are the same ones `<MapView/>` paints with, because
 * both call into `colorBinsFor` (see src/map/encoding.ts).
 */
export default function Legend({
  schoolIndicator,
  schoolDomain,
  communityIndicator,
  communityDomain,
}: Props): React.JSX.Element {
  if (!schoolIndicator && !communityIndicator) {
    return (
      <div style={{ fontSize: 11, color: '#467c9d', fontStyle: 'italic' }}>
        Pick an indicator to see the legend.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {schoolIndicator ? (
        <SchoolLegend
          indicator={schoolIndicator}
          bins={colorBinsFor(schoolIndicator, schoolDomain)}
        />
      ) : null}
      {communityIndicator ? (
        <CommunityLegend
          indicator={communityIndicator}
          bins={colorBinsFor(communityIndicator, communityDomain)}
        />
      ) : null}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        color: '#002040',
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

function SchoolLegend({
  indicator,
  bins,
}: {
  indicator: IndicatorPublic;
  bins: ColorBins;
}): React.JSX.Element {
  return (
    <div>
      <SectionTitle>School: {indicator.label}</SectionTitle>
      <ColorSwatches bins={bins} />
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, color: '#467c9d', marginBottom: 4 }}>Circle size = total enrollment</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          {ENROLLMENT_BINS.map((b) => (
            <div key={b.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
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
      </div>
      <PwcHaloLegend />
    </div>
  );
}

/** Phase 2: explains the halo symbology so users can read the map. */
function PwcHaloLegend(): React.JSX.Element {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, color: '#467c9d', marginBottom: 4 }}>PWC schools (halo)</div>
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
}: {
  indicator: IndicatorPublic;
  bins: ColorBins;
}): React.JSX.Element {
  return (
    <div>
      <SectionTitle>Community: {indicator.label}</SectionTitle>
      <ColorSwatches bins={bins} />
    </div>
  );
}

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
            }}
          />
          <span style={{ fontSize: 11, color: '#002040' }}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}
