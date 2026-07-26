// ---------------------------------------------------------------------------
// summary routes
//
//   GET /api/summary   fleet counters + open alerts (sidebar badge, tiles)
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { handler } from '../../core/http.ts';
import type { SummaryService } from './summary.service.ts';

export function summaryRoutes(summary: SummaryService): Router {
  const router = Router();

  router.get('/summary', handler(async (_req, res) => {
    res.json(await summary.get());
  }));

  return router;
}
