// Proves the hand-added CHECK constraints (DESIGN_SPEC §3) exist in the database.
//
// Runs against the Compose `db` (DATABASE_URL). Every case runs in its own
// transaction that is ALWAYS rolled back, so no data is left behind. Each case
// first makes a valid write (the control, proving the fixture is sound) and then
// the invalid write, which must fail with that specific constraint's name.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from '@jest/globals';
import { prisma, runInTransaction, type TxClient } from '../src/db';

/** Thrown on purpose to roll a test transaction back. */
class Rollback extends Error {
  override readonly name = 'Rollback';
}

async function inRolledBackTransaction(work: (tx: TxClient) => Promise<void>): Promise<void> {
  try {
    await runInTransaction(async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

interface Fixture {
  runId: number;
  coachId: number;
  bookingId: bigint;
  classCode: string;
}

/** A minimal, self-contained train → run → class → coach → booking chain. */
async function createFixture(tx: TxClient): Promise<Fixture> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 7).toUpperCase();
  const classCode = `T${suffix}`;
  await tx.travelClass.create({ data: { code: classCode, name: 'Test class' } });
  const train = await tx.train.create({ data: { number: `T-${suffix}`, name: 'Test train' } });
  const run = await tx.trainRun.create({
    data: {
      trainId: train.id,
      journeyDate: new Date('2030-01-10'),
      bookingOpensAt: new Date('2030-01-01T00:00:00Z'),
      bookingClosesAt: new Date('2030-01-03T00:00:00Z'),
      chartStatus: 'NOT_YET_OPEN',
    },
  });
  await tx.classInventory.create({ data: { trainRunId: run.id, classCode, capacity: 20 } });
  const coach = await tx.coach.create({
    data: { trainRunId: run.id, classCode, label: 'X1', ordinal: 1 },
  });
  const user = await tx.appUser.create({
    data: { email: `check-${suffix.toLowerCase()}@test.local` },
  });
  const booking = await tx.booking.create({
    data: {
      pnr: `TST${suffix}`, // 10 characters
      userId: user.id,
      trainRunId: run.id,
      classCode,
      idempotencyKey: randomUUID(),
    },
  });
  return { runId: run.id, coachId: coach.id, bookingId: booking.id, classCode };
}

interface ConstraintCase {
  constraint: string;
  valid: (tx: TxClient, f: Fixture) => Promise<unknown>;
  invalid: (tx: TxClient, f: Fixture) => Promise<unknown>;
}

const cases: ConstraintCase[] = [
  {
    // The "done when" case from the implementation plan.
    constraint: 'passenger_waitlisted_has_number_check',
    valid: (tx, f) =>
      tx.passenger.create({
        data: {
          bookingId: f.bookingId,
          position: 1,
          name: 'A',
          status: 'WAITLISTED',
          waitlistNumber: 1,
        },
      }),
    invalid: (tx, f) =>
      tx.passenger.create({
        data: {
          bookingId: f.bookingId,
          position: 2,
          name: 'B',
          status: 'WAITLISTED',
          waitlistNumber: null,
        },
      }),
  },
  {
    constraint: 'passenger_position_range_check',
    valid: (tx, f) =>
      tx.passenger.create({
        data: { bookingId: f.bookingId, position: 6, name: 'A', status: 'CONFIRMED' },
      }),
    invalid: (tx, f) =>
      tx.passenger.create({
        data: { bookingId: f.bookingId, position: 7, name: 'B', status: 'CONFIRMED' },
      }),
  },
  {
    constraint: 'seat_number_positive_check',
    valid: (tx, f) => tx.seat.create({ data: { coachId: f.coachId, seatNumber: 1 } }),
    invalid: (tx, f) => tx.seat.create({ data: { coachId: f.coachId, seatNumber: 0 } }),
  },
  {
    constraint: 'class_inventory_capacity_positive_check',
    valid: (tx, f) =>
      tx.classInventory.update({
        where: { trainRunId_classCode: { trainRunId: f.runId, classCode: f.classCode } },
        data: { capacity: 1 },
      }),
    invalid: (tx, f) =>
      tx.classInventory.update({
        where: { trainRunId_classCode: { trainRunId: f.runId, classCode: f.classCode } },
        data: { capacity: 0 },
      }),
  },
  {
    constraint: 'class_inventory_next_waitlist_number_check',
    valid: (tx, f) =>
      tx.classInventory.update({
        where: { trainRunId_classCode: { trainRunId: f.runId, classCode: f.classCode } },
        data: { nextWaitlistNumber: 1 },
      }),
    invalid: (tx, f) =>
      tx.classInventory.update({
        where: { trainRunId_classCode: { trainRunId: f.runId, classCode: f.classCode } },
        data: { nextWaitlistNumber: 0 },
      }),
  },
  {
    constraint: 'train_run_window_order_check',
    valid: (tx, f) =>
      tx.trainRun.update({
        where: { id: f.runId },
        data: { bookingClosesAt: new Date('2030-01-02T00:00:00Z') },
      }),
    invalid: (tx, f) =>
      tx.trainRun.update({
        where: { id: f.runId },
        data: { bookingClosesAt: new Date('2030-01-01T00:00:00Z') }, // == opens_at
      }),
  },
];

describe('hand-added CHECK constraints', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(cases)('$constraint accepts valid rows and rejects invalid ones', async (c) => {
    // Control: the valid write succeeds, so the fixture itself is sound.
    await expect(
      inRolledBackTransaction(async (tx) => {
        await c.valid(tx, await createFixture(tx));
      }),
    ).resolves.toBeUndefined();

    // The invalid write fails, and the error names this exact constraint.
    await expect(
      inRolledBackTransaction(async (tx) => {
        await c.invalid(tx, await createFixture(tx));
      }),
    ).rejects.toThrow(c.constraint);
  });
});
