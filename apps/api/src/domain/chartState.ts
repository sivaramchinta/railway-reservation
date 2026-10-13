import { InvariantViolationError } from './errors';

export const CHART_STATUSES = ['NOT_YET_OPEN', 'OPEN', 'CLOSED', 'CHART_LOCKED'] as const;
export type ChartStatus = (typeof CHART_STATUSES)[number];

/**
 * The only allowed moves (DESIGN_SPEC §2):
 * NOT_YET_OPEN → OPEN → CLOSED → CHART_LOCKED. Nothing ever moves backwards,
 * and CHART_LOCKED is terminal (invariant 4: chart finality).
 */
const ALLOWED_CHART_TRANSITIONS: Readonly<Record<ChartStatus, readonly ChartStatus[]>> = {
  NOT_YET_OPEN: ['OPEN'],
  OPEN: ['CLOSED'],
  CLOSED: ['CHART_LOCKED'],
  CHART_LOCKED: [],
};

export function canTransitionChart(from: ChartStatus, to: ChartStatus): boolean {
  return ALLOWED_CHART_TRANSITIONS[from].includes(to);
}

/** Services call this before writing a new chart status. */
export function assertChartTransition(from: ChartStatus, to: ChartStatus): void {
  if (!canTransitionChart(from, to)) {
    throw new InvariantViolationError(`Illegal chart transition ${from} → ${to}`);
  }
}

/**
 * The status that actually applies right now. Time is authoritative too
 * (DESIGN_SPEC §2): a stored OPEN whose closing time has passed is effectively
 * CLOSED, so a late status update can never extend the window. `now` must be the
 * database clock, read inside the locked transaction.
 *
 * effectiveChartStatus(...) === 'OPEN' is exactly the booking rule in §4:
 * status OPEN AND opensAt <= now < closesAt.
 */
export function effectiveChartStatus(
  status: ChartStatus,
  now: Date,
  opensAt: Date,
  closesAt: Date,
): ChartStatus {
  if (status !== 'OPEN') return status;
  if (now.getTime() >= closesAt.getTime()) return 'CLOSED';
  if (now.getTime() < opensAt.getTime()) return 'NOT_YET_OPEN';
  return 'OPEN';
}

export type WindowAction = 'OPEN' | 'CLOSE';

/** What an admin window action should do. A discriminated union: `kind` says which shape it is. */
export type WindowDecision =
  | { kind: 'APPLY'; from: ChartStatus; to: ChartStatus }
  | { kind: 'NO_OP' }
  | { kind: 'REJECT'; code: 'CHART_LOCKED' | 'INVALID_WINDOW_TRANSITION' };

/**
 * Admin open/close rules (DESIGN_SPEC §2 decision, 2026-10-13), given the
 * EFFECTIVE status:
 * - repeating an action that already took effect → NO_OP (idempotent, 200);
 * - anything once the chart is locked → CHART_LOCKED (409);
 * - a move the transition table allows → APPLY;
 * - any other move (open after close, close before open) → INVALID_WINDOW_TRANSITION (409).
 */
export function decideWindowAction(effective: ChartStatus, action: WindowAction): WindowDecision {
  const target: ChartStatus = action === 'OPEN' ? 'OPEN' : 'CLOSED';
  if (effective === target) return { kind: 'NO_OP' };
  if (effective === 'CHART_LOCKED') return { kind: 'REJECT', code: 'CHART_LOCKED' };
  if (canTransitionChart(effective, target)) return { kind: 'APPLY', from: effective, to: target };
  return { kind: 'REJECT', code: 'INVALID_WINDOW_TRANSITION' };
}
