// ---------------------------------------------------------------------------
// configuration
//
// The only file that reads `process.env`. Everything else receives a `Config`,
// which makes the server testable and makes it obvious what can be tuned from
// the outside.
//
// env vars
//   PORT                      http port                        (4001)
//   NODE_ENV                  development | production | test   (development)
//   LOG_LEVEL                 debug | info | warn | error       (debug/info)
//   STORE_DRIVER              memory | postgres                 (memory)
//   DATABASE_URL              connection string for postgres    (—)
//   DEMO_DATA                 serve the fixture inventory       (true on memory)
//   AGENT_JOIN_TOKEN          shared secret for enrolment       (—)
//   AGENT_TOKEN               single bearer token for all agents, dev shortcut
//   AGENT_HEARTBEAT_TIMEOUT   seconds until an agent is `stale` (90)
//   INGEST_MAX_BODY           max report size                   (1mb)
//   HEALTH_RETENTION_DAYS     how long samples are kept         (30)
// ---------------------------------------------------------------------------

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LogLevel } from './core/logger.ts';
import type { Seconds } from './domain/common.ts';

export type NodeEnv = 'development' | 'production' | 'test';
export type StoreDriver = 'memory' | 'postgres';

export interface Config {
  env: NodeEnv;
  port: number;
  log: { level: LogLevel; json: boolean };
  /** absolute path of the built frontend; served when it exists. */
  clientDist: string;
  store: {
    driver: StoreDriver;
    /** required for `postgres`. */
    url?: string;
    /** seed the inventory from `src/fixtures` so the ui has something to draw. */
    demoData: boolean;
  };
  agents: {
    /** secret an agent needs to enrol. Enrolment is closed while unset. */
    joinToken?: string;
    /**
     * Development shortcut: one bearer token that authenticates every agent.
     * Leave unset in production and issue per-agent tokens at registration.
     */
    sharedToken?: string;
    /** no report for this long → the agent counts as `stale`. */
    heartbeatTimeoutSeconds: Seconds;
    /** bytes; anything larger is refused with 413 before parsing. */
    maxReportBytes: number;
  };
  health: {
    retentionDays: number;
    /** what the server asks agents to use when it has no better idea. */
    defaultIntervalSeconds: Seconds;
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));

const bool = (v: string | undefined, fallback: boolean): boolean => {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};

const int = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T => (
  allowed.includes(v as T) ? (v as T) : fallback
);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = oneOf(env.NODE_ENV, ['development', 'production', 'test'] as const, 'development');
  const driver = oneOf(env.STORE_DRIVER, ['memory', 'postgres'] as const, 'memory');
  const production = nodeEnv === 'production';

  const config: Config = {
    env: nodeEnv,
    port: int(env.PORT, 4001),
    log: {
      level: oneOf(env.LOG_LEVEL, ['debug', 'info', 'warn', 'error'] as const, production ? 'info' : 'debug'),
      json: bool(env.LOG_JSON, production),
    },
    clientDist: path.resolve(here, '../../client/dist'),
    store: {
      driver,
      ...(env.DATABASE_URL ? { url: env.DATABASE_URL } : {}),
      // the fixture keeps the prototype alive; a real store starts empty
      demoData: bool(env.DEMO_DATA, driver === 'memory'),
    },
    agents: {
      ...(env.AGENT_JOIN_TOKEN ? { joinToken: env.AGENT_JOIN_TOKEN } : {}),
      ...(env.AGENT_TOKEN ? { sharedToken: env.AGENT_TOKEN } : {}),
      heartbeatTimeoutSeconds: int(env.AGENT_HEARTBEAT_TIMEOUT, 90),
      maxReportBytes: int(env.INGEST_MAX_BODY, 1024 * 1024),
    },
    health: {
      retentionDays: int(env.HEALTH_RETENTION_DAYS, 30),
      defaultIntervalSeconds: int(env.AGENT_INTERVAL, 15),
    },
  };

  // fail loudly on combinations that cannot work, rather than at first request
  if (config.store.driver === 'postgres' && !config.store.url) {
    throw new Error('STORE_DRIVER=postgres needs DATABASE_URL');
  }
  return config;
}
