import { InvariantViolationError } from './errors';

export const MAX_PASSENGERS_PER_BOOKING = 6;

export interface AllocationInput {
  /** Seats in the class. */
  capacity: number;
  /** CONFIRMED passengers already in the class (counted under the class lock). */
  confirmed: number;
  /** Is anyone in the class currently WAITLISTED? */
  waitlistExists: boolean;
  /** Passengers on this booking, 1..6. */
  passengerCount: number;
  /** class_inventory.next_waitlist_number: the next permanent WL number to issue. */
  nextWaitlistNumber: number;
}

export interface PassengerDecision {
  /** 1-based position on the booking. */
  position: number;
  status: 'CONFIRMED' | 'WAITLISTED';
  /** Set only for WAITLISTED passengers. */
  waitlistNumber: number | null;
}

export interface AllocationResult {
  passengers: PassengerDecision[];
  /** The value to write back to class_inventory.next_waitlist_number. */
  nextWaitlistNumber: number;
}

/**
 * The fairness rule (invariant 3): while anyone in the class is waitlisted, a
 * new booking gets no seats, even if cancellations freed some. Freed seats
 * belong to the waitlist and are handed out in order at chart preparation.
 */
export function freeSeatsForNewBooking(
  capacity: number,
  confirmed: number,
  waitlistExists: boolean,
): number {
  return waitlistExists ? 0 : capacity - confirmed;
}

/**
 * Decides CONFIRMED / WAITLISTED for each passenger of a new booking
 * (DESIGN_SPEC §4 steps 6–7). The first min(free, n) passengers by position are
 * confirmed; the rest are waitlisted with consecutive numbers.
 */
export function decideStatuses(input: AllocationInput): AllocationResult {
  const { capacity, confirmed, waitlistExists, passengerCount, nextWaitlistNumber } = input;
  assertIntegerInRange('capacity', capacity, 1, Number.MAX_SAFE_INTEGER);
  assertIntegerInRange('confirmed', confirmed, 0, capacity); // invariant 1: capacity
  assertIntegerInRange('passengerCount', passengerCount, 1, MAX_PASSENGERS_PER_BOOKING);
  assertIntegerInRange('nextWaitlistNumber', nextWaitlistNumber, 1, Number.MAX_SAFE_INTEGER);

  const free = freeSeatsForNewBooking(capacity, confirmed, waitlistExists);
  const confirmCount = Math.min(free, passengerCount);

  const passengers = Array.from({ length: passengerCount }, (_, index): PassengerDecision => {
    const position = index + 1;
    if (index < confirmCount) {
      return { position, status: 'CONFIRMED', waitlistNumber: null };
    }
    return {
      position,
      status: 'WAITLISTED',
      waitlistNumber: nextWaitlistNumber + (index - confirmCount),
    };
  });

  return {
    passengers,
    nextWaitlistNumber: nextWaitlistNumber + (passengerCount - confirmCount),
  };
}

function assertIntegerInRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new InvariantViolationError(
      `${name} must be an integer in [${min}, ${max}], got ${value}`,
    );
  }
}
