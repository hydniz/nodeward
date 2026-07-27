// ---------------------------------------------------------------------------
// the in-memory driver
//
// What it does today:
//   • serves the demo inventory, so the frontend has a full picture to draw
//   • applies inventory snapshots from agents (replaceHost/removeHost), which
//     is what lets a real host replace its fixture twin
//   • keeps enrolled agents: the row, the sha-256 hash of the bearer token
//     (never the plaintext), and per-agent collector config
//
// What it deliberately does not do:
//   • keep health samples or alerts — those write paths throw
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
  HostHealth, HostId, Inventory, InventoryReport,
  MetricSeries, SeriesInfo, SeriesQuery, Timestamp,
} from '../domain/index.ts';
import { freshHostView, mergeById, splitRecordClaims } from './facts.ts';
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
     *                   and merged by id. A record id another host already
     *                   holds is refused (`splitRecordClaims`), because record
     *                   ids are a global namespace and the validator can only
     *                   check what a record *claims*, never who holds the id
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

      // this host's own records drop out first, so anything still holding an
      // id below belongs to somebody else (see facts.ts → splitRecordClaims)
      const keptRecords = current.records.filter((r) => r.server !== hostId);
      const held = new Map<string, string | null>(
        keptRecords.map((r) => [r.id as string, (r.server as string | undefined) ?? null]),
      );
      const { accepted, rejected } = splitRecordClaims(
        report.records ?? [],
        (id) => (held.has(id) ? held.get(id) : undefined),
      );

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
          ...mergeById(keptRecords, accepted.filter((r) => !r.server)),
          ...accepted.filter((r) => r.server === hostId),
        ],
      };
      state.inventoryChangedAt = new Date().toISOString();
      return { rejectedRecords: rejected };
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

  // enrolled agents, keyed by agent id. The token is kept only as its sha-256
  // hash — authentication compares hashes (agents.auth.ts), the plaintext
  // exists nowhere but in the enrolment response.
  const agentRows = new Map<AgentId, { agent: Agent; tokenHash: string }>();
  const agentConfigs = new Map<AgentId, AgentConfig>();

  const agents: AgentRepository = {
    // id sort, so the operator list is stable across calls
    list: async (): Promise<Agent[]> => [...agentRows.values()]
      .map((r) => r.agent)
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    get: async (id: AgentId): Promise<Agent | null> => agentRows.get(id)?.agent ?? null,

    // at most one row per host (create() enforces it), so first hit is the hit;
    // register() uses this to detect the re-install case
    getByHost: async (hostId: HostId): Promise<Agent | null> => {
      for (const { agent } of agentRows.values()) {
        if (agent.hostId === hostId) return agent;
      }
      return null;
    },

    /**
     * One agent per host: enrolling a host that already has an agent is the
     * re-install case — the previous row (and with it the old token) is
     * dropped, and per-agent config follows the host to the new agent id,
     * because identity lives on `hostId` while credentials rotate (see
     * docs/agent-identity.md §1).
     */
    create: async (agent: Agent, tokenHash: string) => {
      for (const [id, row] of agentRows) {
        if (row.agent.hostId === agent.hostId) {
          agentRows.delete(id);
          const carried = agentConfigs.get(id);
          agentConfigs.delete(id);
          if (carried) agentConfigs.set(agent.id, carried);
        }
      }
      agentRows.set(agent.id, { agent, tokenHash });
    },

    // the authentication lookup: plain string equality is fine here — both
    // sides are sha-256 hashes, so timing can only leak knowledge of a hash,
    // never of a token (in sql this becomes an indexed `where token_hash = $1`)
    findByTokenHash: async (hash: string): Promise<Agent | null> => {
      for (const row of agentRows.values()) {
        if (row.tokenHash === hash) return row.agent;
      }
      return null;
    },

    // unknown ids are ignored on purpose: a touch can race a re-install, and
    // liveness for an agent that no longer exists is not an error worth a 500
    touch: async (id: AgentId, at: Timestamp) => {
      const row = agentRows.get(id);
      if (row) row.agent = { ...row.agent, lastSeenAt: at };
    },

    // the row stays (the operator list keeps showing who was revoked and when
    // it was last seen) — only the status flips, which is what makes the token
    // hash dead: auth checks the status before accepting the agent
    revoke: async (id: AgentId) => {
      const row = agentRows.get(id);
      if (row) row.agent = { ...row.agent, status: 'revoked' };
    },

    // per-agent collector config; null means "use the server default"
    // (agents.service.ts → configFor decides that fallback, not the store)
    getConfig: async (id: AgentId): Promise<AgentConfig | null> => agentConfigs.get(id) ?? null,
    setConfig: async (id: AgentId, config: AgentConfig) => {
      agentConfigs.set(id, config);
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
