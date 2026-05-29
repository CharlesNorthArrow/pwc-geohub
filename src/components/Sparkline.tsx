'use client';

interface Props {
  points: Array<{ year: string; value: number | null }>;
  /** Active year (highlighted with a small dot). */
  highlightYear?: string;
  /** Shared y-domain across rows for cross-school comparability. */
  domain?: { min: number; max: number };
  width?: number;
  height?: number;
  stroke?: string;
}

/** Tiny SVG line chart for a single school's trend. Skips null gaps. */
export default function Sparkline({
  points,
  highlightYear,
  domain,
  width = 60,
  height = 18,
  stroke = '#467c9d',
}: Props): React.JSX.Element {
  const nonNull = points.filter((p): p is { year: string; value: number } => p.value != null);
  if (nonNull.length === 0) {
    return (
      <svg width={width} height={height} aria-hidden="true">
        <text x={2} y={height - 4} fontSize="9" fill="#c5cdd6">
          —
        </text>
      </svg>
    );
  }

  const dom = domain ?? {
    min: Math.min(...nonNull.map((p) => p.value)),
    max: Math.max(...nonNull.map((p) => p.value)),
  };
  const spanY = Math.max(1e-6, dom.max - dom.min);

  const x = (i: number, n: number): number => (n <= 1 ? width / 2 : (i / (n - 1)) * (width - 4) + 2);
  const y = (v: number): number => height - 2 - ((v - dom.min) / spanY) * (height - 4);

  // Build a polyline that skips null gaps by using "move-to" segments.
  let path = '';
  let started = false;
  points.forEach((p, i) => {
    const px = x(i, points.length);
    if (p.value == null) {
      started = false;
      return;
    }
    const py = y(p.value);
    if (!started) {
      path += `M${px.toFixed(1)},${py.toFixed(1)}`;
      started = true;
    } else {
      path += ` L${px.toFixed(1)},${py.toFixed(1)}`;
    }
  });

  const highlightIdx = highlightYear ? points.findIndex((p) => p.year === highlightYear) : -1;
  const highlightPt =
    highlightIdx >= 0 && points[highlightIdx]?.value != null
      ? { cx: x(highlightIdx, points.length), cy: y(points[highlightIdx]!.value!) }
      : null;

  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={path} stroke={stroke} fill="none" strokeWidth={1.4} strokeLinejoin="round" />
      {highlightPt ? <circle cx={highlightPt.cx} cy={highlightPt.cy} r={2} fill={stroke} /> : null}
    </svg>
  );
}
