import type { Metadata } from 'next';
import { getActiveIndicatorsWithYears } from '../../src/server/contract';
import Scorecard from '../../src/components/Scorecard';

export const metadata: Metadata = {
  title: 'Indicator Scorecard',
  description:
    'PWC Anchor (Community School), Anchor (Social Work) and Healing Arts schools benchmarked against all NYC schools — citywide or by borough — across every active indicator.',
};

// Server-rendered indicator list keeps the first byte useful even before the
// client-side analytics fetches resolve. Same pattern as `app/page.tsx` —
// but unlike Shell, Scorecard never re-fetches indicators client-side, so
// this page must render per-request to pick up the DB years overlay.
export const dynamic = 'force-dynamic';

export default async function ScorecardPage(): Promise<React.JSX.Element> {
  const indicators = await getActiveIndicatorsWithYears();
  return <Scorecard initialIndicators={indicators} />;
}
