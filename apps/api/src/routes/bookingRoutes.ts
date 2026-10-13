import { CreateBookingRequestSchema } from '@railway/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config';
import { currentUser, requireUser } from '../http/auth';
import { toBookingDto } from '../http/dto';
import { validateRequest } from '../http/validate';
import { getMyBooking, listMyBookings } from '../services/bookingQueryService';
import { createBooking } from '../services/bookingService';
import { cancelBooking } from '../services/cancellationService';

const CreateBookingSchema = z.object({
  body: CreateBookingRequestSchema,
  params: z.object({}),
  query: z.object({}),
});
const PnrParamsSchema = z.object({
  body: z.unknown(),
  params: z.object({ pnr: z.string() }),
  query: z.object({}),
});

export function bookingRoutes(config: AppConfig): Router {
  const router = Router();
  router.use(requireUser(config)); // every /api/bookings* route needs a session

  // POST /api/bookings: 201 for a new booking, 200 for an idempotent replay.
  router.post('/', async (req, res) => {
    const user = currentUser(req);
    const { body } = validateRequest(req, CreateBookingSchema);
    const result = await createBooking(user.id, body, req.get('Idempotency-Key'));
    const booking = await getMyBooking(user.id, result.booking.pnr);
    res.status(result.created ? 201 : 200).json(toBookingDto(booking));
  });

  // GET /api/bookings: mine, newest first.
  router.get('/', async (req, res) => {
    const bookings = await listMyBookings(currentUser(req).id);
    res.json(bookings.map(toBookingDto));
  });

  // GET /api/bookings/:pnr: 404 unless it is mine.
  router.get('/:pnr', async (req, res) => {
    const { params } = validateRequest(req, PnrParamsSchema);
    res.json(toBookingDto(await getMyBooking(currentUser(req).id, params.pnr)));
  });

  // POST /api/bookings/:pnr/cancel: whole PNR, idempotent.
  router.post('/:pnr/cancel', async (req, res) => {
    const user = currentUser(req);
    const { params } = validateRequest(req, PnrParamsSchema);
    const cancelled = await cancelBooking(user.id, params.pnr);
    res.json(toBookingDto(await getMyBooking(user.id, cancelled.pnr)));
  });

  return router;
}
