import type { NextConfig } from 'next';

// Where the Express API runs. Read by the Next.js server, never sent to the browser.
const API_ORIGIN = process.env['API_ORIGIN'] ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // packages/shared ships TypeScript source, so Next.js must compile it.
  transpilePackages: ['@railway/shared'],

  // The browser only ever talks to this origin: /api/* is proxied to Express.
  // One origin means the session cookie just works and no CORS is needed.
  async rewrites() {
    return Promise.resolve([{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }]);
  },
};

export default nextConfig;
