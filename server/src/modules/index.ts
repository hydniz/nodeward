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
import { createAuthService } from './auth/auth.service.ts';
import { authRoutes } from './auth/auth.routes.ts';
import { requireSession } from './auth/auth.middleware.ts';

export interface Modules {
  inventory: ReturnType<typeof createInventoryService>;
  topology: ReturnType<typeof createTopologyService>;
  summary: ReturnType<typeof createSummaryService>;
  health: ReturnType<typeof createHealthService>;
  agents: ReturnType<typeof createAgentsService>;
  alerts: ReturnType<typeof createAlertsService>;
  auth: ReturnType<typeof createAuthService>;
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
  const auth = createAuthService(config, log.child({ module: 'auth' }));

  const router = Router();

  const session = requireSession(config, auth, log.child({ module: 'auth' }));

  // login/logout/me — reachable without a session, obviously
  router.use(authRoutes(auth, log.child({ module: 'auth' })));

  // write side — what the agents talk to (bearer tokens, never sessions).
  // Mounted BEFORE the session gate below: `Router.use(middleware, …)` runs
  // its middleware for every request passing that layer, so agent requests
  // must be fully handled before the human gate is ever consulted. The
  // operator endpoints inside take the session gate per route.
  router.use(agentRoutes(config, store, agents, health, inventory, session, log.child({ module: 'agents' })));

  // everything a human reads sits behind the admin session (open while
  // developing without ADMIN_PASSWORD; production refuses to boot like that).
  // The inventory is the sensitive document here — hostnames, internal ips,
  // open ports — so the read api is gated exactly like the ui that renders it.
  const protectedReads = Router();
  protectedReads.use(session);
  protectedReads.use(inventoryRoutes(inventory, topology));
  protectedReads.use(topologyRoutes(topology));
  protectedReads.use(summaryRoutes(summary));
  protectedReads.use(healthRoutes(health));
  protectedReads.use(alertRoutes(alerts));

  /**
   * Where the data comes from, so the ui can say so out loud instead of showing
   * demo numbers as if they were measurements.
   */
  protectedReads.get('/meta', handler(async (_req, res) => {
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

  router.use(protectedReads);

  return {
    inventory, topology, summary, health, agents, alerts, auth, router,
  };
}

const startedAt = new Date();
