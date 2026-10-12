import { describe, expect, it } from '@jest/globals';
import { type BookingStatus, deriveBookingStatus } from './bookingStatus';
import { InvariantViolationError } from './errors';
import type { PassengerStatus } from './passengerState';

const CASES: readonly (readonly [string, readonly PassengerStatus[], BookingStatus])[] = [
  // One row per line of the DESIGN_SPEC §2 table, plus the realistic variants.
  ['all cancelled', ['CANCELLED', 'CANCELLED'], 'CANCELLED'],
  ['single passenger cancelled', ['CANCELLED'], 'CANCELLED'],
  ['all confirmed', ['CONFIRMED', 'CONFIRMED', 'CONFIRMED'], 'CONFIRMED'],
  [
    'group split at booking: 3 CNF + 1 WL',
    ['CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'WAITLISTED'],
    'PARTIALLY_CONFIRMED',
  ],
  ['after chart: 1 CNF + 1 expired', ['CONFIRMED', 'WAITLIST_EXPIRED'], 'PARTIALLY_CONFIRMED'],
  ['all waitlisted', ['WAITLISTED', 'WAITLISTED'], 'WAITLISTED'],
  ['all expired at chart', ['WAITLIST_EXPIRED', 'WAITLIST_EXPIRED'], 'NOT_CONFIRMED'],
  // Defensive rows: whole-PNR cancellation means these mixes should not occur,
  // but the rules still give a sensible answer by ignoring cancelled passengers.
  ['cancelled ignored: rest confirmed', ['CANCELLED', 'CONFIRMED'], 'CONFIRMED'],
  ['waitlisted and expired, none confirmed', ['WAITLISTED', 'WAITLIST_EXPIRED'], 'WAITLISTED'],
];

describe('deriveBookingStatus', () => {
  it.each(CASES)('%s', (_label, statuses, expected) => {
    expect(deriveBookingStatus(statuses)).toBe(expected);
  });

  it('does not depend on passenger order', () => {
    expect(deriveBookingStatus(['WAITLISTED', 'CONFIRMED'])).toBe('PARTIALLY_CONFIRMED');
    expect(deriveBookingStatus(['CONFIRMED', 'WAITLISTED'])).toBe('PARTIALLY_CONFIRMED');
  });

  it('rejects a booking with no passengers', () => {
    expect(() => deriveBookingStatus([])).toThrow(InvariantViolationError);
  });
});
