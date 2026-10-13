'use client';

import Link from 'next/link';
import { messageFor } from '../lib/messages';
import { useBooking } from '../lib/queries';
import { RequireSession } from './RequireSession';
import { Card, ErrorText, PassengerTable, SplitNote, StatusBadge } from './ui';

/** The booking result page: big PNR, derived status, per-passenger details. */
export function BookingDetail({ pnr }: { pnr: string }) {
  return <RequireSession>{() => <BookingDetailInner pnr={pnr} />}</RequireSession>;
}

function BookingDetailInner({ pnr }: { pnr: string }) {
  const booking = useBooking(pnr);
  if (booking.isPending) return <p className="text-sm text-gray-500">Loading…</p>;
  if (booking.isError) return <ErrorText message={messageFor(booking.error)} />;
  const b = booking.data;

  return (
    <Card>
      <p className="text-sm text-gray-500">PNR</p>
      <p className="mb-3 font-mono text-4xl font-bold tracking-widest">{b.pnr}</p>
      <div className="mb-4 flex items-center gap-3">
        <StatusBadge status={b.status} />
        <span className="text-sm text-gray-500">
          {b.classCode} · booked {new Date(b.createdAt).toLocaleString()}
        </span>
      </div>
      <div className="mb-4">
        <SplitNote passengers={b.passengers} />
      </div>
      <PassengerTable passengers={b.passengers} />
      <Link href="/bookings" className="mt-4 inline-block text-sm text-blue-700 hover:underline">
        ← My bookings
      </Link>
    </Card>
  );
}
