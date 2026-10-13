import { z } from 'zod';

export const CHART_STATUSES = ['NOT_YET_OPEN', 'OPEN', 'CLOSED', 'CHART_LOCKED'] as const;

/** GET /api/run, and the response of the admin window actions (DESIGN_SPEC §9). */
export const RunSummaryDtoSchema = z.object({
  trainNumber: z.string(),
  trainName: z.string(),
  journeyDate: z.iso.date(),
  bookingOpensAt: z.iso.datetime(),
  bookingClosesAt: z.iso.datetime(),
  /** The EFFECTIVE status: an OPEN window past its closing time reads CLOSED. */
  chartStatus: z.enum(CHART_STATUSES),
  chartPreparedAt: z.iso.datetime().nullable(),
  classes: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      capacity: z.number().int(),
      confirmed: z.number().int(),
      /** Seats a new booking would get now (0 while anyone is waitlisted). */
      available: z.number().int(),
      waitlistLength: z.number().int(),
    }),
  ),
});
export type RunSummaryDto = z.infer<typeof RunSummaryDtoSchema>;
