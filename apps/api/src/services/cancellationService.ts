import { prisma, runInTransaction } from '../db';
import { effectiveChartStatus } from '../domain/chartState';
import { AppError, InvariantViolationError } from '../domain/errors';
import { assertPassengerTransition } from '../domain/passengerState';
import { isValidPnr } from '../domain/pnr';
import { findBookingOwnership, getBookingById } from '../repositories/bookingRepository';
import { lockClassInventory } from '../repositories/classInventoryRepository';
import { cancelActivePassengers } from '../repositories/passengerRepository';
import { dbNow, getRun } from '../repositories/trainRunRepository';
import { type BookingView, toView } from './bookingView';

/** Same answer for "not yours", "does not exist" and "malformed": never reveal a PNR exists. */
function notFound(): AppError {
  return new AppError('NOT_FOUND', 'Booking not found');
}

/**
 * Cancels a whole PNR (DESIGN_SPEC §5) in ONE transaction holding ONE lock: the
 * booking's class_inventory row, the same lock bookings take. Idempotent:
 * cancelling an already-cancelled booking changes nothing and still succeeds.
 * Freed seats are NOT reassigned here; the waitlist claims them at chart preparation.
 */
export async function cancelBooking(userId: number, pnr: string): Promise<BookingView> {
  const normalized = pnr.trim().toUpperCase();
  if (!isValidPnr(normalized)) throw notFound();

  // 1. Ownership and class never change after insert, so reading them before the lock is safe.
  const booking = await findBookingOwnership(prisma, normalized);
  if (booking === null || booking.userId !== userId) throw notFound();

  return runInTransaction(async (tx) => {
    // 2. THE lock: serializes this cancellation with bookings (and chart prep) in the class.
    const inventory = await lockClassInventory(tx, booking.trainRunId, booking.classCode);
    if (inventory === null) {
      throw new InvariantViolationError('A booking exists for a class with no inventory row');
    }

    // 3. Only before the chart is locked (invariant 4: chart finality).
    const run = await getRun(tx, booking.trainRunId);
    const now = await dbNow(tx);
    const status = effectiveChartStatus(
      run.chartStatus,
      now,
      run.bookingOpensAt,
      run.bookingClosesAt,
    );
    if (status === 'CHART_LOCKED') {
      throw new AppError(
        'CHART_LOCKED',
        'The chart is prepared; bookings can no longer be cancelled',
      );
    }
    if (status === 'NOT_YET_OPEN') {
      throw new InvariantViolationError('A booking exists before the booking window opened');
    }

    // 4. Cancel what is still active, read fresh under the lock. Already cancelled = no-op.
    const current = await getBookingById(tx, booking.id);
    const active = current.passengers.filter(
      (p) => p.status === 'CONFIRMED' || p.status === 'WAITLISTED',
    );
    for (const passenger of active) {
      assertPassengerTransition(passenger.status, 'CANCELLED', 'CANCELLATION');
    }
    if (active.length > 0) {
      await cancelActivePassengers(tx, booking.id);
    }

    return toView(await getBookingById(tx, booking.id));
  });
}
