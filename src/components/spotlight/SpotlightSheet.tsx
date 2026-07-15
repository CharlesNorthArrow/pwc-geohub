'use client';

/**
 * SpotlightSheet — the presentational card, rendered identically by three
 * consumers: the interactive screen view, the fixed-size PNG export layout,
 * and the print (PDF) pages. Build once, theme per mode (spec §4).
 *
 * Variants only change scale/spacing; structure is identical:
 *   hero → "The School" (3 tiles) → "The Surrounding Community" (3 tiles)
 *   → headline.
 */

import type { PwcCategory } from '../../contract/types';
import { formatValue } from '../../lib/format';
import type { SpotlightMode } from '../../spotlight/spotlightRanking';
import type { AnyTile, SpotlightModel } from './useSpotlightData';

export const MODE_ACCENT: Record<SpotlightMode, string> = {
  case: '#b5294a',
  celebrate: '#0f8a6a',
};

export const MODE_LABEL: Record<SpotlightMode, string> = {
  case: 'Case for support',
  celebrate: 'Celebrate',
};

const PWC_BLUE = '#027BC0';
const NAVY = '#002040';
const MUTED = '#467c9d';

export interface SpotlightHero {
  schoolName: string;
  dbn: string;
  borough: string | null;
  grades: string | null;
  enrollment: number | null;
  category: PwcCategory | null;
  ntaName: string | null;
  /** Notable program facts for the hero meta line (arts residency, pantry…). */
  programFacts: string[];
}

export type SheetVariant = 'screen' | 'export' | 'print';

export function categoryTag(category: PwcCategory | null): { text: string; color: string } {
  switch (category) {
    case 'anchor': return { text: 'PWC Anchor school', color: '#903090' };
    case 'healing_arts': return { text: 'PWC Healing Arts school', color: '#A0B000' };
    case 'both': return { text: 'PWC Anchor + Healing Arts school', color: '#903090' };
    case 'pwc_other': return { text: 'PWC partner school', color: PWC_BLUE };
    default: return { text: 'NYC public school', color: MUTED };
  }
}

