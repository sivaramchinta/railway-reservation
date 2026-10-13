import type { TxClient } from '../db';
import type { CoachInput, PassengerGroup, SeatAssignment } from '../domain/seatMatching';

export interface LockedClass {
  classCode: string;
  capacity: number;
}

/**
 * Locks EVERY class_inventory row of the run, in class-code order. Chart prep is
 * the only transaction that takes more than one class lock, and it always takes
 * them in this fixed order (after train_run), so no deadlock cycle can form.
 */
export async function lockAllClassInventories(tx: TxClient, runId: number): Promise<LockedClass[]> {
  const rows = await tx.$queryRaw<{ class_code: string; capacity: number }[]>`
    SELECT class_code, capacity
    FROM class_inventory
    WHERE train_run_id = ${runId}
    ORDER BY class_code
    FOR UPDATE`;
  return rows.map((row) => ({ classCode: row.class_code, capacity: row.capacity }));
}

/** Promotes the first `limit` WAITLISTED passengers of a class, by waitlist number (one statement). */
export async function promoteWaitlisted(
  tx: TxClient,
  runId: number,
  classCode: string,
  limit: number,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE passenger SET status = 'CONFIRMED'
    WHERE id IN (
      SELECT p.id FROM passenger p
      JOIN booking b ON b.id = p.booking_id
      WHERE b.train_run_id = ${runId} AND b.class_code = ${classCode} AND p.status = 'WAITLISTED'
      ORDER BY p.waitlist_number
      LIMIT ${limit}
    )`;
}

/** Every passenger still WAITLISTED in the class becomes WAITLIST_EXPIRED (one statement). */
export async function expireWaitlisted(
  tx: TxClient,
  runId: number,
  classCode: string,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE passenger p SET status = 'WAITLIST_EXPIRED'
    FROM booking b
    WHERE b.id = p.booking_id
      AND b.train_run_id = ${runId} AND b.class_code = ${classCode}
      AND p.status = 'WAITLISTED'`;
}

/** The class's coaches (by ordinal) with their still-unallocated seats. */
export async function loadSeatLayout(
  tx: TxClient,
  runId: number,
  classCode: string,
): Promise<CoachInput[]> {
  const coaches = await tx.coach.findMany({
    where: { trainRunId: runId, classCode },
    orderBy: { ordinal: 'asc' },
    select: {
      label: true,
      ordinal: true,
      seats: {
        where: { allocations: { none: {} } },
        select: { id: true, seatNumber: true },
      },
    },
  });
  return coaches.map((coach) => ({
    label: coach.label,
    ordinal: coach.ordinal,
    seats: coach.seats.map((seat) => ({ id: seat.id, number: seat.seatNumber })),
  }));
}

/**
 * CONFIRMED passengers grouped by PNR, in booking order (created_at, then id),
 * each group in position order: the input matchSeats expects (DESIGN_SPEC §7).
 */
