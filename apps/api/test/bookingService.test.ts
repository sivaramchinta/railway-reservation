// Integration tests for createBooking against real PostgreSQL (testcontainers).
// DESIGN_SPEC §12 edge cases 2, 3, 4, 5 (sequential), 14 and 15.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { prisma } from '../src/db';
import { isValidPnr } from '../src/domain/pnr';
import {
  type BookingDeps,
  type CreateBookingResult,
  createBooking,
  MAX_PNR_ATTEMPTS,
} from '../src/services/bookingService';
import { createUsers, currentRunId, openBookingWindow, resetDb } from './helpers/db';
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

function book(
  classCode: string,
  names: string[],
  options: { user?: number; key?: string; deps?: BookingDeps } = {},
): Promise<CreateBookingResult> {
  return createBooking(
    options.user ?? userId,
    { classCode, passengers: names.map((name) => ({ name })) },
    options.key ?? randomUUID(),
    options.deps,
  );
}

/** Books `count` confirmed passengers in groups of up to 6. */
async function fill(classCode: string, count: number): Promise<void> {
  for (let left = count; left > 0; left -= 6) {
    await book(
      classCode,
      Array.from({ length: Math.min(6, left) }, (_, i) => `Filler ${i + 1}`),
    );
  }
}

/** Compact view of a result's passengers, e.g. ['CNF', 'CNF', 'WL1']. */
function summary(result: CreateBookingResult): string[] {
  return result.booking.passengers.map((p) =>
    p.status === 'CONFIRMED' ? 'CNF' : `WL${String(p.waitlistNumber)}`,
  );
}

async function nextWaitlistNumber(classCode: string): Promise<number> {
  const row = await prisma.classInventory.findUniqueOrThrow({
    where: { trainRunId_classCode: { trainRunId: await currentRunId(), classCode } },
  });
  return row.nextWaitlistNumber;
}

describe('createBooking: happy path', () => {
  it('confirms a single passenger, with a valid PNR and trimmed name', async () => {
    const result = await book('AC', ['  Asha Rao  ']);
    expect(result.created).toBe(true);
    expect(isValidPnr(result.booking.pnr)).toBe(true);
    expect(result.booking.status).toBe('CONFIRMED');
    expect(result.booking.passengers).toEqual([
      { position: 1, name: 'Asha Rao', status: 'CONFIRMED', waitlistNumber: null },
    ]);
    expect(await prisma.booking.count()).toBe(1);
  });
});

describe('edge case 2: group split', () => {
  it('group of 4 with 3 free → 3 CONFIRMED + 1 WAITLISTED on one PNR', async () => {
    await fill('SL', 37);
    const result = await book('SL', ['A', 'B', 'C', 'D']);
    expect(summary(result)).toEqual(['CNF', 'CNF', 'CNF', 'WL1']);
    expect(result.booking.status).toBe('PARTIALLY_CONFIRMED');
    expect(await nextWaitlistNumber('SL')).toBe(2);
  });
});

describe('edge case 3: fairness after a cancellation', () => {
  it('a freed seat goes to the waitlist, not to a new booking', async () => {
    await fill('AC', 20);
    const waitlisted = await book('AC', ['W1', 'W2']);
    expect(summary(waitlisted)).toEqual(['WL1', 'WL2']);

    // Phase 4 builds cancellation; here one confirmed passenger is cancelled directly.
    const victim = await prisma.passenger.findFirstOrThrow({ where: { status: 'CONFIRMED' } });
    await prisma.passenger.update({ where: { id: victim.id }, data: { status: 'CANCELLED' } });

    // 19 confirmed of 20, but WL1 and WL2 are still waiting: the newcomer is WL3.
    const newcomer = await book('AC', ['Late']);
    expect(summary(newcomer)).toEqual(['WL3']);
  });

  it('a freed seat with an empty waitlist confirms the next booking normally', async () => {
    await fill('AC', 20);
    const victim = await prisma.passenger.findFirstOrThrow({ where: { status: 'CONFIRMED' } });
    await prisma.passenger.update({ where: { id: victim.id }, data: { status: 'CANCELLED' } });

    expect(summary(await book('AC', ['Lucky']))).toEqual(['CNF']);
  });
});

