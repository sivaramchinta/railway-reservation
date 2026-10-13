import { Router } from 'express';
import type { AppConfig } from '../config';
import { requireAdmin, requireUser } from '../http/auth';
import { toChartSummaryDto, toRunSummaryDto } from '../http/dto';
import { getChart, prepareChart } from '../services/chartService';
import { closeWindow, openWindow } from '../services/windowService';

export function adminRoutes(config: AppConfig): Router {
  const router = Router();
  router.use(requireUser(config), requireAdmin); // 401 if signed out, 403 if not admin

  router.post('/window/open', async (_req, res) => {
    res.json(toRunSummaryDto(await openWindow()));
  });

  router.post('/window/close', async (_req, res) => {
    res.json(toRunSummaryDto(await closeWindow()));
  });

  router.post('/chart/prepare', async (_req, res) => {
    res.json(toChartSummaryDto(await prepareChart()));
  });

  router.get('/chart', async (_req, res) => {
    res.json(await getChart());
  });

  return router;
}
