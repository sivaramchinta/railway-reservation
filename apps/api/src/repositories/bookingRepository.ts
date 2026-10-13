import type { TxClient } from '../db';
import type { PassengerStatus } from '../domain/passengerState';

export interface BookingRecord {
  id: bigint;
  pnr: string;
  classCode: string;
  createdAt: Date;
  passengers: {
    position: number;
    name: string;
    status: PassengerStatus;
    waitlistNumber: number | null;
  }[];
}

const bookingSelect = {
  id: true,
  pnr: true,
  classCode: true,
  createdAt: true,
  passengers: {
    select: { position: true, name: true, status: true, waitlistNumber: true },
    orderBy: { position: 'asc' },
  },
} as const;

export interface NewBooking {
  pnr: string;
  userId: number;
  runId: number;
  classCode: string;
  idempotencyKey: string;
}

/**
 * Inserts a booking and returns its id, or null if the insert hit a unique
 * constraint (PNR collision, or this user's idempotency key already used).
 *
 * Raw SQL on purpose: a Prisma create that violates a UNIQUE constraint throws,
 * and in PostgreSQL a failed statement aborts the whole transaction. ON CONFLICT
 * DO NOTHING turns the conflict into "no row returned", so the caller can retry.
 * created_at = clock_timestamp(): the time of the decision, under the lock.
 */
export async function insertBookingWithPnr(
  tx: TxClient,
  booking: NewBooking,
): Promise<bigint | null> {
  const rows = await tx.$queryRaw<{ id: bigint }[]>`
    INSERT INTO booking (pnr, user_id, train_run_id, class_code, idempotency_key, created_at)
    VALUES (${booking.pnr}, ${booking.userId}, ${booking.runId}, ${booking.classCode},
            ${booking.idempotencyKey}, clock_timestamp())
    ON CONFLICT DO NOTHING
    RETURNING id`;
  return rows[0]?.id ?? null;
}

export async function findBookingByIdempotencyKey(
  tx: TxClient,
  userId: number,
  idempotencyKey: string,
): Promise<BookingRecord | null> {
  return tx.booking.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    select: bookingSelect,
  });
}

export async function getBookingById(tx: TxClient, id: bigint): Promise<BookingRecord> {
  return tx.booking.findUniqueOrThrow({ where: { id }, select: bookingSelect });
}

export interface BookingOwnership {
  id: bigint;
  userId: number;
  trainRunId: number;
  classCode: string;
}

/** Who owns a PNR and which class lock guards it. These never change after insert. */
export async function findBookingOwnership(
  tx: TxClient,
  pnr: string,
): Promise<BookingOwnership | null> {
  return tx.booking.findUnique({
    where: { pnr },
    select: { id: true, userId: true, trainRunId: true, classCode: true },
  });
}

export interface BookingDetailsRecord {
  pnr: string;
  classCode: string;
  trainRunId: number;
  createdAt: Date;
  passengers: {
    position: number;
    name: string;
    status: PassengerStatus;
    waitlistNumber: number | null;
    seatAllocation: { seat: { seatNumber: number; coach: { label: string } } } | null;
  }[];
}

const bookingDetailsSelect = {
  pnr: true,
  classCode: true,
  trainRunId: true,
  createdAt: true,
  passengers: {
    orderBy: { position: 'asc' },
    select: {
      position: true,
      name: true,
      status: true,
      waitlistNumber: true,
      seatAllocation: {
        select: { seat: { select: { seatNumber: true, coach: { select: { label: true } } } } },
      },
    },
  },
} as const;

/** One user's bookings, newest first, with seats (if any). */
export async function listBookingDetails(
  tx: TxClient,
  userId: number,
): Promise<BookingDetailsRecord[]> {
  return tx.booking.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: bookingDetailsSelect,
  });
}

/** One booking by PNR, only if it belongs to `userId`. */
export async function findBookingDetails(
  tx: TxClient,
  userId: number,
  pnr: string,
): Promise<BookingDetailsRecord | null> {
  return tx.booking.findFirst({ where: { pnr, userId }, select: bookingDetailsSelect });
}
