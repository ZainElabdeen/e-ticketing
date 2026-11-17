import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` evaluates this file with no env set, so fall back to ''.
  datasource: { url: process.env.MIGRATION_DATABASE_URL ?? '' },
});