export async function loadConfirmedGroups(
  tx: TxClient,
  runId: number,
  classCode: string,
): Promise<PassengerGroup[]> {
  const bookings = await tx.booking.findMany({
    where: { trainRunId: runId, classCode, passengers: { some: { status: 'CONFIRMED' } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      passengers: {
        where: { status: 'CONFIRMED' },
        orderBy: { position: 'asc' },
        select: { id: true },
      },
    },
  });
  return bookings.map((booking) => ({ passengerIds: booking.passengers.map((p) => p.id) }));
}

/** All seat allocations of the class in one INSERT. */
export async function insertSeatAllocations(
  tx: TxClient,
  runId: number,
  assignments: readonly SeatAssignment[],
): Promise<void> {
  await tx.seatAllocation.createMany({
    data: assignments.map((a) => ({
      passengerId: a.passengerId,
      trainRunId: runId,
      seatId: a.seatId,
    })),
  });
}

/**
 * The §10 invariants that a finished chart must satisfy, scoped to this run and
 * written to work BEFORE chart_status is set (so they can run inside chart prep).
 * Returns a description of each violated invariant; empty = the chart is valid.
 */
export async function verifyChart(tx: TxClient, runId: number): Promise<string[]> {
  const [row] = await tx.$queryRaw<
    { over_capacity: number; seat_twice: number; seat_mismatch: number; wrong_class: number }[]
  >`
    SELECT
      (SELECT COUNT(*)::int FROM (
         SELECT ci.class_code FROM class_inventory ci
         JOIN booking b ON b.train_run_id = ci.train_run_id AND b.class_code = ci.class_code
         JOIN passenger p ON p.booking_id = b.id AND p.status = 'CONFIRMED'
         WHERE ci.train_run_id = ${runId}
         GROUP BY ci.class_code, ci.capacity
         HAVING COUNT(*) > ci.capacity) over) AS over_capacity,
      (SELECT COUNT(*)::int FROM (
         SELECT seat_id FROM seat_allocation WHERE train_run_id = ${runId}
         GROUP BY seat_id HAVING COUNT(*) > 1) dup) AS seat_twice,
      (SELECT COUNT(*)::int FROM passenger p
         JOIN booking b ON b.id = p.booking_id AND b.train_run_id = ${runId}
         LEFT JOIN seat_allocation sa ON sa.passenger_id = p.id
         WHERE (p.status = 'CONFIRMED' AND sa.passenger_id IS NULL)
            OR (p.status <> 'CONFIRMED' AND sa.passenger_id IS NOT NULL)
            OR p.status = 'WAITLISTED') AS seat_mismatch,
      (SELECT COUNT(*)::int FROM seat_allocation sa
         JOIN seat s ON s.id = sa.seat_id JOIN coach c ON c.id = s.coach_id
         JOIN passenger p ON p.id = sa.passenger_id JOIN booking b ON b.id = p.booking_id
         WHERE sa.train_run_id = ${runId} AND c.class_code <> b.class_code) AS wrong_class`;
  const violations: string[] = [];
  if (row === undefined) return ['verification query returned no row'];
  if (row.over_capacity > 0) violations.push('a class has more CONFIRMED passengers than seats');
  if (row.seat_twice > 0) violations.push('a seat is allocated twice');
  if (row.seat_mismatch > 0) {
    violations.push(
      'a CONFIRMED passenger has no seat, someone else has one, or someone is WAITLISTED',
    );
  }
  if (row.wrong_class > 0) violations.push('a seat is in the wrong class for its passenger');
  return violations;
}

export interface ChartClassCounts {
  classCode: string;
  capacity: number;
  promoted: number;
  expired: number;
  seatsUsed: number;
}

/**
 * Per-class chart outcome, derived from the data (nothing extra is stored):
 * a promoted passenger is CONFIRMED and still carries its waitlist number.
 */
export async function chartClassCounts(tx: TxClient, runId: number): Promise<ChartClassCounts[]> {
  const rows = await tx.$queryRaw<
    {
      class_code: string;
      capacity: number;
      promoted: number;
      expired: number;
      seats_used: number;
    }[]
  >`
    SELECT ci.class_code, ci.capacity,
           COUNT(p.id) FILTER (WHERE p.status = 'CONFIRMED' AND p.waitlist_number IS NOT NULL)::int AS promoted,
           COUNT(p.id) FILTER (WHERE p.status = 'WAITLIST_EXPIRED')::int AS expired,
           COUNT(sa.passenger_id)::int AS seats_used
    FROM class_inventory ci
    LEFT JOIN booking b ON b.train_run_id = ci.train_run_id AND b.class_code = ci.class_code
    LEFT JOIN passenger p ON p.booking_id = b.id
    LEFT JOIN seat_allocation sa ON sa.passenger_id = p.id
    WHERE ci.train_run_id = ${runId}
    GROUP BY ci.class_code, ci.capacity
    ORDER BY ci.class_code`;
  return rows.map((row) => ({
    classCode: row.class_code,
    capacity: row.capacity,
    promoted: row.promoted,
    expired: row.expired,
    seatsUsed: row.seats_used,
  }));
}

export interface ChartLayoutCoach {
  label: string;
  classCode: string;
  seats: {
    number: number;
    allocation: { passengerName: string; pnr: string } | null;
  }[];
}

/** Every coach and seat of the run with its occupant (if any), for the admin seat map. */
export async function loadChartLayout(tx: TxClient, runId: number): Promise<ChartLayoutCoach[]> {
  const coaches = await tx.coach.findMany({
    where: { trainRunId: runId },
    orderBy: [{ classCode: 'asc' }, { ordinal: 'asc' }],
    select: {
      label: true,
      classCode: true,
      seats: {
        orderBy: { seatNumber: 'asc' },
        select: {
          seatNumber: true,
          allocations: {
            where: { trainRunId: runId },
            select: { passenger: { select: { name: true, booking: { select: { pnr: true } } } } },
          },
        },
      },
    },
  });
  return coaches.map((coach) => ({
    label: coach.label,
    classCode: coach.classCode,
    seats: coach.seats.map((seat) => {
      const passenger = seat.allocations[0]?.passenger;
      return {
        number: seat.seatNumber,
        allocation:
          passenger === undefined
            ? null
            : { passengerName: passenger.name, pnr: passenger.booking.pnr },
      };
    }),
  }));
}
