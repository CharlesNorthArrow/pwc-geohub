'use client';

/**
 * Print view — /spotlight/[dbn]/print?mode=case|celebrate&pages=one|both
 *
 * The PDF pipeline: a dedicated letter/A4 layout with an @media print
 * stylesheet driven through the browser's print dialog ("Save as PDF") —
 * crisp, selectable text with no rasterization or PDF library.
 *
 * `pages=both` stacks a Case-for-support page and a Celebrate page with a
 * page break between them (donor site-visit packets). Tile/headline
 * curation from the card (`h`, `st`, `ct`) applies to the page whose mode
 * matches `mode`; the other page auto-ranks.
 */

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import type { IndicatorPublic } from '../../contract/types';
import type { SpotlightMode } from '../../spotlight/spotlightRanking';
import SpotlightSheet, { MODE_LABEL, type SpotlightHero } from './SpotlightSheet';
import { buildSpotlightModel, useSpotlightData, type TileOverrides } from './useSpotlightData';

const PRINT_CSS = `
@page { size: letter; margin: 0.5in; }
@media print {
  .spotlight-print-toolbar { display: none !important; }
  .spotlight-print-page { box-shadow: none !important; margin: 0 !important; border: none !important; }
  .spotlight-print-page + .spotlight-print-page { page-break-before: always; }
  body { overflow: visible !important; }
}
`;

export default function SpotlightPrint({
  dbn,
  initialIndicators,
}: {
  dbn: string;
  initialIndicators: IndicatorPublic[];
}): React.JSX.Element {
  const data = useSpotlightData(dbn, initialIndicators);
  const searchParams = useSearchParams();

  const primaryMode: SpotlightMode = searchParams.get('mode') === 'celebrate' ? 'celebrate' : 'case';
  const both = searchParams.get('pages') === 'both';
  const urlHeadline = searchParams.get('h');

  const pages = useMemo(() => {
    if (data.loading || data.error) return null;
    const overrides: TileOverrides = {
      school: (searchParams.get('st') ?? '').split(',').filter(Boolean),
      community: (searchParams.get('ct') ?? '').split(',').filter(Boolean),
    };
    const modes: SpotlightMode[] = both
      ? primaryMode === 'case' ? ['case', 'celebrate'] : ['celebrate', 'case']
      : [primaryMode];
    return modes.map((m) => {
      const model = buildSpotlightModel(
        data,
        initialIndicators,
        dbn,
        m,
        m === primaryMode ? overrides : { school: [], community: [] },
      );
      const headline = m === primaryMode && urlHeadline ? urlHeadline : model.suggestedHeadline;
      return { mode: m, model, headline };
    });
  }, [data, initialIndicators, dbn, primaryMode, both, urlHeadline, searchParams]);

  const hero: SpotlightHero | null = data.loading
    ? null
    : {
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
      };

  return (
    <div style={{ background: '#e8ecf0', minHeight: '100dvh', overflowY: 'auto', height: '100dvh' }}>
      <style>{PRINT_CSS}</style>

      <div
        className="spotlight-print-toolbar"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: '#027BC0',
          color: 'white',
          padding: '10px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          borderBottom: '3px solid #F0901F',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {both ? 'Donor packet — Case for support + Celebrate' : `${MODE_LABEL[primaryMode]} one-pager`}
          {hero ? ` · ${hero.schoolName}` : ''}
        </span>
        <button
          type="button"
          onClick={() => window.print()}
          style={{
            background: 'white',
            color: '#027BC0',
            border: 'none',
            borderRadius: 4,
            padding: '7px 14px',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Print / Save as PDF
        </button>
      </div>

      <div style={{ padding: '24px 12px 48px' }}>
        {data.error ? (
          <p style={{ textAlign: 'center', color: '#c0392b', fontSize: 13 }}>Failed to load: {data.error}</p>
        ) : !pages || !hero ? (
          <p style={{ textAlign: 'center', color: '#467c9d', fontSize: 13 }}>Preparing print layout…</p>
        ) : (
          pages.map((page) => (
            <div
              key={page.mode}
              className="spotlight-print-page"
              style={{
                background: 'white',
                width: '8.5in',
                minHeight: '10.5in',
                maxWidth: '100%',
                margin: '0 auto 24px',
                boxShadow: '0 2px 10px rgba(0,32,64,0.15)',
                boxSizing: 'border-box',
                padding: '0.35in',
                display: 'flex',
              }}
            >
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <SpotlightSheet hero={hero} model={page.model} headline={page.headline} variant="print" />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
