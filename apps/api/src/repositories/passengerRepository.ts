import type { TxClient } from '../db';
import type { PassengerStatus } from '../domain/passengerState';

/** CONFIRMED passengers in a class. Computed under the class lock, never stored. */
export async function countConfirmed(
  tx: TxClient,
  runId: number,
  classCode: string,
): Promise<number> {
  return tx.passenger.count({
    where: { status: 'CONFIRMED', booking: { trainRunId: runId, classCode } },
  });
}

/** Is anyone in the class WAITLISTED right now? (input to the fairness rule) */
export async function waitlistExists(
  tx: TxClient,
  runId: number,
  classCode: string,
): Promise<boolean> {
  const first = await tx.passenger.findFirst({
    where: { status: 'WAITLISTED', booking: { trainRunId: runId, classCode } },
    select: { id: true },
  });
  return first !== null;
}

export interface NewPassenger {
  position: number;
  name: string;
  status: PassengerStatus;
  waitlistNumber: number | null;
}

export async function insertPassengers(
  tx: TxClient,
  bookingId: bigint,
  passengers: readonly NewPassenger[],
): Promise<void> {
  await tx.passenger.createMany({
    data: passengers.map((p) => ({
      bookingId,
      position: p.position,
      name: p.name,
      status: p.status,
      waitlistNumber: p.waitlistNumber,
    })),
  });
}

/** Cancels every still-active (CONFIRMED / WAITLISTED) passenger of a booking. Returns how many changed. */
export async function cancelActivePassengers(tx: TxClient, bookingId: bigint): Promise<number> {
  const result = await tx.passenger.updateMany({
    where: { bookingId, status: { in: ['CONFIRMED', 'WAITLISTED'] } },
    data: { status: 'CANCELLED' },
  });
  return result.count;
}
