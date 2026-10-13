import { prisma } from '../db';
import { rankInWaitlist } from '../domain/allocation';
import { type BookingStatus, deriveBookingStatus } from '../domain/bookingStatus';
import { AppError } from '../domain/errors';
import type { PassengerStatus } from '../domain/passengerState';
import { isValidPnr } from '../domain/pnr';
import { seatLabel } from '../domain/seatMatching';
import {
  type BookingDetailsRecord,
  findBookingDetails,
  listBookingDetails,
} from '../repositories/bookingRepository';
import { stillWaitingByClass } from '../repositories/passengerRepository';

/** A booking as "My bookings" shows it: statuses, live WL position, seat after chart. */
export interface BookingDetails {
  pnr: string;
  classCode: string;
  createdAt: Date;
  status: BookingStatus;
  passengers: {
    position: number;
    name: string;
    status: PassengerStatus;
    waitlistNumber: number | null;
    currentWaitlistPosition: number | null;
    seatLabel: string | null;
  }[];
}

/** The signed-in user's bookings, newest first. */
export async function listMyBookings(userId: number): Promise<BookingDetails[]> {
  const records = await listBookingDetails(prisma, userId);
  return withLiveDetails(records);
}

/** One of the user's bookings. Not theirs, unknown or malformed → the same 404. */
export async function getMyBooking(userId: number, pnr: string): Promise<BookingDetails> {
  const normalized = pnr.trim().toUpperCase();
  const record = isValidPnr(normalized)
    ? await findBookingDetails(prisma, userId, normalized)
    : null;
  if (record === null) throw new AppError('NOT_FOUND', 'Booking not found');
  const [details] = await withLiveDetails([record]);
  if (details === undefined) throw new AppError('NOT_FOUND', 'Booking not found');
  return details;
}

async function withLiveDetails(records: BookingDetailsRecord[]): Promise<BookingDetails[]> {
  const runIds = [...new Set(records.map((r) => r.trainRunId))];
  const waiting = new Map<number, Map<string, number[]>>();
  for (const runId of runIds) waiting.set(runId, await stillWaitingByClass(prisma, runId));

  return records.map((record) => ({
    pnr: record.pnr,
    classCode: record.classCode,
    createdAt: record.createdAt,
    status: deriveBookingStatus(record.passengers.map((p) => p.status)),
    passengers: record.passengers.map((p) => {
      const stillWaiting = waiting.get(record.trainRunId)?.get(record.classCode) ?? [];
      return {
        position: p.position,
        name: p.name,
        status: p.status,
        waitlistNumber: p.waitlistNumber,
        currentWaitlistPosition:
          p.status === 'WAITLISTED' && p.waitlistNumber !== null
            ? rankInWaitlist(p.waitlistNumber, stillWaiting)
            : null,
        seatLabel:
          p.seatAllocation === null
            ? null
            : seatLabel(p.seatAllocation.seat.coach.label, p.seatAllocation.seat.seatNumber),
      };
    }),
  }));
}
