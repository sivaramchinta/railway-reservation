// Small presentational pieces shared by several screens.
import type { BookingDto, PassengerDto } from '@railway/shared';
import type { ReactNode } from 'react';

const BOOKING_STATUS: Record<BookingDto['status'], { label: string; className: string }> = {
  CONFIRMED: { label: 'Confirmed', className: 'bg-green-100 text-green-800' },
  PARTIALLY_CONFIRMED: { label: 'Partially confirmed', className: 'bg-amber-100 text-amber-800' },
  WAITLISTED: { label: 'Waitlisted', className: 'bg-amber-100 text-amber-800' },
  CANCELLED: { label: 'Cancelled', className: 'bg-gray-200 text-gray-700' },
  NOT_CONFIRMED: { label: 'Not confirmed', className: 'bg-red-100 text-red-800' },
};

const PASSENGER_STATUS: Record<PassengerDto['status'], string> = {
  CONFIRMED: 'Confirmed',
  WAITLISTED: 'Waitlisted',
  CANCELLED: 'Cancelled',
  WAITLIST_EXPIRED: 'Waitlist expired',
};

export function StatusBadge({ status }: { status: BookingDto['status'] }) {
  const { label, className } = BOOKING_STATUS[status];
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${className}`}>{label}</span>
  );
}

/** "WL 7 (now WL 3)", "Promoted from WL 2", "WL 9 (expired)", or "–". */
export function waitlistText(p: PassengerDto): string {
  if (p.waitlistNumber === undefined) return '–';
  if (p.status === 'WAITLISTED') {
    const now = p.currentWaitlistPosition;
    return now !== undefined && now !== p.waitlistNumber
      ? `WL ${p.waitlistNumber} (now WL ${now})`
      : `WL ${p.waitlistNumber}`;
  }
  if (p.status === 'CONFIRMED') return `Promoted from WL ${p.waitlistNumber}`;
  if (p.status === 'WAITLIST_EXPIRED') return `WL ${p.waitlistNumber} (expired)`;
  return `WL ${p.waitlistNumber}`;
}

export function PassengerTable({ passengers }: { passengers: PassengerDto[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-gray-500">
        <tr>
          <th className="py-1 pr-3 font-medium">#</th>
          <th className="py-1 pr-3 font-medium">Name</th>
          <th className="py-1 pr-3 font-medium">Status</th>
          <th className="py-1 pr-3 font-medium">Waitlist</th>
          <th className="py-1 font-medium">Seat</th>
        </tr>
      </thead>
      <tbody>
        {passengers.map((p) => (
          <tr key={p.position} className="border-t border-gray-100">
            <td className="py-1.5 pr-3 text-gray-500">{p.position}</td>
            <td className="py-1.5 pr-3">{p.name}</td>
            <td className="py-1.5 pr-3">{PASSENGER_STATUS[p.status]}</td>
            <td className="py-1.5 pr-3">{waitlistText(p)}</td>
            <td className="py-1.5 font-mono">{p.seatLabel ?? '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Shown when a group was split between CONFIRMED and waitlisted (DESIGN_SPEC §11). */
export function SplitNote({ passengers }: { passengers: PassengerDto[] }) {
  const confirmed = passengers.filter((p) => p.status === 'CONFIRMED').length;
  const notConfirmed = passengers.filter(
    (p) => p.status === 'WAITLISTED' || p.status === 'WAITLIST_EXPIRED',
  ).length;
  if (confirmed === 0 || notConfirmed === 0) return null;
  return (
    <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
      Your group was split: {confirmed} confirmed, {notConfirmed} not (yet) confirmed. Waitlisted
      passengers can still get seats when the chart is prepared.
    </p>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      {children}
    </section>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className="text-sm text-red-700">
      {message}
    </p>
  );
}

export const buttonClass =
  'rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-300';
