'use client';

import type { ChartDto } from '@railway/shared';
import { messageFor } from '../lib/messages';
import { useChart, useCloseWindow, useOpenWindow, usePrepareChart, useRun } from '../lib/queries';
import { RequireSession } from './RequireSession';
import { buttonClass, Card, ErrorText } from './ui';

export function AdminPanel() {
  return (
    <RequireSession>
      {(session) =>
        session.isAdmin ? (
          <AdminPanelInner />
        ) : (
          <Card>
            <p className="text-sm text-gray-600">Only admins can see this page.</p>
          </Card>
        )
      }
    </RequireSession>
  );
}

function AdminPanelInner() {
  const { data: run } = useRun();
  const open = useOpenWindow();
  const close = useCloseWindow();
  const prepare = usePrepareChart();
  const chart = useChart(true);
  const status = run?.chartStatus;
  const failed = [open, close, prepare].find((m) => m.isError);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Booking window and chart</h2>
        {/* Actions follow the state, so admins never see a button that will fail. */}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={buttonClass}
            disabled={status !== 'NOT_YET_OPEN' || open.isPending}
            onClick={() => {
              open.mutate();
            }}
          >
            Open window
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={status !== 'OPEN' || close.isPending}
            onClick={() => {
              close.mutate();
            }}
          >
            Close window
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={status !== 'CLOSED' || prepare.isPending}
            onClick={() => {
              prepare.mutate();
            }}
          >
            {prepare.isPending ? 'Preparing…' : 'Prepare chart'}
          </button>
        </div>
        <div className="mt-3">
          <ErrorText message={failed === undefined ? null : messageFor(failed.error)} />
        </div>
        {prepare.data && (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="py-1 font-medium">Class</th>
                <th className="py-1 font-medium">Promoted</th>
                <th className="py-1 font-medium">Expired</th>
                <th className="py-1 font-medium">Seats used</th>
              </tr>
            </thead>
            <tbody>
              {prepare.data.classes.map((c) => (
                <tr key={c.classCode} className="border-t border-gray-100">
                  <td className="py-1">{c.classCode}</td>
                  <td className="py-1">{c.promoted}</td>
                  <td className="py-1">{c.expired}</td>
                  <td className="py-1">
                    {c.seatsUsed} / {c.capacity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Seat map</h2>
        {chart.isError && <ErrorText message={messageFor(chart.error)} />}
        {chart.data && <SeatMap chart={chart.data} />}
      </Card>
    </div>
  );
}

function SeatMap({ chart }: { chart: ChartDto }) {
  return (
    <div className="flex flex-col gap-5">
      {chart.coaches.map((coach) => (
        <div key={coach.label}>
          <p className="mb-2 text-sm font-medium">
            Coach {coach.label} <span className="text-gray-500">({coach.classCode})</span>
          </p>
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
            {coach.seats.map((seat) => (
              <div
                key={seat.label}
                title={seat.passengerName ? `${seat.passengerName} · ${seat.pnr ?? ''}` : 'Empty'}
                className={`rounded border px-1 py-1.5 text-center text-xs ${
                  seat.passengerName
                    ? 'border-blue-300 bg-blue-50 text-blue-900'
                    : 'border-gray-200 text-gray-400'
                }`}
              >
                <div className="font-mono font-semibold">{seat.label}</div>
                <div className="truncate">{seat.passengerName ?? 'empty'}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
