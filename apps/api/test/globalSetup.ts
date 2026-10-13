// Jest global setup: one throwaway PostgreSQL 16 container per test run.
// Tests never touch the dev database, and every run starts from a clean schema.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

declare global {
  var __PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

/** Pool size for tests: at least the number of concurrent requests in any test (CLAUDE.md). */
const TEST_POOL_SIZE = 150;

export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer('postgres:16')
    // Default max_connections is 100; the concurrency tests need more.
    .withCommand(['postgres', '-c', 'max_connections=300'])
    .start();

  const url = `${container.getConnectionUri()}?schema=public&connection_limit=${TEST_POOL_SIZE}`;
  process.env['DATABASE_URL'] = url;

  // Same migrations (including the hand-added CHECKs) as every other environment.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '../../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  globalThis.__PG_CONTAINER__ = container;
}
