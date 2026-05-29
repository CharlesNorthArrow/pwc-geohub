import { getActiveIndicators } from '../src/server/contract';
import Shell from '../src/components/Shell';

// Render the indicator list on the server so the panel paints with content
// on first byte; the client then refreshes it via /api/indicators.
export default function HomePage(): React.JSX.Element {
  const indicators = getActiveIndicators();
  return <Shell initialIndicators={indicators} />;
}
