import { runInTransaction } from '../db';
import {
  assertChartTransition,
  decideWindowAction,
  effectiveChartStatus,
  type WindowAction,
} from '../domain/chartState';
import { AppError, InvariantViolationError } from '../domain/errors';
import { dbNow, getRunForUpdate, updateRun } from '../repositories/trainRunRepository';
import { getRunSummary, requireCurrentRunId, type RunSummary } from './runService';

/** Re-opening a window whose closing time already passed gives it this long. */
const DEFAULT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

const REJECT_MESSAGES = {
  CHART_LOCKED: 'The chart is prepared and locked; the window can no longer change',
  INVALID_WINDOW_TRANSITION: 'That window action is not allowed in the current state',
} as const;

/** NOT_YET_OPEN → OPEN (DESIGN_SPEC §2). Repeating it is a no-op. */
export function openWindow(): Promise<RunSummary> {
  return changeWindow('OPEN');
}

/** OPEN → CLOSED (DESIGN_SPEC §2). Repeating it is a no-op. */
export function closeWindow(): Promise<RunSummary> {
  return changeWindow('CLOSE');
}

async function changeWindow(action: WindowAction): Promise<RunSummary> {
  const runId = await requireCurrentRunId();

  await runInTransaction(async (tx) => {
    // Lock the run row: concurrent admin actions (and chart prep) queue here.
    const run = await getRunForUpdate(tx, runId);
    if (run === null) throw new InvariantViolationError(`Run ${runId} vanished`);
    const now = await dbNow(tx);

    const effective = effectiveChartStatus(
      run.chartStatus,
      now,
      run.bookingOpensAt,
      run.bookingClosesAt,
    );
    const decision = decideWindowAction(effective, action);
    if (decision.kind === 'REJECT') {
      throw new AppError(decision.code, REJECT_MESSAGES[decision.code]);
    }
    if (decision.kind === 'NO_OP') return;

    assertChartTransition(decision.from, decision.to);
    if (action === 'OPEN') {
      // §2: opens now; if the closing time already passed, give the window a fresh 2 days.
      const closesAt =
        run.bookingClosesAt.getTime() <= now.getTime()
          ? new Date(now.getTime() + DEFAULT_WINDOW_MS)
          : run.bookingClosesAt;
      await updateRun(tx, runId, {
        chartStatus: 'OPEN',
        bookingOpensAt: now,
        bookingClosesAt: closesAt,
      });
    } else {
      // §2: closes now (APPLY only happens while effectively OPEN, so now < closesAt).
      await updateRun(tx, runId, { chartStatus: 'CLOSED', bookingClosesAt: now });
    }
  });

  return getRunSummary();
}
