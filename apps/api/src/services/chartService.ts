import { prisma, runInTransaction, type TxClient } from '../db';
import { assertChartTransition, effectiveChartStatus } from '../domain/chartState';
import { AppError, InvariantViolationError } from '../domain/errors';
import { assertPassengerTransition } from '../domain/passengerState';
import { matchSeats, seatLabel } from '../domain/seatMatching';
import {
  chartClassCounts,
  expireWaitlisted,
  insertSeatAllocations,
  loadChartLayout,
  loadConfirmedGroups,
  loadSeatLayout,
  lockAllClassInventories,
  promoteWaitlisted,
  verifyChart,
} from '../repositories/chartRepository';
import { countConfirmed } from '../repositories/passengerRepository';
import { dbNow, getRunForUpdate, updateRun } from '../repositories/trainRunRepository';
import { requireCurrentRunId } from './runService';

/** POST /api/admin/chart/prepare response (DESIGN_SPEC §6 step 8). */
export interface ChartSummary {
  chartStatus: 'CHART_LOCKED';
  chartPreparedAt: Date;
  classes: {
    classCode: string;
    capacity: number;
    promoted: number;
    expired: number;
    seatsUsed: number;
  }[];
}

/** GET /api/admin/chart response (DESIGN_SPEC §9). */
export interface ChartView {
  coaches: {
    label: string;
    classCode: string;
    seats: { number: number; label: string; pnr?: string; passengerName?: string }[];
  }[];
}

export interface ChartDeps {
  /**
   * Test hook, called after seats are inserted and before verification. Tests use
   * it to simulate a crash or to corrupt data and prove the rollback.
   */
  afterSeatsAllocated?: (tx: TxClient) => Promise<void>;
}

/**
 * Prepares and locks the chart (DESIGN_SPEC §6) in ONE atomic transaction:
 * either a complete, verified chart is committed, or nothing changes and the run
 * stays CLOSED (safe to rerun). Idempotent: a locked chart returns its summary.
 */
export async function prepareChart(deps: ChartDeps = {}): Promise<ChartSummary> {
  const runId = await requireCurrentRunId();

  return runInTransaction(async (tx) => {
    // 1. Lock the run: two chart preparations (or a window change) cannot overlap.
    const run = await getRunForUpdate(tx, runId);
    if (run === null) throw new InvariantViolationError(`Run ${runId} vanished`);
    if (run.chartStatus === 'CHART_LOCKED') return summarize(tx, runId, run.chartPreparedAt);

    const now = await dbNow(tx);
    const effective = effectiveChartStatus(
      run.chartStatus,
      now,
      run.bookingOpensAt,
      run.bookingClosesAt,
    );
    if (effective !== 'CLOSED') {
      throw new AppError(
        'WINDOW_STILL_OPEN',
        'Close the booking window before preparing the chart',
      );
    }
    if (run.chartStatus === 'OPEN') {
      // Closed by time but never closed by an admin: record it, in this transaction.
      assertChartTransition('OPEN', 'CLOSED');
      await updateRun(tx, runId, { chartStatus: 'CLOSED' });
    }

    // 2. Lock EVERY class, in the fixed order. No booking or cancellation can run now.
    const classes = await lockAllClassInventories(tx, runId);

    assertPassengerTransition('WAITLISTED', 'CONFIRMED', 'CHART_PREPARATION');
    assertPassengerTransition('WAITLISTED', 'WAITLIST_EXPIRED', 'CHART_PREPARATION');
    for (const { classCode, capacity } of classes) {
      // 3. Promote into freed seats, strictly by waitlist number.
      const free = capacity - (await countConfirmed(tx, runId, classCode));
      if (free < 0) throw new InvariantViolationError(`${classCode} is over capacity`);
      await promoteWaitlisted(tx, runId, classCode, free);
      // 4. Whoever was not reached is expired.
      await expireWaitlisted(tx, runId, classCode);
      // 5. Seats: pure matching, then one INSERT.
      const assignments = matchSeats(
        await loadSeatLayout(tx, runId, classCode),
        await loadConfirmedGroups(tx, runId, classCode),
      );
      await insertSeatAllocations(tx, runId, assignments);
    }

    if (deps.afterSeatsAllocated !== undefined) await deps.afterSeatsAllocated(tx);

    // 6. Verify inside the transaction: any violation rolls EVERYTHING back.
    const violations = await verifyChart(tx, runId);
    if (violations.length > 0) {
      throw new InvariantViolationError(`Chart verification failed: ${violations.join('; ')}`);
    }

    // 7. Lock the chart.
    assertChartTransition('CLOSED', 'CHART_LOCKED');
    await updateRun(tx, runId, { chartStatus: 'CHART_LOCKED', chartPreparedAt: now });

    // 8. Summary.
    return summarize(tx, runId, now);
  });
}

async function summarize(
  tx: TxClient,
  runId: number,
  chartPreparedAt: Date | null,
): Promise<ChartSummary> {
  if (chartPreparedAt === null) {
    throw new InvariantViolationError('A locked chart has no chart_prepared_at');
  }
  return {
    chartStatus: 'CHART_LOCKED',
    chartPreparedAt,
    classes: await chartClassCounts(tx, runId),
  };
}

/** The seat map by coach (empty seats until the chart is prepared). */
export async function getChart(): Promise<ChartView> {
  const runId = await requireCurrentRunId();
  const coaches = await loadChartLayout(prisma, runId);
  return {
    coaches: coaches.map((coach) => ({
      label: coach.label,
      classCode: coach.classCode,
      seats: coach.seats.map((seat) => ({
        number: seat.number,
        label: seatLabel(coach.label, seat.number),
        ...(seat.allocation === null
          ? {}
          : { pnr: seat.allocation.pnr, passengerName: seat.allocation.passengerName }),
      })),
    })),
  };
}
