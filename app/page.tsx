import type { Metadata } from 'next';
import { getActiveIndicators } from '../src/server/contract';
import Shell from '../src/components/Shell';

// Title intentionally omitted — Next App Router's `title.template` in
// layout.tsx does not apply to a page in the SAME route segment, so a "title"
// here would print without the site suffix. Falling through to the layout's
// `title.default` (the bare site name) is the cleanest result for the main
// dashboard route.
export const metadata: Metadata = {
  description:
    'Interactive map of NYC schools with PWC programs and public-data indicators at school + community levels.',
};

// Render the indicator list on the server so the panel paints with content
// on first byte; the client then refreshes it via /api/indicators.
export default function HomePage(): React.JSX.Element {
  const indicators = getActiveIndicators();
  return <Shell initialIndicators={indicators} />;
}
