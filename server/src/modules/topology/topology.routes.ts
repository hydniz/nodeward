// ---------------------------------------------------------------------------
// topology routes
//
//   GET /api/topology   the laid-out graph (geometry only, see LAYOUT.md)
//
// Cached; a client may poll this. `updated` changes only when the picture does.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { handler } from '../../core/http.ts';
import type { TopologyService } from './topology.service.ts';

export function topologyRoutes(topology: TopologyService): Router {
  const router = Router();

  router.get('/topology', handler(async (_req, res) => {
    res.json(await topology.get());
  }));

  return router;
}
