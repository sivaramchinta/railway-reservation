import { z } from 'zod';

/** POST /api/admin/chart/prepare response (DESIGN_SPEC §6 step 8). */
export const ChartSummaryDtoSchema = z.object({
  chartStatus: z.literal('CHART_LOCKED'),
  chartPreparedAt: z.iso.datetime(),
  classes: z.array(
    z.object({
      classCode: z.string(),
      capacity: z.number().int(),
      promoted: z.number().int(),
      expired: z.number().int(),
      seatsUsed: z.number().int(),
    }),
  ),
});
export type ChartSummaryDto = z.infer<typeof ChartSummaryDtoSchema>;

/** GET /api/admin/chart: the seat map by coach (DESIGN_SPEC §9). */
export const ChartDtoSchema = z.object({
  coaches: z.array(
    z.object({
      label: z.string(),
      classCode: z.string(),
      seats: z.array(
        z.object({
          number: z.number().int(),
          label: z.string(),
          pnr: z.string().optional(),
          passengerName: z.string().optional(),
        }),
      ),
    }),
  ),
});
export type ChartDto = z.infer<typeof ChartDtoSchema>;
