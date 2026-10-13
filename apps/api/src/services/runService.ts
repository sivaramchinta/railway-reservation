import { prisma } from '../db';
import { freeSeatsForNewBooking } from '../domain/allocation';
import { type ChartStatus, effectiveChartStatus } from '../domain/chartState';
import { InvariantViolationError } from '../domain/errors';
import { classAvailability } from '../repositories/classInventoryRepository';
import { dbNow, findCurrentRunId, getRunWithTrain } from '../repositories/trainRunRepository';

/** The data behind GET /api/run (DESIGN_SPEC §9). */
export interface RunSummary {
  trainNumber: string;
  trainName: string;
  journeyDate: Date;
  bookingOpensAt: Date;
  bookingClosesAt: Date;
  /** EFFECTIVE status: a stored OPEN past its closing time reads as CLOSED. */
  chartStatus: ChartStatus;
  chartPreparedAt: Date | null;
  classes: {
    code: string;
    name: string;
    capacity: number;
    confirmed: number;
    /** Seats a NEW booking could get now: 0 while anyone is waitlisted (fairness rule). */
    available: number;
    waitlistLength: number;
  }[];
}

export async function requireCurrentRunId(): Promise<number> {
  const runId = await findCurrentRunId(prisma);
  if (runId === null) throw new InvariantViolationError('No train run is configured');
  return runId;
}

/** A read-only snapshot; no locks (it is display data, refreshed by polling). */
export async function getRunSummary(): Promise<RunSummary> {
  const runId = await requireCurrentRunId();
  const [run, now, classes] = await Promise.all([
    getRunWithTrain(prisma, runId),
    dbNow(prisma),
    classAvailability(prisma, runId),
  ]);
  return {
    trainNumber: run.trainNumber,
    trainName: run.trainName,
    journeyDate: run.journeyDate,
    bookingOpensAt: run.bookingOpensAt,
    bookingClosesAt: run.bookingClosesAt,
    chartStatus: effectiveChartStatus(
      run.chartStatus,
      now,
      run.bookingOpensAt,
      run.bookingClosesAt,
    ),
    chartPreparedAt: run.chartPreparedAt,
    classes: classes.map((c) => ({
      code: c.classCode,
      name: c.className,
      capacity: c.capacity,
      confirmed: c.confirmed,
      available: Math.max(0, freeSeatsForNewBooking(c.capacity, c.confirmed, c.waitlisted > 0)),
      waitlistLength: c.waitlisted,
    })),
  };
}
