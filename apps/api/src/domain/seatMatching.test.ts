import { describe, expect, it } from '@jest/globals';
import { InvariantViolationError } from './errors';
import {
  type CoachInput,
  matchSeats,
  type PassengerGroup,
  type SeatAssignment,
  seatLabel,
} from './seatMatching';

const SEATS_PER_COACH = 20;

/** A coach whose free seats are `freeNumbers` (default: all 1..20). Seat id = ordinal*100 + number. */
function coach(
  label: string,
  ordinal: number,
  freeNumbers: readonly number[] = range(1, SEATS_PER_COACH),
): CoachInput {
  return { label, ordinal, seats: freeNumbers.map((n) => ({ id: ordinal * 100 + n, number: n })) };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Groups from sizes; passenger ids are 1n, 2n, 3n … in order. */
function groups(...sizes: number[]): PassengerGroup[] {
  let next = 1n;
  return sizes.map((size) => ({
    passengerIds: Array.from({ length: size }, () => next++),
  }));
}

const labels = (result: SeatAssignment[]): string[] => result.map((a) => a.seatLabel);

function expectNoSeatUsedTwice(result: SeatAssignment[]): void {
  expect(new Set(result.map((a) => a.seatId)).size).toBe(result.length);
  expect(new Set(result.map((a) => a.passengerId)).size).toBe(result.length);
}

describe('seatLabel', () => {
  it('zero-pads the seat number to 2 digits', () => {
    expect(seatLabel('S1', 7)).toBe('S1-07');
    expect(seatLabel('A1', 20)).toBe('A1-20');
  });
});

describe('matchSeats', () => {
  it('seats a group together in the first coach, lowest seats first', () => {
    const result = matchSeats([coach('S1', 1), coach('S2', 2)], groups(4));
    expect(labels(result)).toEqual(['S1-01', 'S1-02', 'S1-03', 'S1-04']);
  });

  it('preserves booking order: earlier groups get earlier seats', () => {
    const result = matchSeats([coach('S1', 1)], groups(2, 3, 1));
    expect(labels(result)).toEqual(['S1-01', 'S1-02', 'S1-03', 'S1-04', 'S1-05', 'S1-06']);
    expect(result.map((a) => a.passengerId)).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
  });

  it('uses the lowest run of consecutive seats, skipping gaps that are too small', () => {
    // Free: 1, 2 | 5, 6, 7, 8 | 10. A group of 3 skips 1-2 and takes 5-7.
    const result = matchSeats([coach('S1', 1, [1, 2, 5, 6, 7, 8, 10])], groups(3));
    expect(labels(result)).toEqual(['S1-05', 'S1-06', 'S1-07']);
  });

  it('keeps a group together in a later coach rather than splitting it', () => {
    // S1 has 6 free seats but no 3 in a row; S2 has a run of 3.
    const result = matchSeats(
      [coach('S1', 1, [1, 3, 5, 7, 9, 11]), coach('S2', 2, [4, 5, 6])],
      groups(3),
    );
    expect(labels(result)).toEqual(['S2-04', 'S2-05', 'S2-06']);
  });

  it('orders coaches by ordinal, not by input order', () => {
    const result = matchSeats([coach('S2', 2), coach('S1', 1)], groups(1));
    expect(labels(result)).toEqual(['S1-01']);
  });

  it('accepts free seats in any order', () => {
    const result = matchSeats([coach('S1', 1, [9, 3, 4, 1])], groups(2));
    expect(labels(result)).toEqual(['S1-03', 'S1-04']);
  });

  it('edge case 12: a group that cannot sit together goes to the coach with most free seats first', () => {
    // No coach has 4 in a row. S2 has the most free seats (5), so it is filled first.
    const result = matchSeats(
      [coach('S1', 1, [1, 3, 5]), coach('S2', 2, [2, 4, 6, 8, 10])],
      groups(4),
    );
    expect(labels(result)).toEqual(['S2-02', 'S2-04', 'S2-06', 'S2-08']);
  });

  it('edge case 12: splits across coaches when one is not enough, everyone seated', () => {
    // 6 passengers; no run of 6 anywhere. S2 (4 free) fills first, then S1 (3 free).
    const result = matchSeats([coach('S1', 1, [1, 3, 5]), coach('S2', 2, [2, 4, 6, 8])], groups(6));
    expect(labels(result)).toEqual(['S2-02', 'S2-04', 'S2-06', 'S2-08', 'S1-01', 'S1-03']);
    expectNoSeatUsedTwice(result);
  });

  it('breaks a tie on free seats by the lower ordinal', () => {
    const result = matchSeats([coach('S2', 2, [2, 4, 6]), coach('S1', 1, [1, 3, 5])], groups(2));
    expect(labels(result)).toEqual(['S1-01', 'S1-03']);
  });

  it('fills a class exactly to capacity (2 coaches × 20) with no seat used twice', () => {
    const result = matchSeats([coach('S1', 1), coach('S2', 2)], groups(6, 6, 6, 6, 6, 6, 4));
    expect(result).toHaveLength(40);
    expectNoSeatUsedTwice(result);
  });

  it('never assigns a seat twice across many group mixes', () => {
    // S1 has 15 free seats (every 4th taken) and S2 has 20: 35 seats in total.
    const mixes = [
      [1, 1, 1, 1],
      [6, 5, 4, 3, 2, 1],
      [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2],
      [5, 6, 6, 6, 6, 6],
    ];
    for (const sizes of mixes) {
      const result = matchSeats(
        [
          coach(
            'S1',
            1,
            range(1, 20).filter((n) => n % 4 !== 0),
          ),
          coach('S2', 2),
        ],
        groups(...sizes),
      );
      expect(result).toHaveLength(sizes.reduce((sum, n) => sum + n, 0));
      expectNoSeatUsedTwice(result);
    }
  });

  it('returns nothing when there are no confirmed passengers', () => {
    expect(matchSeats([coach('A1', 1)], [])).toEqual([]);
  });

  it('throws when there are more confirmed passengers than seats (invariant 1 broken)', () => {
    expect(() => matchSeats([coach('A1', 1, [1, 2, 3])], groups(2, 2))).toThrow(
      InvariantViolationError,
    );
  });
});
