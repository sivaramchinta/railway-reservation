import { CreateBookingRequestSchema, IdempotencyKeySchema } from '@railway/shared';
import { prisma, runInTransaction } from '../db';
import { decideStatuses } from '../domain/allocation';
import { effectiveChartStatus } from '../domain/chartState';
import { AppError, InvariantViolationError } from '../domain/errors';
import { assertPassengerTransition } from '../domain/passengerState';
import { generatePnr } from '../domain/pnr';
import {
  findBookingByIdempotencyKey,
  getBookingById,
  insertBookingWithPnr,
} from '../repositories/bookingRepository';
import { bumpWaitlistNumber, lockClassInventory } from '../repositories/classInventoryRepository';
import {
  countConfirmed,
  insertPassengers,
  waitlistExists,
} from '../repositories/passengerRepository';
import { dbNow, findCurrentRunId, getRun } from '../repositories/trainRunRepository';
import { type BookingView, toView } from './bookingView';
import { parseOrThrow } from './validation';

export const MAX_PNR_ATTEMPTS = 5;

export interface CreateBookingResult {
  booking: BookingView;
  /** false = idempotent replay of an earlier request (HTTP 200 instead of 201). */
  created: boolean;
}

export interface BookingDeps {
  /** Injectable so tests can force PNR collisions (edge case 15). */
  generatePnr: () => string;
}

const defaultDeps: BookingDeps = { generatePnr: () => generatePnr() };

/**
 * Creates a booking (DESIGN_SPEC §4) in ONE transaction holding ONE lock: the
 * class_inventory row. Returns the existing booking if this user already used
 * this Idempotency-Key.
 */
export async function createBooking(
  userId: number,
  input: unknown,
  idempotencyKey: unknown,
  deps: BookingDeps = defaultDeps,
): Promise<CreateBookingResult> {
  // 1. Validate before touching the database.
  const request = parseOrThrow(CreateBookingRequestSchema, input, 'Invalid booking request');
  const key = parseOrThrow(IdempotencyKeySchema, idempotencyKey, 'Invalid Idempotency-Key');

  // 2. Fast path for replays (double-click, network retry). Re-checked under the lock.
  const earlier = await findBookingByIdempotencyKey(prisma, userId, key);
  if (earlier !== null) return { booking: toView(earlier), created: false };

  const runId = await findCurrentRunId(prisma);
  if (runId === null) throw new InvariantViolationError('No train run is configured');

  return runInTransaction(async (tx) => {
    // 3. THE lock. Every decision below is serialized per class.
    const inventory = await lockClassInventory(tx, runId, request.classCode);
    if (inventory === null) {
      throw new AppError('VALIDATION_FAILED', `Unknown class ${request.classCode}`);
    }

    // 4. Two identical requests at the same instant: the second one waited for
    //    the lock and now sees the first one's booking.
    const replay = await findBookingByIdempotencyKey(tx, userId, key);
    if (replay !== null) return { booking: toView(replay), created: false };

    // 5. Window check with the database clock, read after the lock.
    const run = await getRun(tx, runId);
    const now = await dbNow(tx);
    if (
      effectiveChartStatus(run.chartStatus, now, run.bookingOpensAt, run.bookingClosesAt) !== 'OPEN'
    ) {
      throw new AppError('BOOKING_CLOSED', 'The booking window is closed');
    }

    // 6. The fairness rule decides CONFIRMED / WAITLISTED per passenger.
    const decision = decideStatuses({
      capacity: inventory.capacity,
      confirmed: await countConfirmed(tx, runId, request.classCode),
      waitlistExists: await waitlistExists(tx, runId, request.classCode),
      passengerCount: request.passengers.length,
      nextWaitlistNumber: inventory.nextWaitlistNumber,
    });
    for (const passenger of decision.passengers) {
      assertPassengerTransition(null, passenger.status, 'BOOKING');
    }

    // 7. Insert the booking BEFORE any other write, so a conflict leaves nothing behind.
    let bookingId: bigint | null = null;
    for (let attempt = 1; attempt <= MAX_PNR_ATTEMPTS && bookingId === null; attempt++) {
      bookingId = await insertBookingWithPnr(tx, {
        pnr: deps.generatePnr(),
        userId,
        runId,
        classCode: request.classCode,
        idempotencyKey: key,
      });
      if (bookingId === null) {
        // Conflict: either this key was just used in another class (replay) or the PNR collided (retry).
        const concurrent = await findBookingByIdempotencyKey(tx, userId, key);
        if (concurrent !== null) return { booking: toView(concurrent), created: false };
      }
    }
    if (bookingId === null) {
      throw new Error(`Could not generate a unique PNR in ${MAX_PNR_ATTEMPTS} attempts`);
    }

    // 8. Persist the decision.
    const waitlisted = decision.nextWaitlistNumber - inventory.nextWaitlistNumber;
    if (waitlisted > 0) {
      await bumpWaitlistNumber(tx, runId, request.classCode, waitlisted);
    }
    await insertPassengers(
      tx,
      bookingId,
      decision.passengers.map((p, index) => {
        const input = request.passengers[index];
        if (input === undefined) {
          throw new InvariantViolationError('Decision and passenger list lengths differ');
        }
        return { ...p, name: input.name };
      }),
    );

    return { booking: toView(await getBookingById(tx, bookingId)), created: true };
  });
}
