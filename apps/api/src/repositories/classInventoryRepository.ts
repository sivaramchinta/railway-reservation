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
