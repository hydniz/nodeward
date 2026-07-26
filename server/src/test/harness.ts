// ---------------------------------------------------------------------------
// test harness
//
// Builds the real app against the memory store, with logging muted. Tests get
// the express instance (for supertest) plus the store and config to arrange
// state or assert side effects.
// ---------------------------------------------------------------------------

import type { Express } from 'express';
import { createApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import type { Config } from '../config.ts';
import type { Logger } from '../core/logger.ts';
import { createStore } from '../store/index.ts';
import type { Store } from '../store/index.ts';

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

export interface TestApp {
  app: Express;
  config: Config;
  store: Store;
}

/**
 * The app as a test would see it: memory store, no demo data unless a test
 * asks for it. `env` overrides individual variables, e.g. `{ DEMO_DATA: 'true' }`
 * or `{ AGENT_TOKEN: 'secret' }`.
 */
export async function createTestApp(env: NodeJS.ProcessEnv = {}): Promise<TestApp> {
  const config = loadConfig({
    NODE_ENV: 'test',
    STORE_DRIVER: 'memory',
    DEMO_DATA: 'false',
    ...env,
  });
  const store = await createStore(config, silentLogger);
  const { express } = createApp(config, store, silentLogger);
  return { app: express, config, store };
}
