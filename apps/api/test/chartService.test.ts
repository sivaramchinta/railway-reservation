// Chart preparation (DESIGN_SPEC §6, §7) against real PostgreSQL: edge cases 7–12,
// a full scenario with exact seat labels, a simulated crash, and the in-transaction
// verification. The afterEach invariant check includes query 5 (after CHART_LOCKED,
// every CONFIRMED passenger has exactly one seat and nobody else has one).
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { prisma, type TxClient } from '../src/db';
import { InvariantViolationError } from '../src/domain/errors';
import { createBooking } from '../src/services/bookingService';
import type { BookingView } from '../src/services/bookingView';
import { cancelBooking } from '../src/services/cancellationService';
import { type ChartView, getChart, prepareChart } from '../src/services/chartService';
import { closeWindow, openWindow } from '../src/services/windowService';
import { createUsers, resetDb } from './helpers/db';
import { expectInvariantsHold } from './invariants';

let userId: number;

beforeEach(async () => {
  await resetDb();
  await openWindow();
  [userId = 0] = await createUsers(1);
});

afterEach(async () => {
  await expectInvariantsHold();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function book(classCode: string, names: string[]): Promise<BookingView> {
  const result = await createBooking(
    userId,
    { classCode, passengers: names.map((name) => ({ name })) },
    randomUUID(),
  );
  return result.booking;
}

/** "A1-03 → B4" style map of every occupied seat. */
function occupants(chart: ChartView): Map<string, string> {
  return new Map(
    chart.coaches.flatMap((coach) =>
      coach.seats.flatMap((seat) =>
        seat.passengerName === undefined ? [] : [[seat.label, seat.passengerName] as const],
      ),
    ),
  );
}

async function statusesOf(pnr: string): Promise<string[]> {
  const passengers = await prisma.passenger.findMany({
    where: { booking: { pnr } },
    orderBy: { position: 'asc' },
  });
  return passengers.map((p) => p.status);
}

describe('prepareChart: full scenario', () => {
  it('book past capacity → cancel 2 → close → prepare: exact promotions, expiries and seats', async () => {
    const confirmed: BookingView[] = [];
    for (let i = 1; i <= 20; i++) confirmed.push(await book('AC', [`B${i}`]));
    const waitlisted: BookingView[] = [];
    for (let i = 1; i <= 5; i++) waitlisted.push(await book('AC', [`W${i}`]));
    await cancelBooking(userId, confirmed[2]?.pnr ?? ''); // B3
    await cancelBooking(userId, confirmed[6]?.pnr ?? ''); // B7
    await closeWindow();

    const summary = await prepareChart();

    expect(summary.chartStatus).toBe('CHART_LOCKED');
    expect(summary.classes).toEqual([
      { classCode: 'AC', capacity: 20, promoted: 2, expired: 3, seatsUsed: 20 },
      { classCode: 'SL', capacity: 40, promoted: 0, expired: 0, seatsUsed: 0 },
    ]);

    // Edge case 11: WL1 and WL2 (lowest numbers) promoted, WL3–5 expired.
    const wlStatuses = await Promise.all(waitlisted.map((b) => statusesOf(b.pnr)));
    expect(wlStatuses.flat()).toEqual([
      'CONFIRMED',
      'CONFIRMED',
      'WAITLIST_EXPIRED',
      'WAITLIST_EXPIRED',
      'WAITLIST_EXPIRED',
    ]);

    // Seats in booking order: B1, B2, B4, B5, B6, B8 … B20, then W1, W2.
    const seated = [
      ...[1, 2, 4, 5, 6, ...Array.from({ length: 13 }, (_, i) => i + 8)].map((n) => `B${n}`),
      'W1',
      'W2',
    ];
    const expected = new Map(
      seated.map((name, i) => [`A1-${String(i + 1).padStart(2, '0')}`, name] as const),
    );
    expect(occupants(await getChart())).toEqual(expected);
  });

  it('edge case 11 within one group: WL group of 3 with 2 freed seats → 2 promoted, 1 expired', async () => {
    const first = await book('AC', ['A', 'B']);
    for (let i = 0; i < 18; i++) await book('AC', [`P${i}`]);
    const group = await book('AC', ['G1', 'G2', 'G3']); // WL1, WL2, WL3
    await cancelBooking(userId, first.pnr);
    await closeWindow();

    await prepareChart();

    expect(await statusesOf(group.pnr)).toEqual(['CONFIRMED', 'CONFIRMED', 'WAITLIST_EXPIRED']);
  });

  it('edge case 12: a group that cannot sit together is split across coaches, everyone seated', async () => {
    for (let i = 0; i < 6; i++) {
      await book(
        'SL',
        ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => `${x}${i}`),
      );
    }
    await book('SL', ['Late1', 'Late2', 'Late3', 'Late4']);
    await closeWindow();

    await prepareChart();

    const seats = occupants(await getChart());
    expect(seats.size).toBe(40);
    // S1-01..18 and S2-01..18 hold the six groups of 6; the group of 4 gets the
    // two seats left in each coach (tie on free seats → lower ordinal first).
    expect(['S1-19', 'S1-20', 'S2-19', 'S2-20'].map((label) => seats.get(label))).toEqual([
      'Late1',
      'Late2',
      'Late3',
      'Late4',
    ]);
  });
});

describe('prepareChart: state rules', () => {
  it('edge case 8: preparing twice returns the same chart and changes nothing', async () => {
    await book('SL', ['A', 'B']);
    await closeWindow();
    const first = await prepareChart();
    const chartBefore = await getChart();

    const second = await prepareChart();

    expect(second).toEqual(first);
    expect(await getChart()).toEqual(chartBefore);
  });

  it('edge case 8 (concurrent): five preparations at once → one chart, five equal answers', async () => {
    await book('SL', ['A', 'B']);
    await closeWindow();

    const results = await Promise.all(Array.from({ length: 5 }, () => prepareChart()));

    expect(results.every((r) => JSON.stringify(r) === JSON.stringify(results[0]))).toBe(true);
    expect(await prisma.seatAllocation.count()).toBe(2);
  });

  it('edge case 9: preparing while the window is open → WINDOW_STILL_OPEN, nothing changes', async () => {
    await book('SL', ['A']);
    await expect(prepareChart()).rejects.toMatchObject({
      code: 'WINDOW_STILL_OPEN',
      httpStatus: 409,
    });
    expect((await prisma.trainRun.findFirstOrThrow()).chartStatus).toBe('OPEN');
    expect(await prisma.seatAllocation.count()).toBe(0);
  });

  it('edge case 9: preparing before the window ever opened → WINDOW_STILL_OPEN', async () => {
    await resetDb(); // back to NOT_YET_OPEN
    await expect(prepareChart()).rejects.toMatchObject({ code: 'WINDOW_STILL_OPEN' });
  });

  it('a window closed by time (stored OPEN) is closed and charted in the same transaction', async () => {
    await book('SL', ['A']);
    await prisma.$executeRaw`
      UPDATE train_run SET booking_opens_at = clock_timestamp() - interval '1 hour',
                           booking_closes_at = clock_timestamp() - interval '1 second'`;

    await prepareChart();

    expect((await prisma.trainRun.findFirstOrThrow()).chartStatus).toBe('CHART_LOCKED');
  });

  it('edge case 10: after the chart, cancel → CHART_LOCKED, book → BOOKING_CLOSED, window → CHART_LOCKED', async () => {
    const booking = await book('SL', ['A']);
    await closeWindow();
    await prepareChart();

    await expect(cancelBooking(userId, booking.pnr)).rejects.toMatchObject({
      code: 'CHART_LOCKED',
    });
    await expect(book('SL', ['B'])).rejects.toMatchObject({ code: 'BOOKING_CLOSED' });
    await expect(openWindow()).rejects.toMatchObject({ code: 'CHART_LOCKED' });
    await expect(closeWindow()).rejects.toMatchObject({ code: 'CHART_LOCKED' });
  });
});

describe('prepareChart: atomicity', () => {
  async function setUpWaitlist(): Promise<void> {
    const first = await book('AC', ['A']);
    for (let i = 0; i < 19; i++) await book('AC', [`P${i}`]);
    await book('AC', ['Waiting']); // WL1
    await cancelBooking(userId, first.pnr);
    await closeWindow();
  }

  it('a crash after seats are inserted rolls everything back; a rerun succeeds', async () => {
    await setUpWaitlist();

    await expect(
      prepareChart({
        afterSeatsAllocated: () => Promise.reject(new Error('simulated crash')),
      }),
    ).rejects.toThrow('simulated crash');

    expect((await prisma.trainRun.findFirstOrThrow()).chartStatus).toBe('CLOSED');
    expect(await prisma.seatAllocation.count()).toBe(0);
    expect(await prisma.passenger.count({ where: { status: 'WAITLISTED' } })).toBe(1);

    const summary = await prepareChart();
    expect(summary.classes.find((c) => c.classCode === 'AC')).toMatchObject({
      promoted: 1,
      seatsUsed: 20,
    });
  });

  it('the in-transaction verification catches a broken chart and rolls back', async () => {
    await setUpWaitlist();

    // Corrupt the chart before verification: take a confirmed passenger's seat away.
    const corrupt = async (tx: TxClient): Promise<void> => {
      const one = await tx.seatAllocation.findFirstOrThrow();
      await tx.seatAllocation.delete({ where: { passengerId: one.passengerId } });
    };

    await expect(prepareChart({ afterSeatsAllocated: corrupt })).rejects.toThrow(
      InvariantViolationError,
    );
    expect((await prisma.trainRun.findFirstOrThrow()).chartStatus).toBe('CLOSED');
    expect(await prisma.seatAllocation.count()).toBe(0);
  });
});

describe('edge case 7: cancellation racing chart preparation', () => {
  it('is either cancelled-then-charted or rejected with CHART_LOCKED; never a cancelled passenger with a seat', async () => {
    const outcomes = { cancelledFirst: 0, chartFirst: 0 };

    for (let round = 0; round < 15; round++) {
      await resetDb();
      await openWindow();
      [userId = 0] = await createUsers(1); // resetDb removed the beforeEach user
      const bookings: BookingView[] = [];
      for (let i = 0; i < 5; i++) bookings.push(await book('AC', [`R${round}-${i}`]));
      await closeWindow();
      const target = bookings[2]?.pnr ?? '';

      const [cancel, chart] = await Promise.allSettled([
        cancelBooking(userId, target),
        prepareChart(),
      ]);

      expect(chart.status).toBe('fulfilled');
      const statuses = await statusesOf(target);
      const seats = await prisma.seatAllocation.count({
        where: { passenger: { booking: { pnr: target } } },
      });
      if (cancel.status === 'fulfilled') {
        outcomes.cancelledFirst++;
        expect(statuses).toEqual(['CANCELLED']);
        expect(seats).toBe(0);
      } else {
        outcomes.chartFirst++;
        expect(cancel.reason).toMatchObject({ code: 'CHART_LOCKED' });
        expect(statuses).toEqual(['CONFIRMED']);
        expect(seats).toBe(1);
      }
      await expectInvariantsHold();
    }

    expect(outcomes.cancelledFirst + outcomes.chartFirst).toBe(15);
    process.stdout.write(`\nedge case 7 orders seen: ${JSON.stringify(outcomes)}\n`);
  });
});

describe('edge case 7, forced order: chart prep holds the locks', () => {
  it('a cancellation arriving mid-chart waits on the class lock, then fails with CHART_LOCKED', async () => {
    const bookings: BookingView[] = [];
    for (let i = 0; i < 3; i++) bookings.push(await book('AC', [`C${i}`]));
    await closeWindow();
    const target = bookings[1]?.pnr ?? '';

    // Pause chart prep after it has taken train_run + every class lock.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let paused: () => void = () => undefined;
    const atPause = new Promise<void>((resolve) => {
      paused = resolve;
    });
    const chart = prepareChart({
      afterSeatsAllocated: async () => {
        paused();
        await gate;
      },
    });
    await atPause;

    // The cancellation must now be blocked on the AC class lock.
    let cancelSettled = false;
    const cancel = cancelBooking(userId, target).finally(() => {
      cancelSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(cancelSettled).toBe(false);

    release();
    await chart;
    await expect(cancel).rejects.toMatchObject({ code: 'CHART_LOCKED' });
    expect(await statusesOf(target)).toEqual(['CONFIRMED']);
  });
});
