import { createNextRouteHandler } from '@mastra/next';
import { mastra } from '@/mastra';

/**
 * Mastra server adapter (DESIGN §6.2) — exposes Mastra's full HTTP API
 * (agents, tools, Studio) through Next.js at /api/mastra/*
 */
export const { GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD } = createNextRouteHandler({
  mastra,
  prefix: '/api/mastra',
});