export default function SpotlightSheet({
  hero,
  model,
  headline,
  variant,
  onSwap,
  headlineEditor,
}: {
  hero: SpotlightHero;
  model: SpotlightModel;
  headline: string;
  variant: SheetVariant;
  /** Screen-only: swap a tile for the next-ranked candidate. */
  onSwap?: (section: 'school' | 'community', tileId: string) => void;
  /** Screen-only: editable headline field replaces the static banner. */
  headlineEditor?: { value: string; onChange: (v: string) => void; onReset: () => void };
}): React.JSX.Element {
  const accent = MODE_ACCENT[model.mode];
  const s = variant === 'export' ? 1.5 : 1; // export canvas is 1080px wide — scale type up
  const tag = categoryTag(hero.category);

  const meta: string[] = [
    `DBN ${hero.dbn}`,
    hero.borough ?? '',
    hero.grades ? `Grades ${hero.grades}` : '',
    hero.enrollment != null ? `${formatValue(hero.enrollment, 'integer')} students` : '',
  ].filter(Boolean);

  return (
    <div
      style={{
        background: 'white',
        color: NAVY,
        display: 'flex',
        flexDirection: 'column',
        gap: 18 * s,
        padding: variant === 'screen' ? 0 : 36 * s,
        height: variant === 'screen' ? undefined : '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* ------------------------------- hero ------------------------------- */}
      <header
        style={{
          borderBottom: `${3 * s}px solid ${accent}`,
          paddingBottom: 12 * s,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12 * s,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 * s, flexWrap: 'wrap' }}>
            <span
              style={{
                background: tag.color,
                color: 'white',
                borderRadius: 999,
                padding: `${3 * s}px ${10 * s}px`,
                fontSize: 11 * s,
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              {tag.text}
            </span>
            <span
              style={{
                color: accent,
                fontSize: 11 * s,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              {MODE_LABEL[model.mode]}
            </span>
          </div>
          <h1 style={{ fontSize: 30 * s, fontWeight: 800, margin: `${10 * s}px 0 ${6 * s}px`, lineHeight: 1.08 }}>
            {hero.schoolName}
          </h1>
          <div style={{ fontSize: 12.5 * s, color: MUTED }}>{meta.join(' · ')}</div>
          {hero.programFacts.length > 0 ? (
            <div style={{ display: 'flex', gap: 6 * s, flexWrap: 'wrap', marginTop: 8 * s }}>
              {hero.programFacts.map((f) => (
                <span
                  key={f}
                  style={{
                    border: `1px solid ${PWC_BLUE}`,
                    color: PWC_BLUE,
                    borderRadius: 999,
                    padding: `${2 * s}px ${9 * s}px`,
                    fontSize: 11 * s,
                    fontWeight: 600,
                  }}
                >
                  {f}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>
            so html2canvas and the print pipeline capture it without Next's
            image optimizer in the way. */}
        <img
          src="/brand/PWC-Logo.png"
          alt="Partnership with Children"
          style={{ height: 40 * s, width: 'auto', flexShrink: 0, marginTop: 2 * s }}
        />
      </header>

      {/* --------------------------- school section -------------------------- */}
      <Section title="The School" accent={accent} s={s}>
        <TileRow tiles={model.schoolTiles} accent={accent} s={s} variant={variant}
          onSwap={onSwap ? (id) => onSwap('school', id) : undefined} />
      </Section>

      {/* ------------------------- community section ------------------------- */}
      <Section
        title={`The Surrounding Community${hero.ntaName ? ` (${hero.ntaName})` : ' (NTA)'}`}
        accent={accent}
        s={s}
        note={model.communityNeutral
          ? 'No community measure genuinely outperforms the citywide average — shown as neutral context, not spin.'
          : undefined}
      >
        <TileRow tiles={model.communityTiles} accent={accent} s={s} variant={variant}
          onSwap={onSwap ? (id) => onSwap('community', id) : undefined} />
      </Section>

      {/* ------------------------------ headline ----------------------------- */}
      <div
        style={{
          background: `${accent}12`,
          borderLeft: `${4 * s}px solid ${accent}`,
          borderRadius: 6,
          padding: `${12 * s}px ${14 * s}px`,
          marginTop: 'auto',
        }}
      >
        {headlineEditor ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Headline — edit before sharing
              </span>
              <button
                type="button"
                onClick={headlineEditor.onReset}
                style={{ background: 'none', border: 'none', color: MUTED, fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
              >
                Reset to suggestion
              </button>
            </div>
            <textarea
              value={headlineEditor.value}
              onChange={(e) => headlineEditor.onChange(e.target.value)}
              rows={2}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                border: `1px solid ${accent}55`,
                borderRadius: 4,
                padding: '8px 10px',
                fontSize: 15,
                fontWeight: 600,
                color: NAVY,
                fontFamily: 'inherit',
                resize: 'vertical',
                background: 'white',
              }}
            />
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 16 * s, fontWeight: 700, lineHeight: 1.35 }}>{headline}</p>
        )}
      </div>

      {/* footer brand line (export/print carry attribution) */}
      {variant !== 'screen' ? (
        <div style={{ fontSize: 10 * s, color: MUTED, display: 'flex', justifyContent: 'space-between' }}>
          <span>Partnership with Children · PWC Geospatial Hub</span>
          <span>Benchmarks: citywide averages at each indicator&apos;s latest year</span>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------- pieces ----------------------------------- */

function Section({
  title,
  accent,
  s,
  note,
  children,
}: {
  title: string;
  accent: string;
  s: number;
  note?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section>
      <h2
        style={{
          fontSize: 12 * s,
          fontWeight: 800,
          color: accent,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          margin: `0 0 ${8 * s}px`,
        }}
      >
        {title}
      </h2>
      {note ? (
        <p style={{ fontSize: 11 * s, color: MUTED, margin: `0 0 ${8 * s}px`, fontStyle: 'italic' }}>{note}</p>
      ) : null}
      {children}
    </section>
  );
}

function TileRow({
  tiles,
  accent,
  s,
  variant,
  onSwap,
}: {
  tiles: AnyTile[];
  accent: string;
  s: number;
  variant: SheetVariant;
  onSwap?: (tileId: string) => void;
}): React.JSX.Element {
  if (tiles.length === 0) {
    return <p style={{ fontSize: 12 * s, color: MUTED, margin: 0 }}>No data available for this section.</p>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, tiles.length)}, 1fr)`, gap: 10 * s }}>
      {tiles.map((t) => (
        <Tile key={t.kind === 'scored' ? t.candidate.id : t.id} tile={t} accent={accent} s={s} variant={variant} onSwap={onSwap} />
      ))}
    </div>
  );
}

function Tile({
  tile,
  accent,
  s,
  variant,
  onSwap,
}: {
  tile: AnyTile;
  accent: string;
  s: number;
  variant: SheetVariant;
  onSwap?: (tileId: string) => void;
}): React.JSX.Element {
  const scored = tile.kind === 'scored';
  const big = scored ? formatValue(tile.candidate.value, tile.candidate.format) : tile.display;
  const label = scored ? tile.candidate.label : tile.label;
  const sentence = tile.sentence;
  const neutral = !scored || !tile.candidate.directionMatched;
  const id = scored ? tile.candidate.id : tile.id;

  return (
    <div
      style={{
        position: 'relative',
        border: `1px solid ${neutral ? '#c5cdd6' : `${accent}66`}`,
        borderTop: `${3 * s}px solid ${neutral ? '#c5cdd6' : accent}`,
        borderRadius: 8,
        padding: `${12 * s}px ${12 * s}px ${10 * s}px`,
        background: 'white',
        display: 'flex',
        flexDirection: 'column',
        gap: 4 * s,
        minHeight: 96 * s,
      }}
    >
      {scored && tile.topOutlier ? (
        <span
          style={{
            position: 'absolute',
            top: -1,
            right: 10,
            transform: 'translateY(-55%)',
            background: '#F0901F',
            color: 'white',
            borderRadius: 999,
            fontSize: 9 * s,
            fontWeight: 800,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            padding: `${2 * s}px ${8 * s}px`,
          }}
        >
          Top outlier
        </span>
      ) : null}
      <div style={{ fontSize: 26 * s, fontWeight: 800, color: neutral ? NAVY : accent, lineHeight: 1, wordBreak: 'break-word' }}>
        {big}
      </div>
      <div style={{ fontSize: 12 * s, fontWeight: 700, color: NAVY, lineHeight: 1.2 }}>{label}</div>
      <div style={{ fontSize: 10.5 * s, color: MUTED, lineHeight: 1.35 }}>{sentence}</div>
      {variant === 'screen' && onSwap && scored && tile.canSwap ? (
        <button
          type="button"
          onClick={() => onSwap(id)}
          title="Swap for the next-ranked candidate"
          aria-label={`Swap ${label} for the next-ranked candidate`}
          style={{
            alignSelf: 'flex-end',
            marginTop: 'auto',
            background: 'white',
            border: '1px solid #c5cdd6',
            borderRadius: 4,
            color: MUTED,
            fontSize: 10,
            padding: '2px 8px',
            cursor: 'pointer',
          }}
        >
          ⇄ swap
        </button>
      ) : null}
    </div>
  );
}
