// ---------------------------------------------------------------------------
// alert routes
//
//   GET  /api/alerts                      open alerts, newest first
//   GET  /api/alerts/rules                the configured thresholds
//   POST /api/alerts/:alertId/ack         mark one as seen
//
// The sidebar badge does not use these — it reads the counts from
// `/api/summary`, one request for the whole shell.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { handler } from '../../core/http.ts';
import { asAlertId } from '../../domain/common.ts';
import type { AlertsService } from './alerts.service.ts';

export function alertRoutes(alerts: AlertsService): Router {
  const router = Router();

  router.get('/alerts', handler(async (_req, res) => {
    res.json({ alerts: await alerts.listOpen() });
  }));

  router.get('/alerts/rules', handler(async (_req, res) => {
    res.json({ rules: await alerts.listRules() });
  }));

  router.post('/alerts/:alertId/ack', handler(async (req, res) => {
    await alerts.acknowledge(asAlertId(req.params.alertId));
    res.status(204).end();
  }));

  return router;
}
