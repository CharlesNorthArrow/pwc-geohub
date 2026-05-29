export default function Logo(): React.JSX.Element {
  return (
    <a
      href="https://partnershipwithchildren.org/"
      target="_blank"
      rel="noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#002040', textDecoration: 'none' }}
    >
      <img src="/brand/PWC-Logo.png" alt="Partnership with Children" style={{ height: 32, width: 'auto' }} />
      <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.2 }}>Geospatial Hub</span>
    </a>
  );
}
