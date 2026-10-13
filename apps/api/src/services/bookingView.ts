import { type BookingStatus, deriveBookingStatus } from '../domain/bookingStatus';
import type { PassengerStatus } from '../domain/passengerState';
import type { BookingRecord } from '../repositories/bookingRepository';

/** A booking as services return it. Never contains the internal booking.id. */
export interface BookingView {
  pnr: string;
  classCode: string;
  createdAt: Date;
  /** Derived from the passengers, never stored (DESIGN_SPEC §2). */
  status: BookingStatus;
  passengers: {
    position: number;
    name: string;
    status: PassengerStatus;
    waitlistNumber: number | null;
  }[];
}

export function toView(record: BookingRecord): BookingView {
  return {
    pnr: record.pnr,
    classCode: record.classCode,
    createdAt: record.createdAt,
    status: deriveBookingStatus(record.passengers.map((p) => p.status)),
    passengers: record.passengers,
  };
}
