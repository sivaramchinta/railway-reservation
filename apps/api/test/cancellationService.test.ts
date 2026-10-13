// Cancellation (DESIGN_SPEC §5) against real PostgreSQL. Edge cases 6, 10 (cancel
// after chart) and 13 (other user's PNR), plus cancellations racing bookings.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { prisma } from '../src/db';
import { InvariantViolationError } from '../src/domain/errors';
import type { BookingView } from '../src/services/bookingView';
import { createBooking } from '../src/services/bookingService';
import { cancelBooking } from '../src/services/cancellationService';
import { classOutcome, createUsers, oneTo, openBookingWindow, resetDb } from './helpers/db';
import { expectInvariantsHold } from './invariants';

let userId: number;
let otherUserId: number;

beforeEach(async () => {
  await resetDb();
  await openBookingWindow();
  [userId = 0, otherUserId = 0] = await createUsers(2);
});

afterEach(async () => {
  await expectInvariantsHold();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function book(classCode: string, names: string[], user = userId): Promise<BookingView> {
  const result = await createBooking(
    user,
    { classCode, passengers: names.map((name) => ({ name })) },
    randomUUID(),
  );
  return result.booking;
}

/** Books `count` single-passenger confirmed bookings and returns their PNRs. */
async function fillSingles(classCode: string, count: number): Promise<string[]> {
  const pnrs: string[] = [];
  for (let i = 0; i < count; i++) pnrs.push((await book(classCode, [`P${i + 1}`])).pnr);
  return pnrs;
}

describe('cancelBooking', () => {
  it('cancels a confirmed booking: every passenger CANCELLED, the seat is free again', async () => {
    const booking = await book('AC', ['A', 'B']);

    const cancelled = await cancelBooking(userId, booking.pnr);

    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.passengers.map((p) => p.status)).toEqual(['CANCELLED', 'CANCELLED']);
    expect((await classOutcome('AC')).confirmed).toBe(0);
    expect((await book('AC', ['Next'])).status).toBe('CONFIRMED'); // empty waitlist → confirms
  });

  it('cancels a waitlisted booking; its number is never reused', async () => {
    await fillSingles('AC', 20);
    const waitlisted = await book('AC', ['W']);
    expect(waitlisted.passengers[0]?.waitlistNumber).toBe(1);

    const cancelled = await cancelBooking(userId, waitlisted.pnr);

    expect(cancelled.passengers[0]).toMatchObject({ status: 'CANCELLED', waitlistNumber: 1 });
    expect((await book('AC', ['Later'])).passengers[0]?.waitlistNumber).toBe(2);
  });

  it('cancels a partially confirmed booking as a whole (CONFIRMED and WAITLISTED together)', async () => {
    await fillSingles('AC', 18);
    const split = await book('AC', ['A', 'B', 'C']);
    expect(split.status).toBe('PARTIALLY_CONFIRMED');

    const cancelled = await cancelBooking(userId, split.pnr);

    expect(cancelled.passengers.map((p) => p.status)).toEqual([
      'CANCELLED',
      'CANCELLED',
      'CANCELLED',
    ]);
  });

  it('does not hand a freed seat to the waitlist now: WL 1 stays WAITLISTED until chart prep', async () => {
    const [firstPnr = ''] = await fillSingles('AC', 20);
    await book('AC', ['Waiting']);

    await cancelBooking(userId, firstPnr);

    const ac = await classOutcome('AC');
    expect(ac.confirmed).toBe(19);
    expect(ac.waitlistNumbers).toEqual([1]);
  });

  it('is idempotent: cancelling again succeeds and changes nothing', async () => {
    const booking = await book('SL', ['A']);
    const first = await cancelBooking(userId, booking.pnr);
    const second = await cancelBooking(userId, booking.pnr);
    expect(second).toEqual(first);
  });

  it('accepts the PNR in lower case and with spaces', async () => {
    const booking = await book('SL', ['A']);
    const cancelled = await cancelBooking(userId, `  ${booking.pnr.toLowerCase()} `);
    expect(cancelled.status).toBe('CANCELLED');
  });

  describe('edge case 13: never reveal that a PNR exists', () => {
    it("another user's PNR → NOT_FOUND, and the booking is untouched", async () => {
      const theirs = await book('SL', ['Theirs'], otherUserId);
      await expect(cancelBooking(userId, theirs.pnr)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        httpStatus: 404,
      });
      expect((await classOutcome('SL')).confirmed).toBe(1);
    });

    it.each([
      ['a well-formed PNR that does not exist', 'ABCDEFGHJK'],
      ['a malformed PNR', 'not-a-pnr'],
      ['an empty string', ''],
    ])('%s → NOT_FOUND', async (_label, pnr) => {
      await expect(cancelBooking(userId, pnr)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('chart status', () => {
    it('edge case 10: after the chart is locked → CHART_LOCKED, nothing changes', async () => {
      const booking = await book('SL', ['A']);
      await prisma.trainRun.updateMany({ data: { chartStatus: 'CHART_LOCKED' } });

      await expect(cancelBooking(userId, booking.pnr)).rejects.toMatchObject({
        code: 'CHART_LOCKED',
        httpStatus: 409,
      });
      expect((await classOutcome('SL')).confirmed).toBe(1);

      // CHART_LOCKED was faked without seat allocations, which invariant 5 rightly
      // reports as impossible. Undo the fake before the afterEach invariant check.
      await prisma.trainRun.updateMany({ data: { chartStatus: 'CLOSED' } });
    });

    it('is allowed after the window closed but before the chart (status CLOSED)', async () => {
      const booking = await book('SL', ['A']);
      await prisma.trainRun.updateMany({ data: { chartStatus: 'CLOSED' } });
      expect((await cancelBooking(userId, booking.pnr)).status).toBe('CANCELLED');
    });

    it('is allowed when the window closed by time (stored OPEN, past closes_at)', async () => {
      const booking = await book('SL', ['A']);
      await prisma.$executeRaw`UPDATE train_run SET booking_closes_at = clock_timestamp() - interval '1 second'`;
      expect((await cancelBooking(userId, booking.pnr)).status).toBe('CANCELLED');
    });

    it('treats a booking on a NOT_YET_OPEN run as a bug', async () => {
      const booking = await book('SL', ['A']);
      await prisma.trainRun.updateMany({ data: { chartStatus: 'NOT_YET_OPEN' } });
      await expect(cancelBooking(userId, booking.pnr)).rejects.toThrow(InvariantViolationError);
    });
  });
});

describe('cancellation under concurrency', () => {
  it('edge case 6: the same PNR cancelled 10 times at once → all succeed, one effect', async () => {
    await fillSingles('AC', 19);
    const booking = await book('AC', ['A', 'B']); // 1 CONFIRMED + WL1

    const results = await Promise.all(
      Array.from({ length: 10 }, () => cancelBooking(userId, booking.pnr)),
    );

    expect(results.every((r) => r.status === 'CANCELLED')).toBe(true);
    const ac = await classOutcome('AC');
    expect(ac.confirmed).toBe(19);
    expect(ac.waitlistNumbers).toEqual([]);
    expect(ac.nextWaitlistNumber).toBe(2); // unchanged by cancelling
  });

  it('cancellations racing new bookings (no waitlist yet): capacity and fair ordering hold', async () => {
    const pnrs = await fillSingles('SL', 38);
    const newcomers = await createUsers(20);

    await Promise.all([
      ...pnrs.slice(0, 10).map((pnr) => cancelBooking(userId, pnr)),
      ...newcomers.map((user) => book('SL', ['New'], user)),
    ]);

    const sl = await classOutcome('SL');
    expect(sl.confirmed).toBeLessThanOrEqual(40);
    expect(sl.confirmed + sl.waitlistNumbers.length).toBe(28 + 20); // nobody lost or duplicated
    expect(sl.waitlistNumbers).toEqual(oneTo(sl.waitlistNumbers.length)); // gap-free
    // Invariant 4 (afterEach): no newcomer confirmed after one was already waitlisted.
  });

  it('cancellations racing new bookings (waitlist exists): every newcomer is WAITLISTED', async () => {
    const pnrs = await fillSingles('SL', 40);
    await Promise.all(Array.from({ length: 5 }, () => book('SL', ['Early WL'])));
    const newcomers = await createUsers(10);

    const results = await Promise.all([
      ...pnrs.slice(0, 5).map((pnr) => cancelBooking(userId, pnr)),
      ...newcomers.map((user) => book('SL', ['New'], user)),
    ]);

    const newBookings = results.slice(5);
    expect(newBookings.every((b) => b.status === 'WAITLISTED')).toBe(true);
    const sl = await classOutcome('SL');
    expect(sl.confirmed).toBe(35); // freed seats wait for chart preparation
    expect(sl.waitlistNumbers).toEqual(oneTo(15));
  });
});
