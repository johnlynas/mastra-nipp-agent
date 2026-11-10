import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@mastra/core',
    '@mastra/mcp',
    'better-auth',
    '@prisma/adapter-pg',
    'pg',
  ],
};

export default nextConfig;
