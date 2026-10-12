import { InvariantViolationError } from './errors';

export interface SeatInput {
  id: number;
  number: number;
}

export interface CoachInput {
  label: string;
  ordinal: number;
  /** The coach's free seats (any order). */
  seats: readonly SeatInput[];
}

/** One confirmed PNR: its passenger ids in `position` order. */
export interface PassengerGroup {
  passengerIds: readonly bigint[];
}

export interface SeatAssignment {
  passengerId: bigint;
  seatId: number;
  /** e.g. "S1-07". */
  seatLabel: string;
}

interface CoachState {
  label: string;
  ordinal: number;
  /** Free seats, ascending by seat number. */
  free: SeatInput[];
}

interface SeatPick {
  coach: CoachState;
  seat: SeatInput;
}

/** `<coach label>-<seat number zero-padded to 2>`, e.g. S1-07, A1-20. */
export function seatLabel(coachLabel: string, seatNumber: number): string {
  return `${coachLabel}-${String(seatNumber).padStart(2, '0')}`;
}

/**
 * Assigns a seat to every confirmed passenger of one class (DESIGN_SPEC §7).
 * Pure: no I/O. `groups` must already be in booking order (created_at, then id);
 * earlier bookings are seated first, so the result is deterministic.
 *
 * Per group of k passengers:
 * 1. the first coach (by ordinal) with k consecutive free seat numbers, using
 *    its lowest such run;
 * 2. otherwise the coach with the most free seats (tie → lower ordinal), lowest
 *    free seats first, continuing in the next coach with the most free seats.
 *
 * Throws if there are more passengers than seats (precondition: total
 * confirmed ≤ total seats, i.e. invariant 1 held).
 */
export function matchSeats(
  coaches: readonly CoachInput[],
  groups: readonly PassengerGroup[],
): SeatAssignment[] {
  const states: CoachState[] = [...coaches]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((coach) => ({
      label: coach.label,
      ordinal: coach.ordinal,
      free: [...coach.seats].sort((a, b) => a.number - b.number),
    }));

  const assignments: SeatAssignment[] = [];
  for (const group of groups) {
    const picks = pickSeatsForGroup(states, group.passengerIds.length);
    group.passengerIds.forEach((passengerId, index) => {
      const pick = picks[index];
      if (pick === undefined) {
        throw new InvariantViolationError('More confirmed passengers than seats in this class');
      }
      assignments.push({
        passengerId,
        seatId: pick.seat.id,
        seatLabel: seatLabel(pick.coach.label, pick.seat.number),
      });
      pick.coach.free = pick.coach.free.filter((seat) => seat.id !== pick.seat.id);
    });
  }
  return assignments;
}

function pickSeatsForGroup(coaches: readonly CoachState[], size: number): SeatPick[] {
  // 1. Keep the group together: first coach with a long enough consecutive run.
  for (const coach of coaches) {
    const run = lowestConsecutiveRun(coach.free, size);
    if (run !== null) return run.map((seat) => ({ coach, seat }));
  }

  // 2. Split as little as possible: coaches with the most free seats first.
  const byMostFree = [...coaches].sort(
    (a, b) => b.free.length - a.free.length || a.ordinal - b.ordinal,
  );
  return byMostFree.flatMap((coach) => coach.free.map((seat) => ({ coach, seat }))).slice(0, size);
}

/** The lowest run of `size` consecutive seat numbers in `free` (ascending), or null. */
function lowestConsecutiveRun(free: readonly SeatInput[], size: number): SeatInput[] | null {
  let run: SeatInput[] = [];
  for (const seat of free) {
    const last = run.at(-1);
    run = last !== undefined && seat.number === last.number + 1 ? [...run, seat] : [seat];
    if (run.length === size) return run;
  }
  return null;
}
