import type { TxClient } from '../db';
import type { ChartStatus } from '../domain/chartState';

export interface RunRecord {
  id: number;
  chartStatus: ChartStatus;
  bookingOpensAt: Date;
  bookingClosesAt: Date;
  chartPreparedAt: Date | null;
}

const runSelect = {
  id: true,
  chartStatus: true,
  bookingOpensAt: true,
  bookingClosesAt: true,
  chartPreparedAt: true,
} as const;

/** The system has one train run (DESIGN_SPEC §1). */
export async function findCurrentRunId(tx: TxClient): Promise<number | null> {
  const run = await tx.trainRun.findFirst({ orderBy: { id: 'asc' }, select: { id: true } });
  return run?.id ?? null;
}

/** Plain read: booking and cancellation must NOT lock train_run (one lock only). */
export async function getRun(tx: TxClient, runId: number): Promise<RunRecord> {
  return tx.trainRun.findUniqueOrThrow({ where: { id: runId }, select: runSelect });
}

/** Locks the run row. Used only by window control and chart preparation (Phase 5). */
export async function getRunForUpdate(tx: TxClient, runId: number): Promise<RunRecord | null> {
  const rows = await tx.$queryRaw<
    {
      id: number;
      chart_status: ChartStatus;
      booking_opens_at: Date;
      booking_closes_at: Date;
      chart_prepared_at: Date | null;
    }[]
  >`
    SELECT id, chart_status, booking_opens_at, booking_closes_at, chart_prepared_at
    FROM train_run
    WHERE id = ${runId}
    FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    chartStatus: row.chart_status,
    bookingOpensAt: row.booking_opens_at,
    bookingClosesAt: row.booking_closes_at,
    chartPreparedAt: row.chart_prepared_at,
  };
}

/**
 * The database clock, read now: clock_timestamp(), not now(). Postgres now() is
 * frozen at transaction start, and a booking may have queued for the lock since
 * (DESIGN_SPEC §4 step 4). Call this AFTER taking the lock.
 */
export async function dbNow(tx: TxClient): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const row = rows[0];
  if (row === undefined) throw new Error('SELECT clock_timestamp() returned no row');
  return row.now;
}

export interface RunWindowUpdate {
  chartStatus: ChartStatus;
  bookingOpensAt?: Date;
  bookingClosesAt?: Date;
  chartPreparedAt?: Date;
}

/** Writes a new chart status (and window times). Callers must hold the train_run row lock. */
export async function updateRun(tx: TxClient, runId: number, data: RunWindowUpdate): Promise<void> {
  await tx.trainRun.update({ where: { id: runId }, data });
}

export interface RunWithTrain extends RunRecord {
  journeyDate: Date;
  trainNumber: string;
  trainName: string;
}

export async function getRunWithTrain(tx: TxClient, runId: number): Promise<RunWithTrain> {
  const run = await tx.trainRun.findUniqueOrThrow({
    where: { id: runId },
    select: { ...runSelect, journeyDate: true, train: { select: { number: true, name: true } } },
  });
  const { train, ...rest } = run;
  return { ...rest, trainNumber: train.number, trainName: train.name };
}
