interface Props {
  family: 'school' | 'community';
  indicatorLabel: string;
  year: string;
}

/** Spec §6.5: missing-year state for the active indicator. The notice is
 * per-layer so the other layer keeps rendering normally. */
export default function NoDataNotice({ family, indicatorLabel, year }: Props): React.JSX.Element {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        gap: 6,
        padding: '6px 8px',
        borderRadius: 4,
        background: '#fff5f5',
        border: '1px solid #f5cfd6',
        color: '#a82255',
        fontSize: 11,
        lineHeight: 1.3,
      }}
    >
      <span aria-hidden style={{ fontSize: 14 }}>
        🗓️
      </span>
      <span>
        Data not available for the selected year.
        <br />
        <span style={{ color: '#67324c' }}>
          {family === 'school' ? 'School' : 'Community'} indicator{' '}
          <em>{indicatorLabel}</em> has no values for <strong>{year}</strong>.
        </span>
      </span>
    </div>
  );
}
