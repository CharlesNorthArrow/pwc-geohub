import type { Metadata } from 'next';
import { getActiveIndicatorsWithYears } from '../../src/server/contract';
import Scorecard from '../../src/components/Scorecard';

export const metadata: Metadata = {
  title: 'Indicator Scorecard',
  description:
    'PWC Anchor and Healing Arts schools benchmarked against a citywide or borough average across every active indicator.',
};

// Server-rendered indicator list keeps the first byte useful even before the
// client-side analytics fetches resolve. Same pattern as `app/page.tsx`.
export default async function ScorecardPage(): Promise<React.JSX.Element> {
  const indicators = await getActiveIndicatorsWithYears();
  return <Scorecard initialIndicators={indicators} />;
}
