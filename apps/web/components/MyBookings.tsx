'use client';

import type { BookingDto } from '@railway/shared';
import Link from 'next/link';
import { messageFor } from '../lib/messages';
import { useCancelBooking, useMyBookings, useRun } from '../lib/queries';
import { RequireSession } from './RequireSession';
import { Card, ErrorText, PassengerTable, StatusBadge } from './ui';

export function MyBookings() {
  return <RequireSession>{() => <MyBookingsInner />}</RequireSession>;
}

function MyBookingsInner() {
  const bookings = useMyBookings(true);
  const { data: run } = useRun();
  const cancel = useCancelBooking();
  // Cancel is offered only while it can succeed: before the chart is locked.
  const canCancelNow = run?.chartStatus === 'OPEN' || run?.chartStatus === 'CLOSED';

  if (bookings.isPending) return <p className="text-sm text-gray-500">Loading…</p>;
  if (bookings.isError) return <ErrorText message={messageFor(bookings.error)} />;
  if (bookings.data.length === 0) {
    return (
      <Card>
        <p className="text-sm text-gray-600">
          No bookings yet.{' '}
          <Link href="/" className="text-blue-700 hover:underline">
            Book now
          </Link>
        </p>
      </Card>
    );
  }

  function confirmCancel(booking: BookingDto) {
    const names = booking.passengers.map((p) => p.name).join(', ');
    if (window.confirm(`Cancel PNR ${booking.pnr} for ${names}? This cancels every passenger.`)) {
      cancel.mutate(booking.pnr);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ErrorText message={cancel.isError ? messageFor(cancel.error) : null} />
      {bookings.data.map((b) => (
        <Card key={b.pnr}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Link
                href={`/bookings/${b.pnr}`}
                className="font-mono text-lg font-semibold hover:underline"
              >
                {b.pnr}
              </Link>
              <StatusBadge status={b.status} />
              <span className="text-sm text-gray-500">{b.classCode}</span>
            </div>
            {canCancelNow && b.status !== 'CANCELLED' && (
              <button
                type="button"
                disabled={cancel.isPending}
                onClick={() => {
                  confirmCancel(b);
                }}
                className="rounded-md border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
          <PassengerTable passengers={b.passengers} />
        </Card>
      ))}
    </div>
  );
}