describe('edge case 4: booking window (database time)', () => {
  it('rejects a booking after booking_closes_at, even though the stored status is OPEN', async () => {
    await prisma.$executeRaw`UPDATE train_run SET booking_closes_at = clock_timestamp() - interval '1 millisecond'`;
    await expect(book('SL', ['A'])).rejects.toMatchObject({ code: 'BOOKING_CLOSED' });
  });

  it.each(['NOT_YET_OPEN', 'CLOSED', 'CHART_LOCKED'] as const)(
    'rejects a booking while the chart status is %s',
    async (status) => {
      await prisma.trainRun.updateMany({ data: { chartStatus: status } });
      await expect(book('SL', ['A'])).rejects.toMatchObject({ code: 'BOOKING_CLOSED' });
    },
  );

  it('writes nothing when it rejects', async () => {
    await prisma.trainRun.updateMany({ data: { chartStatus: 'CLOSED' } });
    await expect(book('SL', ['A', 'B'])).rejects.toMatchObject({ code: 'BOOKING_CLOSED' });
    expect(await prisma.booking.count()).toBe(0);
    expect(await nextWaitlistNumber('SL')).toBe(1);
  });
});

describe('edge case 5: idempotency (sequential)', () => {
  it('the same Idempotency-Key twice returns the same booking, created once', async () => {
    await fill('AC', 20); // so the replayed booking is waitlisted
    const key = randomUUID();
    const first = await book('AC', ['A', 'B'], { key });
    const second = await book('AC', ['A', 'B'], { key });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.booking).toEqual(first.booking);
    expect(await prisma.booking.count({ where: { idempotencyKey: key } })).toBe(1);
    expect(await nextWaitlistNumber('AC')).toBe(3); // bumped once, not twice
  });

  it('the same key from a different user is a different booking', async () => {
    const key = randomUUID();
    const mine = await book('SL', ['A'], { key });
    const theirs = await book('SL', ['A'], { key, user: otherUserId });
    expect(theirs.created).toBe(true);
    expect(theirs.booking.pnr).not.toBe(mine.booking.pnr);
  });
});

describe('edge case 14: invalid input → VALIDATION_FAILED, nothing written', () => {
  const sixty = 'x'.repeat(60);
  it.each<[string, unknown, unknown]>([
    ['0 passengers', { classCode: 'SL', passengers: [] }, randomUUID()],
    ['7 passengers', { classCode: 'SL', passengers: Array(7).fill({ name: 'A' }) }, randomUUID()],
    ['blank name', { classCode: 'SL', passengers: [{ name: '   ' }] }, randomUUID()],
    ['name over 60 chars', { classCode: 'SL', passengers: [{ name: `${sixty}y` }] }, randomUUID()],
    ['missing class', { passengers: [{ name: 'A' }] }, randomUUID()],
    ['unknown class', { classCode: 'ZZ', passengers: [{ name: 'A' }] }, randomUUID()],
    ['body not an object', 'hello', randomUUID()],
    ['missing Idempotency-Key', { classCode: 'SL', passengers: [{ name: 'A' }] }, undefined],
    ['Idempotency-Key not a UUID', { classCode: 'SL', passengers: [{ name: 'A' }] }, 'abc'],
  ])('%s', async (_label, input, key) => {
    await expect(createBooking(userId, input, key)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      httpStatus: 422,
    });
    expect(await prisma.booking.count()).toBe(0);
  });

  it('accepts exactly 6 passengers and a 60-character name', async () => {
    const result = await book('SL', [sixty, 'B', 'C', 'D', 'E', 'F']);
    expect(result.booking.passengers).toHaveLength(6);
  });
});

describe('edge case 15: PNR collision', () => {
  /** A PNR source that returns the given codes in order (then the last one forever). */
  function pnrs(...codes: string[]): BookingDeps & { calls: number } {
    const source = {
      calls: 0,
      generatePnr: () => codes[Math.min(source.calls++, codes.length - 1)] ?? 'ZZZZZZZZZZ',
    };
    return source;
  }

  it('retries with a new PNR and succeeds, in the same transaction', async () => {
    await book('SL', ['First'], { deps: pnrs('AAAAAAAAAA') });
    const source = pnrs('AAAAAAAAAA', 'AAAAAAAAAA', 'BBBBBBBBBB');

    const result = await book('SL', ['Second'], { deps: source });

    expect(result.booking.pnr).toBe('BBBBBBBBBB');
    expect(source.calls).toBe(3);
    expect(await prisma.booking.count()).toBe(2);
  });

  it(`fails after ${MAX_PNR_ATTEMPTS} collisions and writes nothing`, async () => {
    await fill('AC', 20);
    await book('AC', ['Holder'], { deps: pnrs('AAAAAAAAAA') }); // WL1
    const source = pnrs('AAAAAAAAAA');

    await expect(book('AC', ['Unlucky'], { deps: source })).rejects.toThrow('unique PNR');

    expect(source.calls).toBe(MAX_PNR_ATTEMPTS);
    expect(await nextWaitlistNumber('AC')).toBe(2); // rolled back: no WL2 issued
  });
});
