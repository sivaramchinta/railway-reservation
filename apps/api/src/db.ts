import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/prisma/client';

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
}

const DEFAULT_POOL_SIZE = 10;

/**
 * Pool size = `connection_limit` from DATABASE_URL. The pg driver adapter does not
 * read that URL parameter itself; its pool size is the `max` option. Concurrency
 * tests need at least as many connections as parallel requests (CLAUDE.md).
 */
export function poolSizeFromUrl(url: string): number {
  const raw = new URL(url).searchParams.get('connection_limit');
  if (raw === null) return DEFAULT_POOL_SIZE;
  const size = Number(raw);
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`Invalid connection_limit in DATABASE_URL: ${raw}`);
  }
  return size;
}

/** The one shared Prisma client (and connection pool) for this process. */
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl, max: poolSizeFromUrl(databaseUrl) }),
});

/**
 * The client available inside a transaction. Repository functions take this as
 * their first parameter so they can only run on the transaction's connection.
 */
export type TxClient = Prisma.TransactionClient;

/**
 * Runs `work` in one interactive transaction with the settings every
 * seat-affecting use case must use (CLAUDE.md):
 * - READ COMMITTED, set explicitly so the design never relies on a default;
 * - timeout 15 s: how long the whole transaction may run before rollback;
 * - maxWait 10 s: how long to wait for a free pool connection to start it.
 */
export function runInTransaction<T>(work: (tx: TxClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(work, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: 15_000,
    maxWait: 10_000,
  });
}
