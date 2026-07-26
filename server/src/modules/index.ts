// ---------------------------------------------------------------------------
// the module registry — the one place that knows every module
//
// Wiring happens here and nowhere else: services are constructed, handed their
// dependencies explicitly, and their routers are mounted under /api. No module
// imports another module's service directly except through this file, which is
// what keeps them replaceable.
//
// Adding a module: build its service, mount its router, export it on
// `Modules` if something else needs it.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Config } from '../config.ts';
import type { Logger } from '../core/logger.ts';
import { handler } from '../core/http.ts';
import type { Store } from '../store/index.ts';

import { createInventoryService } from './inventory/inventory.service.ts';
import { inventoryRoutes } from './inventory/inventory.routes.ts';
import { createTopologyService } from './topology/topology.service.ts';
import { topologyRoutes } from './topology/topology.routes.ts';
import { createSummaryService } from './summary/summary.service.ts';
import { summaryRoutes } from './summary/summary.routes.ts';
import { createHealthService } from './health/health.service.ts';
import { healthRoutes } from './health/health.routes.ts';
import { createAgentsService } from './agents/agents.service.ts';
import { agentRoutes } from './agents/agents.routes.ts';
import { createAlertsService } from './alerts/alerts.service.ts';
import { alertRoutes } from './alerts/alerts.routes.ts';

export interface Modules {
  inventory: ReturnType<typeof createInventoryService>;
  topology: ReturnType<typeof createTopologyService>;
  summary: ReturnType<typeof createSummaryService>;
  health: ReturnType<typeof createHealthService>;
  agents: ReturnType<typeof createAgentsService>;
  alerts: ReturnType<typeof createAlertsService>;
  /** everything mounted under /api. */
  router: Router;
}

export function createModules(config: Config, store: Store, log: Logger): Modules {
  const inventory = createInventoryService(store, log.child({ module: 'inventory' }));
  const topology = createTopologyService(inventory, log.child({ module: 'topology' }));
  const summary = createSummaryService(store, inventory, log.child({ module: 'summary' }));
  const health = createHealthService(store, log.child({ module: 'health' }));
  const alerts = createAlertsService(store, log.child({ module: 'alerts' }));
  const agents = createAgentsService(config, store, log.child({ module: 'agents' }));

  const router = Router();

  // read side — what the frontend consumes
  router.use(inventoryRoutes(inventory, topology));
  router.use(topologyRoutes(topology));
  router.use(summaryRoutes(summary));
  router.use(healthRoutes(health));
  router.use(alertRoutes(alerts));

  // write side — what the agents talk to
  router.use(agentRoutes(config, store, agents, health, inventory, log.child({ module: 'agents' })));

  /**
   * Where the data comes from, so the ui can say so out loud instead of showing
   * demo numbers as if they were measurements.
   */
  router.get('/meta', handler(async (_req, res) => {
    res.json({
      version: process.env.npm_package_version ?? '0.1.0',
      env: config.env,
      store: store.driver,
      source: store.demoData ? 'fixture' : 'agent',
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      inventoryChangedAt: await inventory.lastChangedAt(),
    });
  }));

  return {
    inventory, topology, summary, health, agents, alerts, router,
  };
}

const startedAt = new Date();
