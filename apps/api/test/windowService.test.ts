// Admin window control (DESIGN_SPEC §2 + the 2026-10-13 decision) and the run
// summary behind GET /api/run, against real PostgreSQL.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { prisma } from '../src/db';
import { createBooking } from '../src/services/bookingService';
import { cancelBooking } from '../src/services/cancellationService';
import { getRunSummary } from '../src/services/runService';
import { closeWindow, openWindow } from '../src/services/windowService';
import { createUsers, resetDb } from './helpers/db';
import { expectInvariantsHold } from './invariants';

const HOUR_MS = 60 * 60 * 1000;
let userId: number;

beforeEach(async () => {
  await resetDb(); // run is NOT_YET_OPEN, closes in 2 days
  [userId = 0] = await createUsers(1);
});

afterEach(async () => {
  await expectInvariantsHold();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function storedRun() {
  return prisma.trainRun.findFirstOrThrow();
}

async function dbClock(): Promise<Date> {
  const [row] = await prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  if (row === undefined) throw new Error('no clock');
  return row.now;
}

function book(classCode: string, names: string[]) {
  return createBooking(
    userId,
    { classCode, passengers: names.map((name) => ({ name })) },
    randomUUID(),
  );
}

describe('openWindow', () => {
  it('NOT_YET_OPEN → OPEN: opens at database time, keeps a future closing time', async () => {
    const before = await storedRun();
    const t0 = await dbClock();

    const summary = await openWindow();

    const after = await storedRun();
    expect(summary.chartStatus).toBe('OPEN');
    expect(after.chartStatus).toBe('OPEN');
    expect(after.bookingOpensAt.getTime()).toBeGreaterThanOrEqual(t0.getTime());
    expect(after.bookingClosesAt).toEqual(before.bookingClosesAt);
    expect((await book('SL', ['A'])).created).toBe(true); // bookings now accepted
  });

  it('gives a fresh 2-day window if the closing time already passed', async () => {
    await prisma.$executeRaw`
      UPDATE train_run SET booking_opens_at = clock_timestamp() - interval '3 days',
                           booking_closes_at = clock_timestamp() - interval '1 day'`;
    const t0 = await dbClock();

    await openWindow();

    const after = await storedRun();
    const twoDays = 48 * HOUR_MS;
    expect(after.bookingClosesAt.getTime() - t0.getTime()).toBeGreaterThanOrEqual(twoDays - 1000);
    expect(after.bookingClosesAt.getTime() - t0.getTime()).toBeLessThanOrEqual(twoDays + 5000);
  });

  it('is a no-op when already open (idempotent): nothing changes', async () => {
    await openWindow();
    const first = await storedRun();

    const summary = await openWindow();

    expect(summary.chartStatus).toBe('OPEN');
    expect(await storedRun()).toEqual(first);
  });

  it('two admins opening at the same instant → both succeed, one effect', async () => {
    const results = await Promise.all([openWindow(), openWindow(), openWindow()]);
    expect(results.every((r) => r.chartStatus === 'OPEN')).toBe(true);
    expect(new Set(results.map((r) => r.bookingOpensAt.getTime())).size).toBe(1);
  });

  it('after close → INVALID_WINDOW_TRANSITION (409): a window never re-opens', async () => {
    await openWindow();
    await closeWindow();
    await expect(openWindow()).rejects.toMatchObject({
      code: 'INVALID_WINDOW_TRANSITION',
      httpStatus: 409,
    });
    expect((await storedRun()).chartStatus).toBe('CLOSED');
  });
});

describe('closeWindow', () => {
  it('OPEN → CLOSED: closes at database time; bookings are then refused', async () => {
    await openWindow();
    const t0 = await dbClock();

    const summary = await closeWindow();

    const after = await storedRun();
    expect(summary.chartStatus).toBe('CLOSED');
    expect(after.bookingClosesAt.getTime()).toBeGreaterThanOrEqual(t0.getTime());
    expect(after.bookingOpensAt.getTime()).toBeLessThan(after.bookingClosesAt.getTime());
    await expect(book('SL', ['A'])).rejects.toMatchObject({ code: 'BOOKING_CLOSED' });
  });

  it('is a no-op when already closed', async () => {
    await openWindow();
    await closeWindow();
    const first = await storedRun();
    await closeWindow();
    expect(await storedRun()).toEqual(first);
  });

  it('is a no-op when the window already closed by time (stored OPEN, past closes_at)', async () => {
    await openWindow();
    await prisma.$executeRaw`UPDATE train_run SET booking_opens_at = clock_timestamp() - interval '1 hour',
                           booking_closes_at = clock_timestamp() - interval '1 minute'`;
    const first = await storedRun();

    const summary = await closeWindow();

    expect(summary.chartStatus).toBe('CLOSED'); // effective
    expect(await storedRun()).toEqual(first); // the closing time is never moved
  });

  it('before open → INVALID_WINDOW_TRANSITION (409)', async () => {
    await expect(closeWindow()).rejects.toMatchObject({ code: 'INVALID_WINDOW_TRANSITION' });
    expect((await storedRun()).chartStatus).toBe('NOT_YET_OPEN');
  });
});

describe('after the chart is locked', () => {
  it.each([
    ['open', openWindow],
    ['close', closeWindow],
  ])('%s → CHART_LOCKED (409)', async (_label, action) => {
    await prisma.trainRun.updateMany({ data: { chartStatus: 'CHART_LOCKED' } });
    await expect(action()).rejects.toMatchObject({ code: 'CHART_LOCKED', httpStatus: 409 });
  });
});

describe('getRunSummary', () => {
  it('reports the train, effective status and per-class counts', async () => {
    await openWindow();
    await book('AC', ['A', 'B', 'C']);

    const summary = await getRunSummary();

    expect(summary).toMatchObject({ trainNumber: '12345', trainName: 'Demo Express' });
    expect(summary.classes).toEqual([
      { code: 'AC', name: 'AC', capacity: 20, confirmed: 3, available: 17, waitlistLength: 0 },
      { code: 'SL', name: 'Sleeper', capacity: 40, confirmed: 0, available: 40, waitlistLength: 0 },
    ]);
  });

  it('shows 0 available while anyone is waitlisted, even after a cancellation frees a seat', async () => {
    await openWindow();
    const first = await book('AC', ['A']);
    for (let i = 0; i < 19; i++) await book('AC', [`P${i}`]);
    await book('AC', ['Waiting']);
    await cancelBooking(userId, first.booking.pnr);

    const ac = (await getRunSummary()).classes.find((c) => c.code === 'AC');

    expect(ac).toMatchObject({ confirmed: 19, available: 0, waitlistLength: 1 });
  });
});
