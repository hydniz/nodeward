// ---------------------------------------------------------------------------
// the in-memory driver
//
// What it does today:
//   • serves the demo inventory, so the frontend has a full picture to draw
//
// What it deliberately does not do:
//   • keep health samples, agents or alerts — every write path throws
//     `not_implemented` and names itself, because that is where the real logic
//     (and the real storage decision) belongs
//
// It is a fine target for a first implementation: fill the maps below, keep the
// interface, and only then decide whether it should be postgres or sqlite.
// ---------------------------------------------------------------------------

import { notImplemented } from '../core/errors.ts';
import { demoInventory } from '../fixtures/demo.ts';
import type {
  Agent, AgentConfig, AgentEvent, AgentId, Alert, AlertRule, HealthReport,
  HostHealth, HostId, Inventory, InventoryReport, MetricSeries, SeriesInfo,
  SeriesQuery, Timestamp,
} from '../domain/index.ts';
import type {
  AgentRepository, AlertRepository, HealthRepository, InventoryRepository, Store,
} from './types.ts';

const WHERE = 'server/src/store/memory.ts';

const empty = (): Inventory => ({
  hosts: [], networks: [], edges: [], p2p: [], zones: [], records: [],
});

export function createMemoryStore({ demoData }: { demoData: boolean }): Store {
  // the whole world, in one object. A real driver replaces this with tables;
  // the shape of what modules ask for stays the same.
  const state = {
    inventory: demoData ? demoInventory() : empty(),
    inventoryChangedAt: demoData ? new Date().toISOString() : null as Timestamp | null,
  };

  const inventory: InventoryRepository = {
    all: async () => state.inventory,
    listHosts: async () => state.inventory.hosts,
    getHost: async (id) => state.inventory.hosts.find((h) => h.id === id) ?? null,
    listNetworks: async () => state.inventory.networks,
    listEdges: async () => state.inventory.edges,
    listP2P: async () => state.inventory.p2p,
    listZones: async () => state.inventory.zones,
    listRecords: async () => state.inventory.records,

    /**
     * TODO(implement): apply an inventory snapshot.
     *
     * 1. drop every host/service/interface/edge that carries `report.hostId`
     * 2. insert what the report contains, keyed by the same host id
     * 3. merge `report.networks` by id — a network is shared between hosts, so
     *    the last writer wins per field but nobody may delete another's network
     * 4. set `inventoryChangedAt` and let the topology cache know
     *    (`TopologyService.invalidate()`)
     */
    replaceHost: async (_report: InventoryReport) => {
      throw notImplemented('inventory ingest', `${WHERE} → inventory.replaceHost`);
    },

    /** TODO(implement): remove the host and everything that points at it. */
    removeHost: async (_id: HostId) => {
      throw notImplemented('host removal', `${WHERE} → inventory.removeHost`);
    },

    lastChangedAt: async () => state.inventoryChangedAt,
  };

  const health: HealthRepository = {
    /**
     * TODO(implement): keep the samples.
     *
     * Two shapes are needed later, so store with both in mind: the newest value
     * per (host, metric, target) for `latest()`, and an append-only series for
     * `series()`. In memory that is one Map for the head plus a ring buffer per
     * key; in sql it is one row per sample plus an index on (host, name, at).
     */
    append: async (_report: HealthReport) => {
      throw notImplemented('health ingest', `${WHERE} → health.append`);
    },
    latest: async (_hostId: HostId): Promise<HostHealth | null> => {
      throw notImplemented('latest health lookup', `${WHERE} → health.latest`);
    },
    latestAll: async (): Promise<Map<HostId, HostHealth>> => {
      // an empty map is a valid answer: "nothing measured yet". The inventory
      // read model treats it that way, which is why the fixture still renders.
      return new Map();
    },
    series: async (_query: SeriesQuery): Promise<MetricSeries[]> => {
      throw notImplemented('metric series', `${WHERE} → health.series`);
    },
    listSeries: async (_hostId?: HostId): Promise<SeriesInfo[]> => {
      // the catalogue is written by the ingest, so it stays empty until that
      // exists — an empty list is a valid "nothing measured yet"
      return [];
    },
    appendEvents: async (_events: AgentEvent[]) => {
      throw notImplemented('event ingest', `${WHERE} → health.appendEvents`);
    },
    listEvents: async (_hostId: HostId, _limit: number): Promise<AgentEvent[]> => {
      throw notImplemented('event history', `${WHERE} → health.listEvents`);
    },
    prune: async (_olderThan: Timestamp): Promise<number> => {
      throw notImplemented('retention', `${WHERE} → health.prune`);
    },
  };

  const agents: AgentRepository = {
    // list/get answer "nothing enrolled" so the operator ui can render an empty
    // state instead of an error; every write is a seam.
    list: async (): Promise<Agent[]> => [],
    get: async (_id: AgentId): Promise<Agent | null> => null,
    getByHost: async (_hostId: HostId): Promise<Agent | null> => null,
    create: async (_agent: Agent, _tokenHash: string) => {
      throw notImplemented('agent enrolment', `${WHERE} → agents.create`);
    },
    findByTokenHash: async (_hash: string): Promise<Agent | null> => {
      throw notImplemented('agent token lookup', `${WHERE} → agents.findByTokenHash`);
    },
    touch: async (_id: AgentId, _at: Timestamp) => {
      throw notImplemented('agent liveness', `${WHERE} → agents.touch`);
    },
    revoke: async (_id: AgentId) => {
      throw notImplemented('agent revocation', `${WHERE} → agents.revoke`);
    },
    getConfig: async (_id: AgentId): Promise<AgentConfig | null> => null,
    setConfig: async (_id: AgentId, _config: AgentConfig) => {
      throw notImplemented('agent config', `${WHERE} → agents.setConfig`);
    },
  };

  const alerts: AlertRepository = {
    listRules: async (): Promise<AlertRule[]> => [],
    upsertRule: async (_rule: AlertRule) => {
      throw notImplemented('alert rules', `${WHERE} → alerts.upsertRule`);
    },
    listOpen: async (): Promise<Alert[]> => [],
    listForHost: async (_hostId: HostId): Promise<Alert[]> => [],
    raise: async (_alert: Alert) => {
      throw notImplemented('raising alerts', `${WHERE} → alerts.raise`);
    },
    resolve: async () => {
      throw notImplemented('resolving alerts', `${WHERE} → alerts.resolve`);
    },
    acknowledge: async () => {
      throw notImplemented('acknowledging alerts', `${WHERE} → alerts.acknowledge`);
    },
  };

  return {
    driver: 'memory',
    demoData,
    inventory,
    health,
    agents,
    alerts,
    ping: async () => {},
    close: async () => {},
  };
}
