import type { Metadata, Viewport } from 'next';
import './globals.css';

const SITE_NAME = 'PWC Geospatial Hub';
const DESCRIPTION =
  'Internal map-centered tool for Partnership with Children — public-data indicators and PWC program data, by school and community.';
// The WIDE Partnership-with-Children logo (mark + wordmark). Used for social
// previews where a horizontal lockup reads better than the square icon.
// The square favicon is served separately from `app/icon.svg` (Next auto-
// discovers it — no explicit `icons` config needed).
const SOCIAL_IMAGE = '/brand/PWC-Logo.png';

export const metadata: Metadata = {
  // `template` lets per-page metadata exports (e.g. /scorecard) append their
  // section name without restating the site title every time.
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: 'North Arrow', url: 'https://north-arrow.org/' }],
  creator: 'North Arrow',
  publisher: 'Partnership with Children',
  // Internal tool — keep it out of search indexes.
  robots: { index: false, follow: false },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: DESCRIPTION,
    locale: 'en_US',
    images: [{ url: SOCIAL_IMAGE, alt: SITE_NAME }],
  },
  twitter: {
    card: 'summary',
    title: SITE_NAME,
    description: DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Brand blue surfaces the Logo bar's color in mobile address bars.
  themeColor: '#027BC0',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
