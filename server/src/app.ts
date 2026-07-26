// ---------------------------------------------------------------------------
// the express app
//
// Assembly only: middleware order, where the modules are mounted, how the built
// frontend is served. No route logic lives here.
//
//   /healthz, /readyz        process probes, no auth, never cached
//   /api/**                  the api (see modules/index.ts)
//   everything else          the built client (client/dist), spa fallback
// ---------------------------------------------------------------------------

import express from 'express';
import type { Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.ts';
import type { Logger } from './core/logger.ts';
import {
  errorHandler, notFoundHandler, requestId, requestLog,
} from './core/middleware.ts';
import { handler } from './core/http.ts';
import { createModules } from './modules/index.ts';
import type { Modules } from './modules/index.ts';
import type { Store } from './store/index.ts';

export interface App {
  express: Express;
  modules: Modules;
}

export function createApp(config: Config, store: Store, log: Logger): App {
  const app = express();
  const modules = createModules(config, store, log);

  app.disable('x-powered-by');
  // behind nginx/caddy this makes req.ip and the protocol truthful
  app.set('trust proxy', true);

  app.use(requestId(log));
  app.use(requestLog());

  // agents post json and nothing else; the limit is a cheap ddos guard
  app.use(express.json({ limit: config.agents.maxReportBytes }));

  // ---- probes -------------------------------------------------------------
  // liveness: the process answers. Never touches the store, so a broken database
  // does not get the container restarted.
  app.get('/healthz', (_req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
  });

  // readiness: the store answers too, so a load balancer can hold traffic back
  app.get('/readyz', handler(async (_req, res) => {
    res.setHeader('cache-control', 'no-store');
    try {
      await store.ping();
      res.json({ ok: true, store: store.driver });
    } catch (e) {
      res.status(503).json({ ok: false, store: store.driver, error: String(e) });
    }
  }));

  // ---- api ----------------------------------------------------------------
  app.use('/api', modules.router);
  // an unknown /api path is a client bug and must not fall through to the spa
  app.use('/api', notFoundHandler());

  // ---- built frontend -----------------------------------------------------
  const hasClient = fs.existsSync(path.join(config.clientDist, 'index.html'));
  if (hasClient) {
    app.use(express.static(config.clientDist, {
      // hashed assets are immutable, index.html must never be cached
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('cache-control', 'no-store');
        else res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      },
    }));
    app.get(/^\/(?!api).*/, (_req, res, next) => {
      res.sendFile(path.join(config.clientDist, 'index.html'), (err) => err && next());
    });
  } else {
    log.warn('no client build found — api only', { clientDist: config.clientDist });
  }

  // ---- errors -------------------------------------------------------------
  app.use(notFoundHandler());
  app.use(errorHandler(log));

  return { express: app, modules };
}
