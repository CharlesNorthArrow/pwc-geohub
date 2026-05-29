'use client';

import { useHubStore } from '../store/useHubStore';
import type { AggregationArea } from '../contract/types';

const OPTIONS: ReadonlyArray<{ value: AggregationArea; label: string }> = [
  { value: 'school_district', label: 'School District' },
  { value: 'nta_2020', label: 'NTA' },
];

/** Spec §5.4 — toggle the polygon definition used to compute each PWC
 *  school's "surrounding area" community-indicator average. */
export default function AggregationToggle(): React.JSX.Element {
  const value = useHubStore((s) => s.aggregationArea);
  const setValue = useHubStore((s) => s.setAggregationArea);
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span
        style={{
          fontSize: 10,
          color: '#467c9d',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          fontWeight: 600,
        }}
      >
        Aggregate by
      </span>
      <div
        role="radiogroup"
        aria-label="Community aggregation area"
        style={{ display: 'inline-flex', border: '1px solid #c5cdd6', borderRadius: 4 }}
      >
        {OPTIONS.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setValue(o.value)}
              style={{
                padding: '2px 8px',
                fontSize: 11,
                border: 'none',
                background: selected ? '#027BC0' : 'white',
                color: selected ? 'white' : '#002040',
                cursor: 'pointer',
                fontWeight: selected ? 600 : 400,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
