import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PWC Geospatial Hub',
  description: 'Internal indicator map for Partnership with Children.',
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
