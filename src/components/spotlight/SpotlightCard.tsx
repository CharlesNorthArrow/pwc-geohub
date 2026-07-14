'use client';

/**
 * Spotlight card — /spotlight/[dbn].
 *
 * Deep-linkable, standalone (no analyst chrome — only the Logo bar).
 * All composition state is URL state so a card is shareable exactly as
 * curated:
 *   ?mode=case|celebrate   — which output (default: case)
 *   &h=<headline>          — Comms' edited headline (absent = auto-suggest)
 *   &st=<id,id,id>         — school-tile overrides (absent = auto-selected)
 *   &ct=<id,id,id>         — community-tile overrides
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Logo from '../Logo';
import type { IndicatorPublic } from '../../contract/types';
import { EXPORT_SIZES, type SpotlightMode } from '../../spotlight/spotlightRanking';
import SpotlightSheet, { MODE_ACCENT, MODE_LABEL, type SpotlightHero } from './SpotlightSheet';
import { buildSpotlightModel, useSpotlightData, type TileOverrides } from './useSpotlightData';

export default function SpotlightCard({
  dbn,
  initialIndicators,
}: {
  dbn: string;
  initialIndicators: IndicatorPublic[];
}): React.JSX.Element {
  const [indicators] = useState(initialIndicators);
  const data = useSpotlightData(dbn, indicators);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const mode: SpotlightMode = searchParams.get('mode') === 'celebrate' ? 'celebrate' : 'case';
  const overrides: TileOverrides = useMemo(
    () => ({
      school: (searchParams.get('st') ?? '').split(',').filter(Boolean),
      community: (searchParams.get('ct') ?? '').split(',').filter(Boolean),
    }),
    [searchParams],
  );

  const model = useMemo(
    () => (data.loading || data.error ? null : buildSpotlightModel(data, indicators, dbn, mode, overrides)),
    [data, indicators, dbn, mode, overrides],
  );

  /* ----------------------------- URL helpers ----------------------------- */

  const setParams = (mutate: (p: URLSearchParams) => void): void => {
    const p = new URLSearchParams(searchParams.toString());
    mutate(p);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const setMode = (next: SpotlightMode): void => {
    setDraft(null);
    setParams((p) => {
      if (next === 'case') p.delete('mode');
      else p.set('mode', next);
      // Curation (tiles + headline) is mode-specific — switching re-ranks fresh.
      p.delete('st');
      p.delete('ct');
      p.delete('h');
    });
  };

  const swapTile = (section: 'school' | 'community', tileId: string): void => {
    if (!model) return;
    const ranking = section === 'school' ? model.schoolRanking : model.communityRanking;
    const displayedTiles = section === 'school' ? model.schoolTiles : model.communityTiles;
    const displayed = displayedTiles
      .filter((t) => t.kind === 'scored')
      .map((t) => (t.kind === 'scored' ? t.candidate.id : ''));
    const order = ranking.ranked.map((c) => c.id);
    const from = order.indexOf(tileId);
    if (from < 0) return;
    // Next-ranked candidate not already on the card (wraps around).
    let replacement: string | null = null;
    for (let step = 1; step <= order.length; step++) {
      const cand = order[(from + step) % order.length]!;
      if (!displayed.includes(cand)) {
        replacement = cand;
        break;
      }
    }
    if (!replacement) return;
    const next = displayed.map((id) => (id === tileId ? replacement! : id));
    setParams((p) => p.set(section === 'school' ? 'st' : 'ct', next.join(',')));
  };

  /* ------------------------------ headline ------------------------------- */

  // The textarea edits a LOCAL draft (typing must never wait on the router);
  // the draft commits to the URL debounced so the deep link stays shareable.
  const [draft, setDraft] = useState<string | null>(null);
  const urlHeadline = searchParams.get('h');
  const headline = draft ?? urlHeadline ?? model?.suggestedHeadline ?? '';

  useEffect(() => {
    if (draft == null) return;
    const t = window.setTimeout(() => {
      setParams((p) => {
        if (draft.trim() === '' || draft === model?.suggestedHeadline) p.delete('h');
        else p.set('h', draft);
      });
    }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  /* ------------------------------- exports ------------------------------- */

  const [exporting, setExporting] = useState<'portrait' | 'square' | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!exporting || !exportRef.current) return;
    let cancelled = false;
    const [w, h] = EXPORT_SIZES[exporting];
    // Wait a frame so the offscreen layout paints before capture.
    const t = window.setTimeout(async () => {
      try {
        const { default: html2canvas } = await import('html2canvas');
        if (cancelled || !exportRef.current) return;
        const canvas = await html2canvas(exportRef.current, {
          scale: 2,
          width: w,
          height: h,
          backgroundColor: '#ffffff',
          logging: false,
        });
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `spotlight-${dbn}-${mode}-${exporting}.png`;
        a.click();
      } catch (err) {
        console.warn('[Spotlight] PNG export failed', err);
        window.alert('PNG export failed — see console for details.');
      } finally {
        if (!cancelled) setExporting(null);
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [exporting, dbn, mode]);

  /* -------------------------------- hero --------------------------------- */

  const hero: SpotlightHero | null = model
    ? {
        schoolName: data.school?.school_name ?? data.profile?.school_name ?? dbn,
        dbn,
        borough: data.school?.borough ?? data.profile?.borough ?? null,
        grades: data.profile?.grades ?? (data.school?.grades_canonical.join(', ') || null),
        enrollment: data.profile?.total_enrollment ?? data.school?.total_enrollment ?? null,
        category: data.member?.category ?? data.program?.category ?? null,
        ntaName: data.ntaName,
        programFacts: [
          data.program?.arts_program_type ? `Arts residency: ${data.program.arts_program_type}` : null,
          data.program?.food_pantry ? 'Food pantry on site' : null,
          data.program?.laundry ? 'Laundry services on site' : null,
        ].filter((f): f is string => f != null),
      }
    : null;

  const accent = MODE_ACCENT[mode];
  const schoolExists = data.loading || data.school != null || data.profile != null;

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100dvh', background: '#f7f9fb', minHeight: 0 }}>
      <Logo />
      <main style={{ overflowY: 'auto', minHeight: 0, padding: '20px 20px 48px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          {/* toolbar: back link, mode toggle, export controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <Link href="/spotlight" style={{ color: '#467c9d', fontSize: 12, textDecoration: 'none' }}>
              ← Pick a different school
            </Link>
            <ModeToggle mode={mode} onChange={setMode} />
            {model ? <ExportControls dbn={dbn} mode={mode} onPng={setExporting} /> : <span />}
          </div>

          {data.error ? (
            <StatusBox text={`Failed to load data: ${data.error}`} tone="error" />
          ) : !schoolExists ? (
            <StatusBox
              text={`No school found for DBN "${dbn}".`}
              tone="error"
              extra={<Link href="/spotlight" style={{ color: '#027BC0' }}>Browse PWC schools</Link>}
            />
          ) : data.loading || !model || !hero ? (
            <StatusBox text="Loading school and community data…" tone="info" />
          ) : (
            <div style={{ background: 'white', border: '1px solid #e5e9ee', borderRadius: 10, padding: 24, boxShadow: '0 1px 3px rgba(0,32,64,0.06)' }}>
              <SpotlightSheet
                hero={hero}
                model={model}
                headline={headline}
                variant="screen"
                onSwap={swapTile}
                headlineEditor={{
                  value: headline,
                  onChange: setDraft,
                  onReset: () => {
                    setDraft(null);
                    setParams((p) => p.delete('h'));
                  },
                }}
              />
            </div>
          )}

          {model ? (
            <p style={{ fontSize: 11, color: '#8296a8', marginTop: 12 }}>
              Tiles are auto-selected outliers vs the citywide average, standardized across all PWC
              schools at each indicator&apos;s latest year. Use ⇄ swap to curate; the URL captures your
              edits, so copy it to share this exact card.
            </p>
          ) : null}
        </div>

        {/* Offscreen fixed-size export container — spec: never screenshot the
            responsive DOM; render the target dimensions and capture that. */}
        {exporting && model && hero ? (
          <div style={{ position: 'fixed', left: -20000, top: 0 }}>
            <div
              ref={exportRef}
              style={{
                width: EXPORT_SIZES[exporting][0],
                height: EXPORT_SIZES[exporting][1],
                background: 'white',
                borderTop: `14px solid ${accent}`,
                boxSizing: 'border-box',
                overflow: 'hidden',
              }}
            >
              <SpotlightSheet hero={hero} model={model} headline={headline} variant="export" />
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

/* ------------------------------ sub-pieces -------------------------------- */

function ModeToggle({ mode, onChange }: { mode: SpotlightMode; onChange: (m: SpotlightMode) => void }): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Spotlight mode"
      style={{ display: 'inline-flex', background: 'white', border: '1px solid #c5cdd6', borderRadius: 6, padding: 3, gap: 2 }}
    >
      {(['case', 'celebrate'] as const).map((m) => {
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(m)}
            style={{
              background: active ? MODE_ACCENT[m] : 'transparent',
              color: active ? 'white' : '#002040',
              border: 'none',
              padding: '5px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              whiteSpace: 'nowrap',
            }}
          >
            {MODE_LABEL[m]}
          </button>
        );
      })}
    </div>
  );
}

function ExportControls({
  dbn,
  mode,
  onPng,
}: {
  dbn: string;
  mode: SpotlightMode;
  onPng: (size: 'portrait' | 'square') => void;
}): React.JSX.Element {
  const printHref = (pages: 'one' | 'both'): string =>
    `/spotlight/${encodeURIComponent(dbn)}/print?mode=${mode}&pages=${pages}`;
  // Default export follows the mode: case → donor one-pager, celebrate → social image.
  const pngPrimary = mode === 'celebrate';
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <ExportBtn primary={pngPrimary} onClick={() => onPng('portrait')}>PNG 1080×1350</ExportBtn>
      <ExportBtn onClick={() => onPng('square')}>PNG 1080×1080</ExportBtn>
      <ExportLink primary={!pngPrimary} href={printHref('one')}>Donor one-pager (PDF)</ExportLink>
      <ExportLink href={printHref('both')}>Print both (2-page PDF)</ExportLink>
    </div>
  );
}

const exportBtnStyle = (primary?: boolean): React.CSSProperties => ({
  background: primary ? '#027BC0' : 'white',
  color: primary ? 'white' : '#027BC0',
  border: '1px solid #027BC0',
  borderRadius: 4,
  padding: '5px 10px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
});

function ExportBtn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} style={exportBtnStyle(primary)}>
      {children}
    </button>
  );
}

function ExportLink({ children, href, primary }: { children: React.ReactNode; href: string; primary?: boolean }): React.JSX.Element {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={exportBtnStyle(primary)}>
      {children}
    </a>
  );
}

function StatusBox({ text, tone, extra }: { text: string; tone: 'info' | 'error'; extra?: React.ReactNode }): React.JSX.Element {
  return (
    <div
      role="status"
      style={{
        background: tone === 'error' ? '#fdecea' : 'white',
        color: tone === 'error' ? '#c0392b' : '#467c9d',
        border: '1px solid #e5e9ee',
        borderRadius: 8,
        padding: '28px 20px',
        textAlign: 'center',
        fontSize: 13,
      }}
    >
      {text}
      {extra ? <div style={{ marginTop: 8 }}>{extra}</div> : null}
    </div>
  );
}
