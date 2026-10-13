// Maps service results to the JSON shapes in packages/shared (DESIGN_SPEC §9):
// Dates → ISO strings, nulls → omitted optional fields. Presentation only.
import type { BookingDto, ChartSummaryDto, RunSummaryDto } from '@railway/shared';
import type { BookingDetails } from '../services/bookingQueryService';
import type { ChartSummary } from '../services/chartService';
import type { RunSummary } from '../services/runService';

export function toBookingDto(booking: BookingDetails): BookingDto {
  return {
    pnr: booking.pnr,
    classCode: booking.classCode,
    createdAt: booking.createdAt.toISOString(),
    status: booking.status,
    passengers: booking.passengers.map((p) => ({
      position: p.position,
      name: p.name,
      status: p.status,
      ...(p.waitlistNumber === null ? {} : { waitlistNumber: p.waitlistNumber }),
      ...(p.currentWaitlistPosition === null
        ? {}
        : { currentWaitlistPosition: p.currentWaitlistPosition }),
      ...(p.seatLabel === null ? {} : { seatLabel: p.seatLabel }),
    })),
  };
}

export function toRunSummaryDto(run: RunSummary): RunSummaryDto {
  return {
    trainNumber: run.trainNumber,
    trainName: run.trainName,
    journeyDate: run.journeyDate.toISOString().slice(0, 10),
    bookingOpensAt: run.bookingOpensAt.toISOString(),
    bookingClosesAt: run.bookingClosesAt.toISOString(),
    chartStatus: run.chartStatus,
    chartPreparedAt: run.chartPreparedAt?.toISOString() ?? null,
    classes: run.classes,
  };
}

export function toChartSummaryDto(chart: ChartSummary): ChartSummaryDto {
  return {
    chartStatus: chart.chartStatus,
    chartPreparedAt: chart.chartPreparedAt.toISOString(),
    classes: chart.classes,
  };
}
