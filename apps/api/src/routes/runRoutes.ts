import { Router } from 'express';
import { toRunSummaryDto } from '../http/dto';
import { getRunSummary } from '../services/runService';

export function runRoutes(): Router {
  const router = Router();

  // GET /api/run: public; polled by the UI for status and availability.
  router.get('/', async (_req, res) => {
    res.json(toRunSummaryDto(await getRunSummary()));
  });

  return router;
}
