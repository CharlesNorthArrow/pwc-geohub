export default function Logo(): React.JSX.Element {
  return (
    <a
      href="https://partnershipwithchildren.org/"
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        textDecoration: 'none',
        color: '#002040',
      }}
      aria-label="Partnership with Children"
    >
      <img
        src="/brand/PWC-Logo.png"
        alt="Partnership with Children"
        style={{ height: 48, width: 'auto' }}
      />
    </a>
  );
}
