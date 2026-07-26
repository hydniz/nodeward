// ---------------------------------------------------------------------------
// topology module — the graph, computed once and cached
//
// The layout engine lives in `shared/autoLayout.js` and is shared with the
// client (which only re-exports the few geometry helpers it needs to draw).
// Running it here is a rule, not an optimisation: R0 in LAYOUT.md says every
// user must see the identical picture.
//
// The only logic in this file is caching: the layout is recomputed when the
// inventory changed, not per request. `invalidate()` is what the inventory
// ingest calls once it starts accepting reports.
// ---------------------------------------------------------------------------

import type { Logger } from '../../core/logger.ts';
import type { HostId } from '../../domain/common.ts';
import type {
  HostBox, LayoutInput, LayoutResult, TopologyPayload,
} from '../../domain/topology.ts';
import type { InventoryService } from '../inventory/inventory.service.ts';

// the engine is plain js and shared with the browser; this is the one place
// that gives it a type. Keep the cast next to the import so a change to the
// engine's signature fails here and not somewhere deep in a route.
import autoLayoutJs from '../../../../shared/autoLayout.js';

const autoLayout = autoLayoutJs as unknown as (input: LayoutInput) => LayoutResult;

export interface TopologyService {
  /** the finished graph, from cache when the inventory has not changed. */
  get(): Promise<TopologyPayload>;
  /**
   * Box geometry per host, from the same cached layout.
   *
   * The `/api/servers` route merges this over the host facts, so the geometry is
   * cached (it only changes with the inventory) while cpu/ram/status stay as
   * fresh as the last report.
   */
  hostBoxes(): Promise<Map<HostId, HostBox>>;
  /** drop the cache; call after every accepted inventory report. */
  invalidate(reason: string): void;
}

export function createTopologyService(
  inventory: InventoryService,
  log: Logger,
): TopologyService {
  let cached: {
    payload: TopologyPayload;
    boxes: Map<HostId, HostBox>;
    key: string;
  } | null = null;

  const compute = async (): Promise<{ payload: TopologyPayload; boxes: Map<HostId, HostBox> }> => {
    const { hosts, networks, edges, p2p } = await inventory.all();
    const started = Date.now();
    const laid = autoLayout({
      networks, servers: hosts, edges, p2p,
    });
    const took = Date.now() - started;
    log.info('layout computed', {
      hosts: hosts.length,
      networks: networks.length,
      edges: edges.length,
      bundles: laid.bundles.length,
      labels: laid.labels.length,
      ms: took,
    });
    // `servers` is dropped from the payload on purpose: the client fetches hosts
    // from /api/servers and the laid-out boxes come with it there. Everything
    // else in the graph payload is geometry only.
    const { servers, ...graph } = laid;
    const boxes = new Map<HostId, HostBox>(servers.map((s) => [s.id, {
      x: s.x, y: s.y, w: s.w, h: s.h, chips: s.chips, zone: s.zone, headerY: s.headerY,
    }]));
    const now = Date.now();
    return {
      payload: { ...graph, updated: now, computedAt: new Date(now).toISOString() },
      boxes,
    };
  };

  /** compute once per change, hand out both views of the result. */
  const current = async () => {
    // the store's change stamp is the cache key; `null` means the store cannot
    // tell, and then recomputing is the only correct answer.
    const stamp = await inventory.lastChangedAt();
    const key = stamp ?? `always-${Date.now()}`;
    if (cached && stamp !== null && cached.key === key) return cached;
    const fresh = await compute();
    cached = { ...fresh, key };
    return cached;
  };

  return {
    get: async () => (await current()).payload,

    hostBoxes: async () => (await current()).boxes,

    invalidate: (reason) => {
      log.debug('topology cache invalidated', { reason });
      cached = null;
    },
  };
}
