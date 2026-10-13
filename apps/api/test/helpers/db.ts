// Test-only database helpers. Raw SQL here is test setup, not application code.
import { randomUUID } from 'node:crypto';
import { prisma, runInTransaction } from '../../src/db';
import { seedReferenceData } from '../../src/repositories/referenceDataRepository';
import { findCurrentRunId } from '../../src/repositories/trainRunRepository';

/** Empties every table and reseeds the reference data (window NOT_YET_OPEN). */
export async function resetDb(): Promise<void> {
  await prisma.$executeRaw`
    TRUNCATE seat_allocation, passenger, booking, app_user, class_inventory,
             seat, coach, train_run, train, travel_class
    RESTART IDENTITY CASCADE`;
  await runInTransaction(seedReferenceData);
}

export async function currentRunId(): Promise<number> {
  const runId = await findCurrentRunId(prisma);
  if (runId === null) throw new Error('No run seeded');
  return runId;
}

/** Puts the run in the middle of an open booking window (by database time). */
export async function openBookingWindow(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE train_run
    SET chart_status = 'OPEN',
        booking_opens_at = clock_timestamp() - interval '1 hour',
        booking_closes_at = clock_timestamp() + interval '1 day'`;
}

/** Creates `count` users (unique emails, so it can be called repeatedly) and returns their ids. */
export async function createUsers(count: number): Promise<number[]> {
  const users = await prisma.appUser.createManyAndReturn({
    data: Array.from({ length: count }, () => ({ email: `user-${randomUUID()}@test.local` })),
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export interface ClassOutcome {
  confirmed: number;
  /** Numbers of passengers still WAITLISTED, ascending. */
  waitlistNumbers: number[];
  nextWaitlistNumber: number;
}

/** What the DATABASE says about a class (not what callers were told). */
export async function classOutcome(classCode: string): Promise<ClassOutcome> {
  const passengers = await prisma.passenger.findMany({
    where: { booking: { classCode } },
    select: { status: true, waitlistNumber: true },
  });
  const inventory = await prisma.classInventory.findUniqueOrThrow({
    where: { trainRunId_classCode: { trainRunId: await currentRunId(), classCode } },
  });
  return {
    confirmed: passengers.filter((p) => p.status === 'CONFIRMED').length,
    waitlistNumbers: passengers
      .filter((p) => p.status === 'WAITLISTED')
      .map((p) => p.waitlistNumber ?? -1)
      .sort((a, b) => a - b),
    nextWaitlistNumber: inventory.nextWaitlistNumber,
  };
}

/** [1, 2, …, n] */
export const oneTo = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);
