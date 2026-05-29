import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Neon's `@neondatabase/serverless` is kept out of the server-component
  // bundle so its WebSocket transport works (the HTTP transport is blocked
  // behind the user's TLS proxy).
  serverExternalPackages: ['@neondatabase/serverless'],
};

export default nextConfig;
