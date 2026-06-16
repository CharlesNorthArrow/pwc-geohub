export default function StubCard({
  title,
  description,
  family,
}: {
  title: string;
  description: string;
  family: 'school' | 'community';
}): React.JSX.Element {
  const familyLabel = family === 'school' ? 'School indicator' : 'Community sync';
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e1e8ef',
        borderRadius: 8,
        padding: 16,
        opacity: 0.65,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 11, color: '#5a6e85', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {familyLabel}
        </div>
        <span
          style={{
            fontSize: 10,
            background: '#eef2f7',
            color: '#5a6e85',
            padding: '2px 8px',
            borderRadius: 999,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Coming soon
        </span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
      <p style={{ fontSize: 12, color: '#5a6e85', margin: 0, lineHeight: 1.4 }}>{description}</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 6 }}>
        <DisabledButton>Update</DisabledButton>
        <DisabledButton>View schema</DisabledButton>
        <DisabledButton>Download</DisabledButton>
      </div>
      <div style={{ fontSize: 11, color: '#9aa9ba' }}>Last job: —</div>
    </div>
  );
}

function DisabledButton({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      disabled
      style={{
        background: '#eef2f7',
        color: '#9aa9ba',
        border: 0,
        borderRadius: 4,
        padding: '6px 10px',
        fontSize: 11,
        cursor: 'not-allowed',
      }}
    >
      {children}
    </button>
  );
}
