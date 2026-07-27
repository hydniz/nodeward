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
//   LOG_JSON                  json lines on the console         (true in prod)
//   LOG_DIR                   directory for persistent log files
//                             (server/logs in prod, unset in dev — set it to
//                             opt in during development)
//   STORE_DRIVER              memory | sqlite | postgres        (memory in
//                             development, sqlite in production)
//   SQLITE_PATH               database file for sqlite          (server/data/nodeward.db)
//   DATABASE_URL              connection string for postgres    (—)
//   DEMO_DATA                 serve the fixture inventory       (true on memory)
//   ADMIN_PASSWORD            password for the ui / read api / operator
//                             endpoints. Required in production unless
//                             AUTH_DISABLED=true; min 8 chars
//   AUTH_DISABLED             explicit opt-out: run the ui and read api
//                             without login ("this dashboard is meant to be
//                             public")                          (false)
//   AGENT_JOIN_TOKEN          shared secret for enrolment       (—)
//                             (min 16 chars in production)
//   AGENT_TOKEN               single bearer token for all agents, dev shortcut
//                             (refused in production)
//   AGENT_HEARTBEAT_TIMEOUT   seconds until an agent is `stale` (90)
//   INGEST_MAX_BODY           max report size                   (1mb)
//   REGISTER_RATE_LIMIT       enrolment attempts / ip / minute  (10)
//   TRUST_PROXY               express `trust proxy`: false | true | <hops> |
//                             <preset/cidr list>                (false)
//   HEALTH_RETENTION_DAYS     how long samples are kept         (30)
// ---------------------------------------------------------------------------

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LogLevel } from './core/logger.ts';
import type { Seconds } from './domain/common.ts';

export type NodeEnv = 'development' | 'production' | 'test';
export type StoreDriver = 'memory' | 'sqlite' | 'postgres';

export interface Config {
  env: NodeEnv;
  port: number;
  /**
   * express' `trust proxy` setting — decides what counts as the client ip
   * (`req.ip`), which the register rate limit keys on. `false` when the port
   * is exposed directly (the socket address is the truth); behind a reverse
   * proxy set the hop count (`TRUST_PROXY=1`) or a preset (`loopback`).
   * Trusting blindly would let anyone forge `x-forwarded-for` and sidestep
   * per-ip limits, so the default is the paranoid one.
   */
  trustProxy: boolean | number | string;
  log: {
    level: LogLevel;
    json: boolean;
    /** daily log files land here; unset → console only. Always set in production. */
    dir?: string;
  };
  /** absolute path of the built frontend; served when it exists. */
  clientDist: string;
  store: {
    driver: StoreDriver;
    /** database file for `sqlite`; `:memory:` is valid (tests use it). */
    sqlitePath: string;
    /** required for `postgres`. */
    url?: string;
    /** seed the inventory from `src/fixtures` so the ui has something to draw. */
    demoData: boolean;
  };
  auth: {
    /**
     * Password behind the ui, the read api and the operator endpoints —
     * everything a human sees. Set → login is enforced in every environment;
     * unset → open while developing, refused at boot in production (unless
     * `disabled` says the openness is intentional).
     */
    adminPassword?: string;
    /** explicit "this dashboard is meant to be public" switch. */
    disabled: boolean;
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
    /** enrolment attempts per ip per minute before 429 — the register
     *  endpoint is the only unauthenticated write, so it is the only place a
     *  join token could be brute-forced. */
    registerRateLimitPerMinute: number;
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

/**
 * `TRUST_PROXY` accepts everything express does: booleans, a hop count, or a
 * preset/cidr list (`loopback`, `10.0.0.0/8, loopback`). Unset means false —
 * see the field doc on `Config.trustProxy` for why paranoid is the default.
 */
const trustProxy = (v: string | undefined): boolean | number | string => {
  if (v === undefined || v === '' || v.toLowerCase() === 'false') return false;
  if (v.toLowerCase() === 'true') return true;
  const n = Number(v);
  if (Number.isInteger(n) && n >= 0) return n;
  return v;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = oneOf(env.NODE_ENV, ['development', 'production', 'test'] as const, 'development');
  const production = nodeEnv === 'production';
  // development keeps the fixture-serving memory store for instant gratification;
  // production defaults to the durable driver — a restart must not orphan a fleet
  const driver = oneOf(
    env.STORE_DRIVER,
    ['memory', 'sqlite', 'postgres'] as const,
    production ? 'sqlite' : 'memory',
  );

  const config: Config = {
    env: nodeEnv,
    port: int(env.PORT, 4001),
    trustProxy: trustProxy(env.TRUST_PROXY),
    log: {
      level: oneOf(env.LOG_LEVEL, ['debug', 'info', 'warn', 'error'] as const, production ? 'info' : 'debug'),
      json: bool(env.LOG_JSON, production),
      // production always persists; development only when LOG_DIR is set
      ...(env.LOG_DIR
        ? { dir: path.resolve(env.LOG_DIR) }
        : production ? { dir: path.resolve(here, '../logs') } : {}),
    },
    clientDist: path.resolve(here, '../../client/dist'),
    store: {
      driver,
      sqlitePath: env.SQLITE_PATH ?? path.resolve(here, '../data/nodeward.db'),
      ...(env.DATABASE_URL ? { url: env.DATABASE_URL } : {}),
      // the fixture keeps the prototype alive; a real store starts empty
      demoData: bool(env.DEMO_DATA, driver === 'memory'),
    },
    auth: {
      ...(env.ADMIN_PASSWORD ? { adminPassword: env.ADMIN_PASSWORD } : {}),
      disabled: bool(env.AUTH_DISABLED, false),
    },
    agents: {
      ...(env.AGENT_JOIN_TOKEN ? { joinToken: env.AGENT_JOIN_TOKEN } : {}),
      ...(env.AGENT_TOKEN ? { sharedToken: env.AGENT_TOKEN } : {}),
      heartbeatTimeoutSeconds: int(env.AGENT_HEARTBEAT_TIMEOUT, 90),
      maxReportBytes: int(env.INGEST_MAX_BODY, 1024 * 1024),
      registerRateLimitPerMinute: int(env.REGISTER_RATE_LIMIT, 10),
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

  // production refuses the development shortcuts instead of quietly running
  // with them: a server that boots is a server someone will trust
  if (production && config.agents.sharedToken) {
    throw new Error(
      'AGENT_TOKEN is a development shortcut (one shared token, host taken from the payload) '
      + 'and must not be set in production — unset it and enrol agents via AGENT_JOIN_TOKEN',
    );
  }
  if (production && config.agents.joinToken && config.agents.joinToken.length < 16) {
    throw new Error(
      'AGENT_JOIN_TOKEN must be at least 16 characters in production — '
      + 'generate one with: openssl rand -base64 24',
    );
  }

  // a production dashboard without a login is a decision, not an accident:
  // the inventory (hostnames, internal ips, open ports, dns) is one of the
  // most sensitive documents a company owns
  if (production && !config.auth.adminPassword && !config.auth.disabled) {
    throw new Error(
      'production needs ADMIN_PASSWORD (the login for the dashboard and read api) — '
      + 'or AUTH_DISABLED=true if this dashboard is intentionally public',
    );
  }
  if (config.auth.adminPassword && config.auth.adminPassword.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters');
  }
  return config;
}
