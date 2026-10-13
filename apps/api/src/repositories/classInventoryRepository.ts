import type { TxClient } from '../db';

export interface LockedInventory {
  capacity: number;
  nextWaitlistNumber: number;
}

/**
 * THE lock (CLAUDE.md): booking and cancellation take exactly this one row lock.
 * Every seat-affecting decision in a class waits here, one at a time, until the
 * holder commits. Returns null if this run does not sell the class.
 */
export async function lockClassInventory(
  tx: TxClient,
  runId: number,
  classCode: string,
): Promise<LockedInventory | null> {
  const rows = await tx.$queryRaw<{ capacity: number; next_waitlist_number: number }[]>`
    SELECT capacity, next_waitlist_number
    FROM class_inventory
    WHERE train_run_id = ${runId} AND class_code = ${classCode}
    FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) return null;
  return { capacity: row.capacity, nextWaitlistNumber: row.next_waitlist_number };
}

/** Advances the waitlist-number allocator by the number of passengers just waitlisted. */
export async function bumpWaitlistNumber(
  tx: TxClient,
  runId: number,
  classCode: string,
  by: number,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE class_inventory
    SET next_waitlist_number = next_waitlist_number + ${by}
    WHERE train_run_id = ${runId} AND class_code = ${classCode}`;
}

export interface ClassAvailabilityRow {
  classCode: string;
  className: string;
  capacity: number;
  confirmed: number;
  waitlisted: number;
}

/** Per-class capacity and live counts for one run, in class-code order (one grouped query). */
export async function classAvailability(
  tx: TxClient,
  runId: number,
): Promise<ClassAvailabilityRow[]> {
  const rows = await tx.$queryRaw<
    {
      class_code: string;
      class_name: string;
      capacity: number;
      confirmed: number;
      waitlisted: number;
    }[]
  >`
    SELECT ci.class_code, tc.name AS class_name, ci.capacity,
           COUNT(p.id) FILTER (WHERE p.status = 'CONFIRMED')::int AS confirmed,
           COUNT(p.id) FILTER (WHERE p.status = 'WAITLISTED')::int AS waitlisted
    FROM class_inventory ci
    JOIN travel_class tc ON tc.code = ci.class_code
    LEFT JOIN booking b ON b.train_run_id = ci.train_run_id AND b.class_code = ci.class_code
    LEFT JOIN passenger p ON p.booking_id = b.id
    WHERE ci.train_run_id = ${runId}
    GROUP BY ci.class_code, tc.name, ci.capacity
    ORDER BY ci.class_code`;
  return rows.map((row) => ({
    classCode: row.class_code,
    className: row.class_name,
    capacity: row.capacity,
    confirmed: row.confirmed,
    waitlisted: row.waitlisted,
  }));
}
