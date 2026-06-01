import type { Metadata } from 'next';
import { getActiveIndicators } from '../../src/server/contract';
import Scorecard from '../../src/components/Scorecard';

export const metadata: Metadata = {
  title: 'Indicator Scorecard',
  description:
    'PWC Anchor and Healing Arts schools benchmarked against a citywide or borough average across every active indicator.',
};

// Server-rendered indicator list keeps the first byte useful even before the
// client-side analytics fetches resolve. Same pattern as `app/page.tsx`.
export default function ScorecardPage(): React.JSX.Element {
  const indicators = getActiveIndicators();
  return <Scorecard initialIndicators={indicators} />;
}
