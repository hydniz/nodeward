// ---------------------------------------------------------------------------
// the in-memory driver
//
// What it does today:
//   • serves the demo inventory, so the frontend has a full picture to draw
//   • applies inventory snapshots from agents (replaceHost/removeHost), which
//     is what lets a real host replace its fixture twin
//
// What it deliberately does not do:
//   • keep health samples, agents or alerts — those write paths throw
//     `not_implemented` and name themselves, because that is where the real
//     logic (and the real storage decision) belongs
//
// It is a fine target for a first implementation: fill the maps below, keep the
// interface, and only then decide whether it should be postgres or sqlite.
// ---------------------------------------------------------------------------

import { notImplemented } from '../core/errors.ts';
import { demoInventory } from '../fixtures/demo.ts';
import type {
  Agent, AgentConfig, AgentEvent, AgentId, Alert, AlertRule, HealthReport,
  HostFacts, HostHealth, HostId, HostView, Inventory, InventoryReport,
  MetricSeries, SeriesInfo, SeriesQuery, Timestamp,
} from '../domain/index.ts';
import type {
  AgentRepository, AlertRepository, HealthRepository, InventoryRepository, Store,
} from './types.ts';

const WHERE = 'server/src/store/memory.ts';

const empty = (): Inventory => ({
  hosts: [], networks: [], edges: [], p2p: [], zones: [], records: [],
});

/**
 * Merge a shared collection (networks, zones) by id.
 *
 * How it works: existing entries keep their position, incoming entries are
 * folded over them — an entry with a known id is merged field-wise
 * (`{ ...old, ...incoming }`, so the last writer wins per field but optional
 * fields nobody re-reported survive), an unknown id is appended. Nothing is
 * ever deleted here: a network is shared between hosts, and one host going
 * quiet about it must not tear it out from under the others.
 */
function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const merged = new Map<string, T>(existing.map((e) => [e.id, e]));
  for (const item of incoming) {
    const prev = merged.get(item.id);
    merged.set(item.id, prev ? { ...prev, ...item } : item);
  }
  return [...merged.values()];
}

/**
 * Turn reported facts into the `HostView` the store keeps.
 *
 * A report carries facts only — measurements belong to the health store. The
 * view fields therefore start neutral: the host counts as `up` (it just
 * talked to us via its agent), with no cpu/ram/disk numbers and no uptime.
 * As soon as the health ingest exists, `inventory.service.withHealth` folds
 * real measurements over these defaults on every read.
 */
function freshHostView(host: HostFacts): HostView {
  return {
    ...host,
    status: 'up',
    uptime: null,
    uptimeDays: 0,
    cpu: null,
    ram: null,
    disk: null,
  };
}

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
     * Apply one host's snapshot — the write the agent ingest hangs off.
     *
     * How it works: the complete next `Inventory` is built synchronously (no
     * `await` between reading and writing `state`) and swapped in with a
     * single assignment. In a single-threaded process that makes the whole
     * replacement atomic: a reader either sees the world before the report or
     * after it, never a half-applied host.
     *
     * Ownership decides what "replace" means per collection:
     *   • hosts       — the reported host replaces its previous self
     *   • edges       — this host's edges (`server === hostId`) are replaced
     *   • p2p         — tunnels anchored here (`a.server === hostId`) are
     *                   replaced; tunnels merely ending here belong to the peer
     *   • records     — records terminating here (`server === hostId`) are
     *                   replaced; records without a server are shared zone data
     *                   and merged by id
     *   • networks/zones — shared, merged by id, never deleted (see mergeById)
     *
     * Snapshot semantics follow from the replacement: whatever the report
     * omits within the host's own share is gone. The validator has already
     * guaranteed that every entry claims only the reporting host.
     *
     * Finally `inventoryChangedAt` is stamped — the topology cache keys on it,
     * so the next `/api/topology` read recomputes the layout.
     */
    replaceHost: async (report: InventoryReport) => {
      const current = state.inventory;
      const hostId = report.hostId;

      const incomingRecords = report.records ?? [];
      const keptRecords = current.records.filter((r) => r.server !== hostId);

      state.inventory = {
        hosts: [
          ...current.hosts.filter((h) => h.id !== hostId),
          freshHostView(report.host),
        ],
        networks: mergeById(current.networks, report.networks ?? []),
        edges: [
          ...current.edges.filter((e) => e.server !== hostId),
          ...(report.edges ?? []),
        ],
        p2p: [
          ...current.p2p.filter((p) => p.a.server !== hostId),
          ...(report.p2p ?? []),
        ],
        zones: mergeById(current.zones, report.zones ?? []),
        records: [
          ...mergeById(keptRecords, incomingRecords.filter((r) => !r.server)),
          ...incomingRecords.filter((r) => r.server === hostId),
        ],
      };
      state.inventoryChangedAt = new Date().toISOString();
    },

    /**
     * Forget a host completely (agent revoked, machine decommissioned).
     *
     * Removes the host itself and everything that points at it: its edges,
     * every p2p tunnel with the host on either end (a tunnel to a gone
     * machine is dead whoever reported it), and the dns records terminating
     * on it. Shared data — networks, zones, ownerless records — stays: other
     * hosts still live there. Stamps `inventoryChangedAt` like every write.
     */
    removeHost: async (id: HostId) => {
      const current = state.inventory;
      state.inventory = {
        ...current,
        hosts: current.hosts.filter((h) => h.id !== id),
        edges: current.edges.filter((e) => e.server !== id),
        p2p: current.p2p.filter((p) => p.a.server !== id && p.b.server !== id),
        records: current.records.filter((r) => r.server !== id),
      };
      state.inventoryChangedAt = new Date().toISOString();
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
