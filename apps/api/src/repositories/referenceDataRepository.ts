import type { TxClient } from '../db';

const TRAIN = { number: '12345', name: 'Demo Express' };
export const SEATS_PER_COACH = 20;

// Coach layout is configuration (DESIGN_SPEC §1). Capacity is derived from it.
export const LAYOUT = [
  { classCode: 'SL', className: 'Sleeper', coaches: ['S1', 'S2'] },
  { classCode: 'AC', className: 'AC', coaches: ['A1'] },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Seeds the fixed reference data: classes, train, one run, coaches, seats and
 * class inventory. Idempotent: safe to run any number of times, and it never
 * changes an existing run's window, chart status or bookings.
 * Used by `npm run db:seed` and by the test harness after each reset.
 */
export async function seedReferenceData(tx: TxClient): Promise<void> {
  for (const { classCode, className } of LAYOUT) {
    await tx.travelClass.upsert({
      where: { code: classCode },
      create: { code: classCode, name: className },
      update: { name: className },
    });
  }

  const train = await tx.train.upsert({
    where: { number: TRAIN.number },
    create: TRAIN,
    update: { name: TRAIN.name },
  });

  // Only ever one run. The journey date (today + 7) moves daily, so it cannot
  // be the idempotency key: reuse whatever run this train already has.
  const existingRun = await tx.trainRun.findFirst({ where: { trainId: train.id } });
  const now = new Date();
  const run =
    existingRun ??
    (await tx.trainRun.create({
      data: {
        trainId: train.id,
        journeyDate: new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 7),
        ),
        bookingOpensAt: now,
        bookingClosesAt: new Date(now.getTime() + 2 * DAY_MS),
        chartStatus: 'NOT_YET_OPEN',
      },
    }));

  for (const { classCode, coaches } of LAYOUT) {
    for (const [index, label] of coaches.entries()) {
      const coach = await tx.coach.upsert({
        where: { trainRunId_label: { trainRunId: run.id, label } },
        create: { trainRunId: run.id, classCode, label, ordinal: index + 1 },
        update: {},
      });
      await tx.seat.createMany({
        data: Array.from({ length: SEATS_PER_COACH }, (_, i) => ({
          coachId: coach.id,
          seatNumber: i + 1,
        })),
        skipDuplicates: true,
      });
    }

    // update: {} keeps next_waitlist_number intact on re-runs.
    await tx.classInventory.upsert({
      where: { trainRunId_classCode: { trainRunId: run.id, classCode } },
      create: { trainRunId: run.id, classCode, capacity: coaches.length * SEATS_PER_COACH },
      update: {},
    });
  }
}
