import { z } from 'zod';

export const MAX_PASSENGERS_PER_BOOKING = 6;
export const MAX_PASSENGER_NAME_LENGTH = 60;

export const PassengerInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Passenger name is required')
    .max(MAX_PASSENGER_NAME_LENGTH, `At most ${MAX_PASSENGER_NAME_LENGTH} characters`),
});

/** Body of POST /api/bookings (DESIGN_SPEC §4 step 1, §9). */
export const CreateBookingRequestSchema = z.object({
  classCode: z.string().trim().min(1, 'Class is required'),
  passengers: z
    .array(PassengerInputSchema)
    .min(1, 'At least one passenger')
    .max(MAX_PASSENGERS_PER_BOOKING, `At most ${MAX_PASSENGERS_PER_BOOKING} passengers`),
});
export type CreateBookingRequest = z.infer<typeof CreateBookingRequestSchema>;

/** The Idempotency-Key header: one UUID per booking attempt. */
export const IdempotencyKeySchema = z.uuid('Idempotency-Key must be a UUID');

export const PASSENGER_STATUSES = [
  'CONFIRMED',
  'WAITLISTED',
  'CANCELLED',
  'WAITLIST_EXPIRED',
] as const;

/** Booking status is derived from the passengers, never stored (DESIGN_SPEC §2). */
export const BOOKING_STATUSES = [
  'CONFIRMED',
  'PARTIALLY_CONFIRMED',
  'WAITLISTED',
  'CANCELLED',
  'NOT_CONFIRMED',
] as const;

export const PassengerDtoSchema = z.object({
  position: z.number().int(),
  name: z.string(),
  status: z.enum(PASSENGER_STATUSES),
  /** Permanent number issued at booking ("WL 7"); kept after promotion. */
  waitlistNumber: z.number().int().optional(),
  /** Live rank among those still waiting ("now WL 3"); WAITLISTED passengers only. */
  currentWaitlistPosition: z.number().int().optional(),
  /** e.g. "S1-07"; only after the chart is prepared. */
  seatLabel: z.string().optional(),
});

/** One booking (PNR) as the API returns it (DESIGN_SPEC §9). */
export const BookingDtoSchema = z.object({
  pnr: z.string(),
  classCode: z.string(),
  createdAt: z.iso.datetime(),
  status: z.enum(BOOKING_STATUSES),
  passengers: z.array(PassengerDtoSchema),
});
export type BookingDto = z.infer<typeof BookingDtoSchema>;
export type PassengerDto = z.infer<typeof PassengerDtoSchema>;
