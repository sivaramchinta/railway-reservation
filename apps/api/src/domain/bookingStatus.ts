import { InvariantViolationError } from './errors';
import type { PassengerStatus } from './passengerState';

export const BOOKING_STATUSES = [
  'CONFIRMED',
  'PARTIALLY_CONFIRMED',
  'WAITLISTED',
  'CANCELLED',
  'NOT_CONFIRMED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * A booking's status is DERIVED from its passengers, never stored
 * (DESIGN_SPEC §2):
 *
 * | Passenger statuses on the PNR                          | Booking status      |
 * |--------------------------------------------------------|---------------------|
 * | all CANCELLED                                          | CANCELLED           |
 * | all non-cancelled are CONFIRMED                        | CONFIRMED           |
 * | some CONFIRMED, some WAITLISTED / WAITLIST_EXPIRED     | PARTIALLY_CONFIRMED |
 * | none CONFIRMED, at least one WAITLISTED                | WAITLISTED          |
 * | none CONFIRMED, the rest WAITLIST_EXPIRED              | NOT_CONFIRMED       |
 */
export function deriveBookingStatus(statuses: readonly PassengerStatus[]): BookingStatus {
  if (statuses.length === 0) {
    throw new InvariantViolationError('A booking always has at least one passenger');
  }

  const active = statuses.filter((status) => status !== 'CANCELLED');
  if (active.length === 0) return 'CANCELLED';

  const confirmed = active.filter((status) => status === 'CONFIRMED').length;
  if (confirmed === active.length) return 'CONFIRMED';
  if (confirmed > 0) return 'PARTIALLY_CONFIRMED';

  return active.includes('WAITLISTED') ? 'WAITLISTED' : 'NOT_CONFIRMED';
}
