import { describe, expect, it } from '@jest/globals';
import {
  assertChartTransition,
  canTransitionChart,
  CHART_STATUSES,
  type ChartStatus,
  decideWindowAction,
  effectiveChartStatus,
  type WindowAction,
  type WindowDecision,
} from './chartState';
import { InvariantViolationError } from './errors';

const ALLOWED: readonly (readonly [ChartStatus, ChartStatus])[] = [
  ['NOT_YET_OPEN', 'OPEN'],
  ['OPEN', 'CLOSED'],
  ['CLOSED', 'CHART_LOCKED'],
];

// Every (from, to) pair, so each forbidden move is tested too.
const ALL_PAIRS = CHART_STATUSES.flatMap((from) => CHART_STATUSES.map((to) => [from, to] as const));
const FORBIDDEN = ALL_PAIRS.filter(
  ([from, to]) => !ALLOWED.some(([f, t]) => f === from && t === to),
);

describe('chart transitions', () => {
  it('covers all 16 pairs: 3 allowed, 13 forbidden', () => {
    expect(ALL_PAIRS).toHaveLength(16);
    expect(FORBIDDEN).toHaveLength(13);
  });

  it.each(ALLOWED)('allows %s → %s', (from, to) => {
    expect(canTransitionChart(from, to)).toBe(true);
    expect(() => {
      assertChartTransition(from, to);
    }).not.toThrow();
  });

  it.each(FORBIDDEN)('forbids %s → %s', (from, to) => {
    expect(canTransitionChart(from, to)).toBe(false);
    expect(() => {
      assertChartTransition(from, to);
    }).toThrow(InvariantViolationError);
  });

  it('names both states in the error', () => {
    expect(() => {
      assertChartTransition('CHART_LOCKED', 'OPEN');
    }).toThrow('Illegal chart transition CHART_LOCKED → OPEN');
  });
});

describe('effectiveChartStatus', () => {
  const opensAt = new Date('2030-01-01T10:00:00Z');
  const closesAt = new Date('2030-01-03T10:00:00Z');
  const at = (iso: string): Date => new Date(iso);

  it('is OPEN inside the window, including exactly at opensAt', () => {
    expect(effectiveChartStatus('OPEN', opensAt, opensAt, closesAt)).toBe('OPEN');
    expect(effectiveChartStatus('OPEN', at('2030-01-02T00:00:00Z'), opensAt, closesAt)).toBe(
      'OPEN',
    );
  });

  it('is CLOSED from exactly closesAt onwards, even though the stored status is OPEN', () => {
    expect(effectiveChartStatus('OPEN', closesAt, opensAt, closesAt)).toBe('CLOSED');
    expect(effectiveChartStatus('OPEN', at('2030-01-03T10:00:00.001Z'), opensAt, closesAt)).toBe(
      'CLOSED',
    );
  });

  it('is still OPEN one millisecond before closesAt', () => {
    expect(effectiveChartStatus('OPEN', at('2030-01-03T09:59:59.999Z'), opensAt, closesAt)).toBe(
      'OPEN',
    );
  });

  it('is NOT_YET_OPEN before opensAt', () => {
    expect(effectiveChartStatus('OPEN', at('2030-01-01T09:59:59.999Z'), opensAt, closesAt)).toBe(
      'NOT_YET_OPEN',
    );
  });

  it.each(['NOT_YET_OPEN', 'CLOSED', 'CHART_LOCKED'] as const)(
    'returns a stored %s unchanged, whatever the time',
    (status) => {
      for (const now of [at('2029-12-31T00:00:00Z'), opensAt, at('2030-01-05T00:00:00Z')]) {
        expect(effectiveChartStatus(status, now, opensAt, closesAt)).toBe(status);
      }
    },
  );
});

describe('decideWindowAction (admin open/close)', () => {
  it.each<[ChartStatus, WindowAction, WindowDecision]>([
    ['NOT_YET_OPEN', 'OPEN', { kind: 'APPLY', from: 'NOT_YET_OPEN', to: 'OPEN' }],
    ['NOT_YET_OPEN', 'CLOSE', { kind: 'REJECT', code: 'INVALID_WINDOW_TRANSITION' }],
    ['OPEN', 'OPEN', { kind: 'NO_OP' }],
    ['OPEN', 'CLOSE', { kind: 'APPLY', from: 'OPEN', to: 'CLOSED' }],
    ['CLOSED', 'OPEN', { kind: 'REJECT', code: 'INVALID_WINDOW_TRANSITION' }],
    ['CLOSED', 'CLOSE', { kind: 'NO_OP' }],
    ['CHART_LOCKED', 'OPEN', { kind: 'REJECT', code: 'CHART_LOCKED' }],
    ['CHART_LOCKED', 'CLOSE', { kind: 'REJECT', code: 'CHART_LOCKED' }],
  ])('effective %s + %s → %o', (effective, action, expected) => {
    expect(decideWindowAction(effective, action)).toEqual(expected);
  });
});
