'use client';

import type { RunSummaryDto } from '@railway/shared';
import { useRun } from '../lib/queries';

const STEPS: { status: RunSummaryDto['chartStatus']; label: string }[] = [
  { status: 'NOT_YET_OPEN', label: 'Not open' },
  { status: 'OPEN', label: 'Booking open' },
  { status: 'CLOSED', label: 'Booking closed' },
  { status: 'CHART_LOCKED', label: 'Chart prepared & locked' },
];

/** The chart state on every page, refreshed every 5 s (DESIGN_SPEC §11). */
export function ChartStepper() {
  const { data: run } = useRun();
  if (run === undefined) return <div className="h-8" aria-hidden />;
  const current = STEPS.findIndex((step) => step.status === run.chartStatus);

  return (
    <div className="flex flex-col gap-1">
      <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Chart status">
        {STEPS.map((step, index) => (
          <li key={step.status} className="flex items-center gap-2">
            <span
              aria-current={index === current ? 'step' : undefined}
              className={
                index === current
                  ? 'rounded-full bg-blue-700 px-3 py-1 font-medium text-white'
                  : index < current
                    ? 'rounded-full bg-blue-100 px-3 py-1 text-blue-800'
                    : 'rounded-full bg-gray-100 px-3 py-1 text-gray-500'
              }
            >
              {step.label}
            </span>
            {index < STEPS.length - 1 && <span className="text-gray-300">→</span>}
          </li>
        ))}
      </ol>
      <p className="text-xs text-gray-500">
        {run.trainNumber} {run.trainName} · journey {run.journeyDate}
        {run.chartStatus === 'OPEN' &&
          ` · booking closes ${new Date(run.bookingClosesAt).toLocaleString()}`}
      </p>
    </div>
  );
}
