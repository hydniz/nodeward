// ---------------------------------------------------------------------------
// entrypoint
//
//   config → logger → store → app → listen
//
// Node runs this file directly (type stripping, node >= 22.6); there is no build
// step. `npm run typecheck -w server` is what checks the types.
//
// Also the place for background work, because it owns the lifecycle: the
// retention sweep and the "agent went quiet" check belong here, both marked
// below.
// ---------------------------------------------------------------------------

import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createLogger } from './core/logger.ts';
import { createStore } from './store/index.ts';

const config = loadConfig();
const log = createLogger(config.log);

const store = await createStore(config, log.child({ module: 'store' }));
const { express: app } = createApp(config, store, log);

const server = app.listen(config.port, () => {
  log.info('nodeward api listening', {
    url: `http://localhost:${config.port}`,
    env: config.env,
    store: store.driver,
    demoData: store.demoData,
  });
  if (store.demoData) {
    log.warn('serving the demo fixture — no agent data is being used', {
      hint: 'set DEMO_DATA=false once the inventory ingest is implemented',
    });
  }
  if (!config.agents.joinToken && !config.agents.sharedToken) {
    log.warn('no agent credentials configured', {
      hint: 'set AGENT_JOIN_TOKEN (enrolment) and/or AGENT_TOKEN (development)',
    });
  }
});

/**
 * TODO(implement): the two periodic jobs, once their services do something.
 *
 *   retention — every hour: `modules.health.prune()`; log how many samples went
 *   liveness  — every `config.agents.heartbeatTimeoutSeconds / 3`: find agents
 *               whose `lastSeenAt` is older than the window and let the alert
 *               module raise "host unreachable". This is the only way a host
 *               that dies silently ever turns red — no report means no ingest,
 *               so nothing else would notice.
 *
 * Use `setInterval(...).unref()` so a pending timer never keeps the process
 * alive during shutdown.
 */

// ---- shutdown -------------------------------------------------------------
// stop accepting connections, let in-flight requests finish, then close the
// store. A hard exit after 10s so a stuck socket cannot block a deploy.
let closing = false;
const shutdown = (signal: string) => {
  if (closing) return;
  closing = true;
  log.info('shutting down', { signal });
  const force = setTimeout(() => {
    log.warn('forcing exit');
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close(async (err) => {
    if (err) log.error('http close failed', { error: String(err) });
    try {
      await store.close();
    } catch (e) {
      log.error('store close failed', { error: String(e) });
    }
    clearTimeout(force);
    process.exit(err ? 1 : 0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// a crash must be loud: log it with the stack, then let the process die so the
// supervisor restarts it — a half-broken server is worse than a restarting one
process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  shutdown('unhandledRejection');
});
process.on('uncaughtException', (err) => {
  log.error('uncaught exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});
