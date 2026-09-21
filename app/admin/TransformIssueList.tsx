'use client';

export interface TransformIssue {
  code: string;
  file?: string;
  message: string;
  expected?: string;
  found?: string;
}

/** Raw-file transform issues (blocking errors or tolerated-drift warnings). */
export default function TransformIssueList({ issues }: { issues: TransformIssue[] }): React.JSX.Element {
  return (
    <ul style={{ margin: '6px 0 0 0', paddingLeft: 18 }}>
      {issues.map((i, idx) => (
        <li key={`${i.code}-${idx}`} style={{ marginBottom: 6 }}>
          {i.file ? <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{i.file} — </span> : null}
          {i.message}
          {i.expected || i.found ? (
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
              {i.expected ? <div>Expected: {i.expected}</div> : null}
              {i.found ? <div>Found: {i.found}</div> : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
