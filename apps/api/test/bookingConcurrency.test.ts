// Concurrency tests: many bookings released at once, each on its OWN pooled
// connection (pool 150 >= requests), so they genuinely race inside PostgreSQL
// and are serialized only by the class_inventory row lock. DESIGN_SPEC §12 edge
// cases 1 and 5 (concurrent).
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { prisma } from '../src/db';
import { type CreateBookingResult, createBooking } from '../src/services/bookingService';
import {
  classOutcome as outcome,
  createUsers,
  oneTo,
  openBookingWindow,
  resetDb,
} from './helpers/db';
import { expectInvariantsHold } from './invariants';

beforeEach(async () => {
  await resetDb();
  await openBookingWindow();
});

afterEach(async () => {
  await expectInvariantsHold();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('concurrent bookings', () => {
  it('edge case 1: 120 concurrent single-passenger bookings on SL (capacity 40) → exactly 40 CONFIRMED, WL 1..80', async () => {
    const users = await createUsers(120);

    const results = await Promise.all(
      users.map((user) =>
        createBooking(user, { classCode: 'SL', passengers: [{ name: 'P' }] }, randomUUID()),
      ),
    );

    expect(results.every((r) => r.created)).toBe(true);
    const sl = await outcome('SL');
    expect(sl.confirmed).toBe(40);
    expect(sl.waitlistNumbers).toEqual(oneTo(80)); // unique and gap-free
    expect(sl.nextWaitlistNumber).toBe(81);
  });

  it('mixed group sizes concurrently: capacity never exceeded, waitlist gap-free', async () => {
    const users = await createUsers(60);
    const sizes = users.map((_, i) => (i % 6) + 1); // 1..6 repeated: 210 passengers

    await Promise.all(
      users.map((user, i) =>
        createBooking(
          user,
          {
            classCode: 'SL',
            passengers: Array.from({ length: sizes[i] ?? 1 }, (_, p) => ({ name: `P${p + 1}` })),
          },
          randomUUID(),
        ),
      ),
    );

    const total = sizes.reduce((sum, n) => sum + n, 0);
    const sl = await outcome('SL');
    expect(sl.confirmed).toBe(40); // partial confirmation fills capacity exactly
    expect(sl.waitlistNumbers).toEqual(oneTo(total - 40));
  });

  it('edge case 5: the same Idempotency-Key ×10 at the same instant → exactly one booking', async () => {
    const [user = 0] = await createUsers(1);
    const key = randomUUID();
    const body = { classCode: 'SL', passengers: [{ name: 'A' }, { name: 'B' }] };

    const results = await Promise.all(
      Array.from({ length: 10 }, () => createBooking(user, body, key)),
    );

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.booking.pnr)).size).toBe(1);
    expect(await prisma.booking.count()).toBe(1);
    expect(await prisma.passenger.count()).toBe(2);
  });

  it('the same key racing in two different classes (two different locks) → still one booking', async () => {
    const [user = 0] = await createUsers(1);
    const key = randomUUID();

    const results: CreateBookingResult[] = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createBooking(
          user,
          { classCode: i % 2 === 0 ? 'SL' : 'AC', passengers: [{ name: 'A' }] },
          key,
        ),
      ),
    );

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.booking.pnr)).size).toBe(1);
    expect(await prisma.booking.count()).toBe(1);
  });

  it('SL and AC bookings run concurrently without interfering', async () => {
    const users = await createUsers(90);

    await Promise.all(
      users.map((user, i) =>
        createBooking(
          user,
          { classCode: i < 60 ? 'SL' : 'AC', passengers: [{ name: 'P' }] },
          randomUUID(),
        ),
      ),
    );

    const [sl, ac] = await Promise.all([outcome('SL'), outcome('AC')]);
    expect(sl.confirmed).toBe(40);
    expect(sl.waitlistNumbers).toEqual(oneTo(20));
    expect(ac.confirmed).toBe(20);
    expect(ac.waitlistNumbers).toEqual(oneTo(10));
  });
});
