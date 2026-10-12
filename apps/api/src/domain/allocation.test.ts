import { describe, expect, it } from '@jest/globals';
import {
  type AllocationInput,
  decideStatuses,
  freeSeatsForNewBooking,
  MAX_PASSENGERS_PER_BOOKING,
} from './allocation';
import { InvariantViolationError } from './errors';

const base: AllocationInput = {
  capacity: 40,
  confirmed: 0,
  waitlistExists: false,
  passengerCount: 1,
  nextWaitlistNumber: 1,
};

/** Compact view: e.g. ['CNF', 'CNF', 'WL3']. */
function summary(input: Partial<AllocationInput>): string[] {
  return decideStatuses({ ...base, ...input }).passengers.map((p) =>
    p.status === 'CONFIRMED' ? 'CNF' : `WL${String(p.waitlistNumber)}`,
  );
}

describe('freeSeatsForNewBooking (the fairness rule)', () => {
  it('is capacity − confirmed when nobody is waitlisted', () => {
    expect(freeSeatsForNewBooking(40, 37, false)).toBe(3);
  });

  it('is 0 whenever anyone is waitlisted, even if seats were freed', () => {
    expect(freeSeatsForNewBooking(40, 38, true)).toBe(0);
  });
});

describe('decideStatuses', () => {
  it('confirms everyone when there is room', () => {
    const result = decideStatuses({ ...base, confirmed: 10, passengerCount: 3 });
    expect(result.passengers).toEqual([
      { position: 1, status: 'CONFIRMED', waitlistNumber: null },
      { position: 2, status: 'CONFIRMED', waitlistNumber: null },
      { position: 3, status: 'CONFIRMED', waitlistNumber: null },
    ]);
    expect(result.nextWaitlistNumber).toBe(1); // unchanged: nobody waitlisted
  });

  it('edge case 2: group of 4 with 3 free → 3 CNF + 1 WL on one booking, by position', () => {
    const result = decideStatuses({ ...base, confirmed: 37, passengerCount: 4 });
    expect(summary({ confirmed: 37, passengerCount: 4 })).toEqual(['CNF', 'CNF', 'CNF', 'WL1']);
    expect(result.passengers[3]?.position).toBe(4);
    expect(result.nextWaitlistNumber).toBe(2);
  });

  it('confirms exactly the last free seat', () => {
    expect(summary({ confirmed: 39, passengerCount: 1 })).toEqual(['CNF']);
  });

  it('waitlists everyone with consecutive numbers when the class is full', () => {
    const result = decideStatuses({
      ...base,
      confirmed: 40,
      waitlistExists: true,
      passengerCount: 3,
      nextWaitlistNumber: 8,
    });
    expect(
      summary({ confirmed: 40, waitlistExists: true, passengerCount: 3, nextWaitlistNumber: 8 }),
    ).toEqual(['WL8', 'WL9', 'WL10']);
    expect(result.nextWaitlistNumber).toBe(11);
  });

  it('edge case 3: seats freed by cancellation still go to the waitlist, not a new booking', () => {
    // 38 confirmed after two cancellations, but WL1..WL5 are still waiting.
    expect(
      summary({ confirmed: 38, waitlistExists: true, passengerCount: 2, nextWaitlistNumber: 6 }),
    ).toEqual(['WL6', 'WL7']);
  });

  it('confirms normally once nobody is waitlisted, even if WL numbers were issued before', () => {
    // The waitlist was fully cancelled; numbers keep counting from 6 for future WLs.
    expect(
      summary({ confirmed: 38, waitlistExists: false, passengerCount: 3, nextWaitlistNumber: 6 }),
    ).toEqual(['CNF', 'CNF', 'WL6']);
  });

  it('accepts the maximum of 6 passengers', () => {
    expect(summary({ passengerCount: MAX_PASSENGERS_PER_BOOKING })).toHaveLength(6);
  });

  it.each<[string, Partial<AllocationInput>]>([
    ['capacity 0', { capacity: 0 }],
    ['confirmed below 0', { confirmed: -1 }],
    ['confirmed above capacity (invariant 1 already broken)', { confirmed: 41 }],
    ['0 passengers', { passengerCount: 0 }],
    ['7 passengers', { passengerCount: 7 }],
    ['fractional passenger count', { passengerCount: 1.5 }],
    ['next waitlist number 0', { nextWaitlistNumber: 0 }],
  ])('rejects impossible input: %s', (_label, override) => {
    expect(() => decideStatuses({ ...base, ...override })).toThrow(InvariantViolationError);
  });
});
