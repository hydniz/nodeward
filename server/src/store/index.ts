// ---------------------------------------------------------------------------
// store factory
//
// One switch, so adding a driver is a two-line change here plus one new file.
// ---------------------------------------------------------------------------

import type { Config } from '../config.ts';
import type { Logger } from '../core/logger.ts';
import { createMemoryStore } from './memory.ts';
import type { Store } from './types.ts';

export type { Store } from './types.ts';
export type {
  AgentRepository, AlertRepository, HealthRepository, InventoryRepository,
} from './types.ts';

export async function createStore(config: Config, log: Logger): Promise<Store> {
  switch (config.store.driver) {
    case 'memory':
      log.info('store: memory', { demoData: config.store.demoData });
      return createMemoryStore({ demoData: config.store.demoData });

    case 'postgres':
      /**
       * TODO(implement): the postgres driver.
       *
       * The schema, the retention tiering and the reasoning behind both are in
       * `server/docs/storage.md` — read that first, it is the decision this file
       * only executes. The short version:
       *
       *   • three storage classes: facts (relational, snapshot per host),
       *     samples (append-only, tiered), state (agents/alerts, mutable)
       *   • every measurement is identified by (host_id, target, name) and gets a
       *     row in `metric_series`; samples reference it by id. That catalogue is
       *     what keeps values findable years later
       *   • host vitals (cpu/ram/disk/load/uptime) go into one wide row per host
       *     per tick; everything else into narrow `(series_id, at, value)` rows
       *   • raw 7 d → 5 min 90 d → 1 h forever, partitioned by time so retention
       *     is `drop table`, never `delete` (25× less disk, no vacuum storms)
       *
       * Implement it as `store/postgres.ts` exporting `createPostgresStore(config)`
       * and wire it in below. Migrations: plain numbered sql in
       * `server/db/migrations/`, recorded in `schema_migrations`.
       */
      throw new Error(
        'STORE_DRIVER=postgres: implement server/src/store/postgres.ts and wire it here '
        + '(schema: server/docs/storage.md)',
      );

    default:
      throw new Error(`unknown store driver: ${String(config.store.driver)}`);
  }
}
