import { randomInt as cryptoRandomInt } from 'node:crypto';
import { InvariantViolationError } from './errors';

/** 31 characters: no 0/O, 1/I/L, so a PNR can be read aloud and typed safely. */
export const PNR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PNR_LENGTH = 10;

/** Exactly PNR_LENGTH characters, all from PNR_ALPHABET. */
export const PNR_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{10}$/;

/** Returns an integer in [0, maxExclusive). */
export type RandomInt = (maxExclusive: number) => number;

/**
 * A new random PNR (DESIGN_SPEC §8): 31^10 ≈ 8 × 10^14 combinations, so PNRs are
 * not guessable and collisions are rare. Uniqueness itself is guaranteed by the
 * database (UNIQUE + ON CONFLICT retry), not by probability.
 *
 * `randomInt` defaults to crypto.randomInt, a cryptographically secure generator.
 * Never Math.random, which is predictable. Tests inject their own source.
 */
export function generatePnr(randomInt: RandomInt = cryptoRandomInt): string {
  let pnr = '';
  for (let i = 0; i < PNR_LENGTH; i++) {
    const index = randomInt(PNR_ALPHABET.length);
    const char = PNR_ALPHABET[index];
    if (char === undefined) {
      throw new InvariantViolationError(`Random source returned out-of-range index ${index}`);
    }
    pnr += char;
  }
  return pnr;
}

export function isValidPnr(value: string): boolean {
  return PNR_PATTERN.test(value);
}
