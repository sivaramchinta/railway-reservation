import { describe, expect, it, jest } from '@jest/globals';
import { InvariantViolationError } from './errors';
import { generatePnr, isValidPnr, PNR_ALPHABET, PNR_LENGTH, type RandomInt } from './pnr';

/** A fake random source that replays the given indexes in order. */
function sequence(...indexes: number[]): RandomInt {
  let call = 0;
  return () => indexes[call++ % indexes.length] ?? 0;
}

describe('PNR alphabet', () => {
  it('has 31 unique characters and no look-alikes (0, O, 1, I, L)', () => {
    expect(PNR_ALPHABET).toHaveLength(31);
    expect(new Set(PNR_ALPHABET).size).toBe(31);
    for (const ambiguous of ['0', 'O', '1', 'I', 'L']) {
      expect(PNR_ALPHABET).not.toContain(ambiguous);
    }
  });

  it('gives about 8 × 10^14 combinations', () => {
    expect(PNR_ALPHABET.length ** PNR_LENGTH).toBeGreaterThan(8e14);
  });
});

describe('generatePnr with an injected random source', () => {
  it('maps each random index to a character', () => {
    expect(generatePnr(sequence(0))).toBe('AAAAAAAAAA');
    expect(generatePnr(sequence(30))).toBe('9999999999');
    expect(generatePnr(sequence(0, 1, 2, 3, 4, 5, 6, 7, 8, 9))).toBe('ABCDEFGHJK');
  });

  it('asks for one index in [0, 31) per character', () => {
    const randomInt = jest.fn<RandomInt>(() => 0);
    generatePnr(randomInt);
    expect(randomInt).toHaveBeenCalledTimes(PNR_LENGTH);
    expect(randomInt).toHaveBeenCalledWith(31);
  });

  it('is deterministic for the same source, which lets tests force a collision', () => {
    expect(generatePnr(sequence(5))).toBe(generatePnr(sequence(5)));
  });

  it.each([31, -1])('rejects a broken source returning %i', (bad) => {
    expect(() => generatePnr(() => bad)).toThrow(InvariantViolationError);
  });
});

describe('generatePnr with the default crypto source', () => {
  it('produces valid, distinct PNRs', () => {
    const pnrs = Array.from({ length: 1000 }, () => generatePnr());
    expect(pnrs.every(isValidPnr)).toBe(true);
    expect(new Set(pnrs).size).toBe(1000);
  });
});

describe('isValidPnr', () => {
  it.each(['ABCDEFGHJK', '2345678923', 'ZZZZZZZZZZ'])('accepts %s', (pnr) => {
    expect(isValidPnr(pnr)).toBe(true);
  });

  it.each([
    ['too short', 'ABCDEFGHJ'],
    ['too long', 'ABCDEFGHJKM'],
    ['lower case', 'abcdefghjk'],
    ['contains O', 'ABCDEFGHJO'],
    ['contains 0', 'ABCDEFGHJ0'],
    ['contains 1', 'ABCDEFGHJ1'],
    ['contains I', 'ABCDEFGHJI'],
    ['contains L', 'ABCDEFGHJL'],
    ['empty', ''],
  ])('rejects %s', (_label, pnr) => {
    expect(isValidPnr(pnr)).toBe(false);
  });
});
