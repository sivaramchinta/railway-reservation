import { InvariantViolationError } from './errors';

export const PASSENGER_STATUSES = [
  'CONFIRMED',
  'WAITLISTED',
  'CANCELLED',
  'WAITLIST_EXPIRED',
] as const;
export type PassengerStatus = (typeof PASSENGER_STATUSES)[number];

/** Which use case is changing the status (the "Cause / When" columns in §2). */
export type PassengerTransitionCause = 'BOOKING' | 'CANCELLATION' | 'CHART_PREPARATION';

interface PassengerTransition {
  /** null = a brand-new passenger being created. */
  readonly from: PassengerStatus | null;
  readonly to: PassengerStatus;
  readonly cause: PassengerTransitionCause;
}

/**
 * Every allowed move (DESIGN_SPEC §2). CANCELLED and WAITLIST_EXPIRED are
 * terminal. Only chart preparation can promote or expire a waitlisted passenger.
 */
const ALLOWED_PASSENGER_TRANSITIONS: readonly PassengerTransition[] = [
  { from: null, to: 'CONFIRMED', cause: 'BOOKING' },
  { from: null, to: 'WAITLISTED', cause: 'BOOKING' },
  { from: 'CONFIRMED', to: 'CANCELLED', cause: 'CANCELLATION' },
  { from: 'WAITLISTED', to: 'CANCELLED', cause: 'CANCELLATION' },
  { from: 'WAITLISTED', to: 'CONFIRMED', cause: 'CHART_PREPARATION' },
  { from: 'WAITLISTED', to: 'WAITLIST_EXPIRED', cause: 'CHART_PREPARATION' },
];

export function canTransitionPassenger(
  from: PassengerStatus | null,
  to: PassengerStatus,
  cause: PassengerTransitionCause,
): boolean {
  return ALLOWED_PASSENGER_TRANSITIONS.some(
    (t) => t.from === from && t.to === to && t.cause === cause,
  );
}

/** Services call this before writing a passenger status. */
export function assertPassengerTransition(
  from: PassengerStatus | null,
  to: PassengerStatus,
  cause: PassengerTransitionCause,
): void {
  if (!canTransitionPassenger(from, to, cause)) {
    throw new InvariantViolationError(
      `Illegal passenger transition ${from ?? '(new)'} → ${to} by ${cause}`,
    );
  }
}
