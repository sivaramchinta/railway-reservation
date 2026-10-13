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
