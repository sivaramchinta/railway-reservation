// The SQL invariant checker (DESIGN_SPEC §10). Each query returns the rows that
// VIOLATE a rule, so every query must return zero rows. Run after every
// integration and concurrency test.
import { expect } from '@jest/globals';
import { prisma } from '../src/db';

interface InvariantQuery {
  name: string;
  run: () => Promise<unknown[]>;
}

export const INVARIANT_QUERIES: readonly InvariantQuery[] = [
  {
    name: '1. Capacity: CONFIRMED passengers per class <= capacity',
    run: () => prisma.$queryRaw<unknown[]>`
      SELECT ci.class_code FROM class_inventory ci
      JOIN booking b ON b.train_run_id = ci.train_run_id AND b.class_code = ci.class_code
      JOIN passenger p ON p.booking_id = b.id AND p.status = 'CONFIRMED'
      GROUP BY ci.train_run_id, ci.class_code, ci.capacity
      HAVING COUNT(*) > ci.capacity`,
  },
  {
    name: '2. Seat uniqueness: a seat is allocated at most once per run',
    run: () => prisma.$queryRaw<unknown[]>`
      SELECT seat_id FROM seat_allocation GROUP BY train_run_id, seat_id HAVING COUNT(*) > 1`,
  },
  {
    name: '3. Waitlist numbers are unique per class',
    run: () => prisma.$queryRaw<unknown[]>`
      SELECT b.class_code, p.waitlist_number FROM passenger p JOIN booking b ON b.id = p.booking_id
      WHERE p.waitlist_number IS NOT NULL
      GROUP BY b.train_run_id, b.class_code, p.waitlist_number HAVING COUNT(*) > 1`,
  },
  {
    name: '4. Fair ordering: nobody confirmed at booking after a still-waiting WAITLISTED passenger',
    run: () => prisma.$queryRaw<unknown[]>`
      SELECT p2.id FROM passenger p1 JOIN booking b1 ON b1.id = p1.booking_id
      JOIN booking b2 ON b2.class_code = b1.class_code AND b2.train_run_id = b1.train_run_id
        AND b2.created_at > b1.created_at
      JOIN passenger p2 ON p2.booking_id = b2.id
      WHERE p1.status = 'WAITLISTED' AND p2.status = 'CONFIRMED' AND p2.waitlist_number IS NULL`,
  },
  {
    name: '5. After CHART_LOCKED: every CONFIRMED has one seat, nobody else has one, no WAITLISTED',
    run: () => prisma.$queryRaw<unknown[]>`
      SELECT p.id FROM passenger p JOIN booking b ON b.id = p.booking_id
      JOIN train_run r ON r.id = b.train_run_id AND r.chart_status = 'CHART_LOCKED'
      LEFT JOIN seat_allocation sa ON sa.passenger_id = p.id
      WHERE (p.status = 'CONFIRMED' AND sa.passenger_id IS NULL)
         OR (p.status <> 'CONFIRMED' AND sa.passenger_id IS NOT NULL)
         OR p.status = 'WAITLISTED'`,
  },
  {
    name: "6. A seat belongs to its passenger's class",
    run: () => prisma.$queryRaw<unknown[]>`
      SELECT sa.passenger_id FROM seat_allocation sa
      JOIN seat s ON s.id = sa.seat_id JOIN coach c ON c.id = s.coach_id
      JOIN passenger p ON p.id = sa.passenger_id JOIN booking b ON b.id = p.booking_id
      WHERE c.class_code <> b.class_code`,
  },
];

/** Runs every §10 query; fails the test naming each invariant that returned rows. */
export async function expectInvariantsHold(): Promise<void> {
  const violations: string[] = [];
  for (const invariant of INVARIANT_QUERIES) {
    const rows = await invariant.run();
    if (rows.length > 0) {
      violations.push(`${invariant.name}: ${rows.length} violating row(s)`);
    }
  }
  expect(violations).toEqual([]);
}
