import { describe, expect, it } from '@jest/globals';
import { InvariantViolationError } from './errors';
import {
  assertPassengerTransition,
  canTransitionPassenger,
  PASSENGER_STATUSES,
  type PassengerStatus,
  type PassengerTransitionCause,
} from './passengerState';

type Move = readonly [PassengerStatus | null, PassengerStatus, PassengerTransitionCause];

const ALLOWED: readonly Move[] = [
  [null, 'CONFIRMED', 'BOOKING'],
  [null, 'WAITLISTED', 'BOOKING'],
  ['CONFIRMED', 'CANCELLED', 'CANCELLATION'],
  ['WAITLISTED', 'CANCELLED', 'CANCELLATION'],
  ['WAITLISTED', 'CONFIRMED', 'CHART_PREPARATION'],
  ['WAITLISTED', 'WAITLIST_EXPIRED', 'CHART_PREPARATION'],
];

const CAUSES: readonly PassengerTransitionCause[] = [
  'BOOKING',
  'CANCELLATION',
  'CHART_PREPARATION',
];
const FROMS: readonly (PassengerStatus | null)[] = [null, ...PASSENGER_STATUSES];

// Every (from, to, cause) combination: 5 × 4 × 3 = 60.
const ALL_MOVES: Move[] = FROMS.flatMap((from) =>
  PASSENGER_STATUSES.flatMap((to) => CAUSES.map((cause) => [from, to, cause] as const)),
);
const FORBIDDEN = ALL_MOVES.filter(
  ([f, t, c]) => !ALLOWED.some(([af, at, ac]) => af === f && at === t && ac === c),
);

describe('passenger transitions', () => {
  it('covers all 60 combinations: 6 allowed, 54 forbidden', () => {
    expect(ALL_MOVES).toHaveLength(60);
    expect(FORBIDDEN).toHaveLength(54);
  });

  it.each(ALLOWED)('allows %s → %s by %s', (from, to, cause) => {
    expect(canTransitionPassenger(from, to, cause)).toBe(true);
    expect(() => {
      assertPassengerTransition(from, to, cause);
    }).not.toThrow();
  });

  it.each(FORBIDDEN)('forbids %s → %s by %s', (from, to, cause) => {
    expect(canTransitionPassenger(from, to, cause)).toBe(false);
    expect(() => {
      assertPassengerTransition(from, to, cause);
    }).toThrow(InvariantViolationError);
  });

  it('only chart preparation may promote: the same move by cancellation is refused', () => {
    expect(canTransitionPassenger('WAITLISTED', 'CONFIRMED', 'CHART_PREPARATION')).toBe(true);
    expect(canTransitionPassenger('WAITLISTED', 'CONFIRMED', 'CANCELLATION')).toBe(false);
  });

  it.each(['CANCELLED', 'WAITLIST_EXPIRED'] as const)('%s is terminal', (terminal) => {
    for (const to of PASSENGER_STATUSES) {
      for (const cause of CAUSES) {
        expect(canTransitionPassenger(terminal, to, cause)).toBe(false);
      }
    }
  });

  it('describes the move in the error, showing "(new)" for creation', () => {
    expect(() => {
      assertPassengerTransition('CANCELLED', 'CONFIRMED', 'CHART_PREPARATION');
    }).toThrow('Illegal passenger transition CANCELLED → CONFIRMED by CHART_PREPARATION');
    expect(() => {
      assertPassengerTransition(null, 'CANCELLED', 'BOOKING');
    }).toThrow('Illegal passenger transition (new) → CANCELLED by BOOKING');
  });
});
