import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7: the CLI no longer loads .env or reads datasource URLs from the
// schema — prisma.config.ts is the single source of truth for CLI operations.
// This repo only ever runs `prisma generate` (the portal owns migrations);
// the URL is read so `generate` validates env, and defaults to a placeholder
// when unset so generation works on a fresh clone without .env filled in.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL') ?? 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
  },
});
