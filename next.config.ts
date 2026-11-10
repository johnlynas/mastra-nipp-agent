import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@mastra/core', '@mastra/mcp', 'better-auth'],
};

export default nextConfig;
