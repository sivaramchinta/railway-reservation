'use client';

import {
  CreateBookingRequestSchema,
  MAX_PASSENGERS_PER_BOOKING,
  type RunSummaryDto,
} from '@railway/shared';
import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { messageFor } from '../lib/messages';
import { useCreateBooking, useRun } from '../lib/queries';
import { buttonClass, Card, ErrorText } from './ui';

interface Row {
  id: string; // React key only
  name: string;
}

const newRow = (): Row => ({ id: crypto.randomUUID(), name: '' });

/** "AC — 3 left" or "AC — waitlist (you'd be WL 4)". Fairness-aware: `available` is 0 while anyone waits. */
function classLabel(c: RunSummaryDto['classes'][number]): string {
  return c.available > 0
    ? `${c.name} (${c.code}) — ${c.available} left`
    : `${c.name} (${c.code}) — waitlist (${c.waitlistLength} waiting)`;
}

export function BookingForm() {
  const { data: run } = useRun();
  const createBooking = useCreateBooking();
  const router = useRouter();

  const [classCode, setClassCode] = useState('');
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [showErrors, setShowErrors] = useState(false);
  // One Idempotency-Key per booking ATTEMPT (DESIGN_SPEC §11): a retry of the same
  // attempt reuses it (no duplicate booking); any edit or a success starts a new attempt.
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());

  if (run === undefined) return <p className="text-sm text-gray-500">Loading…</p>;
  const selectedClass = classCode || run.classes[0]?.code || '';
  const isOpen = run.chartStatus === 'OPEN';

  const request = { classCode: selectedClass, passengers: rows.map((r) => ({ name: r.name })) };
  const validation = CreateBookingRequestSchema.safeParse(request);
  const rowError = (index: number): string | null => {
    if (validation.success || !showErrors) return null;
    const issue = validation.error.issues.find(
      (i) => i.path[0] === 'passengers' && i.path[1] === index,
    );
    return issue?.message ?? null;
  };

  function edited() {
    setAttemptKey(crypto.randomUUID());
    createBooking.reset();
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!validation.success) {
      setShowErrors(true);
      return;
    }
    createBooking.mutate(
      { request: validation.data, idempotencyKey: attemptKey },
      {
        onSuccess: (booking) => {
          setAttemptKey(crypto.randomUUID());
          router.push(`/bookings/${booking.pnr}`);
        },
      },
    );
  }

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">Book tickets</h2>
      {!isOpen && (
        <p className="mb-4 rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-700">
          Booking is not open right now.
        </p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Class</span>
          <select
            value={selectedClass}
            onChange={(e) => {
              setClassCode(e.target.value);
              edited();
            }}
            className="rounded-md border border-gray-300 px-3 py-2"
          >
            {run.classes.map((c) => (
              <option key={c.code} value={c.code}>
                {classLabel(c)}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">
            Passengers ({rows.length} of {MAX_PASSENGERS_PER_BOOKING})
          </legend>
          {rows.map((row, index) => (
            <div key={row.id} className="flex flex-col gap-1">
              <div className="flex gap-2">
                <input
                  aria-label={`Passenger ${index + 1} name`}
                  value={row.name}
                  maxLength={60}
                  placeholder={`Passenger ${index + 1} name`}
                  onChange={(e) => {
                    const name = e.target.value;
                    setRows(rows.map((r) => (r.id === row.id ? { ...r, name } : r)));
                    edited();
                  }}
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2"
                />
                <button
                  type="button"
                  disabled={rows.length === 1}
                  onClick={() => {
                    setRows(rows.filter((r) => r.id !== row.id));
                    edited();
                  }}
                  className="rounded-md border border-gray-300 px-3 text-sm disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
              <ErrorText message={rowError(index)} />
            </div>
          ))}
          <button
            type="button"
            disabled={rows.length >= MAX_PASSENGERS_PER_BOOKING}
            onClick={() => {
              setRows([...rows, newRow()]);
              edited();
            }}
            className="self-start text-sm text-blue-700 hover:underline disabled:text-gray-400 disabled:no-underline"
          >
            + Add passenger
          </button>
        </fieldset>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className={buttonClass}
            disabled={!isOpen || createBooking.isPending}
          >
            {createBooking.isPending ? 'Booking…' : 'Book'}
          </button>
          <ErrorText message={createBooking.isError ? messageFor(createBooking.error) : null} />
        </div>
      </form>
    </Card>
  );
}
