import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getActiveIndicators } from '../../../src/server/contract';
import SpotlightCard from '../../../src/components/spotlight/SpotlightCard';

export const metadata: Metadata = {
  title: 'School Spotlight',
  description: 'Shareable per-school spotlight card — outliers, case sentences, and exports.',
};

// Same server-rendered-indicators pattern as the dashboard and Scorecard.
// Suspense is required because the card reads useSearchParams (URL state).
export default async function SpotlightSchoolPage({
  params,
}: {
  params: Promise<{ dbn: string }>;
}): Promise<React.JSX.Element> {
  const { dbn } = await params;
  const indicators = getActiveIndicators();
  return (
    <Suspense>
      <SpotlightCard dbn={decodeURIComponent(dbn)} initialIndicators={indicators} />
    </Suspense>
  );
}
