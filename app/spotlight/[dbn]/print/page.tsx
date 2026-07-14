import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getActiveIndicators } from '../../../../src/server/contract';
import SpotlightPrint from '../../../../src/components/spotlight/SpotlightPrint';

export const metadata: Metadata = {
  title: 'Spotlight — Print',
  description: 'Letter-format spotlight one-pager for the browser print pipeline (Save as PDF).',
};

export default async function SpotlightPrintPage({
  params,
}: {
  params: Promise<{ dbn: string }>;
}): Promise<React.JSX.Element> {
  const { dbn } = await params;
  const indicators = getActiveIndicators();
  return (
    <Suspense>
      <SpotlightPrint dbn={decodeURIComponent(dbn)} initialIndicators={indicators} />
    </Suspense>
  );
}
