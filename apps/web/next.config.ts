import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // packages/shared ships TypeScript source, so Next.js must compile it.
  transpilePackages: ['@railway/shared'],
};

export default nextConfig;
