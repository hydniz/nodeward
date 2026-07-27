// ---------------------------------------------------------------------------
// the storage contract
//
// Four repositories, one per kind of data, bundled into a `Store`. Modules only
// ever see these interfaces — swapping the memory driver for postgres must not
// touch a single line in `modules/`.
//
// Everything is async even where the memory driver answers instantly, so the
// call sites are already shaped for a database.
//
// Write methods that the ingest needs are declared here and left unimplemented
// in every driver: they are the seams the agent logic hangs off.
// ---------------------------------------------------------------------------

import type {
  Agent, AgentConfig, AgentEvent, AgentId, Alert, AlertRule, DnsRecord, DnsZone,
  EdgeFacts, HealthReport, HostHealth, HostId, HostView, Inventory,
  InventoryReport, MetricSeries, NetworkFacts, P2PFacts, SeriesInfo, SeriesQuery,
  Timestamp,
} from '../domain/index.ts';
import type { RejectedRecord } from './facts.ts';

export type StoreDriverKind = 'memory' | 'sqlite' | 'postgres';

// ---- inventory ------------------------------------------------------------

/** What `replaceHost` did with the parts of a report it could not simply apply. */
export interface ReplaceResult {
  /**
   * Records the report claimed but another host (or shared zone data) already
   * holds — dropped rather than applied, per `facts.ts → splitRecordClaims`.
   * The caller logs them: an agent posting somebody else's record id is either
   * a service migration mid-flight or a compromised host trying to re-point a
   * name, and both deserve a line in the log.
   */
  rejectedRecords: RejectedRecord[];
}

export interface InventoryRepository {
  /** everything at once; the topology layout needs the whole picture. */
  all(): Promise<Inventory>;

  listHosts(): Promise<HostView[]>;
  getHost(id: HostId): Promise<HostView | null>;
  listNetworks(): Promise<NetworkFacts[]>;
  listEdges(): Promise<EdgeFacts[]>;
  listP2P(): Promise<P2PFacts[]>;
  listZones(): Promise<DnsZone[]>;
  listRecords(): Promise<DnsRecord[]>;

  /**
   * Replace everything one host reported.
   *
   * Snapshot semantics: services, interfaces and edges that are missing from
   * the report are deleted for that host, and nothing belonging to another host
   * is touched. Must be atomic — a half-applied host would show up as a broken
   * graph.
   *
   * "Nothing belonging to another host is touched" is a guarantee this method
   * owes the caller even when the report says otherwise: dns record ids are a
   * global namespace, so every driver runs the incoming records through
   * `facts.ts → splitRecordClaims` and reports what it refused.
   */
  replaceHost(report: InventoryReport): Promise<ReplaceResult>;

  /** forget a host completely (agent revoked, machine decommissioned). */
  removeHost(id: HostId): Promise<void>;

  /** when the inventory last changed; the layout cache keys off this. */
  lastChangedAt(): Promise<Timestamp | null>;
}

// ---- health ---------------------------------------------------------------

export interface HealthRepository {
  /** append raw samples; the archive is never updated in place. */
  append(report: HealthReport): Promise<void>;

  /** the newest value of each metric, per host — what the ui shows first. */
  latest(hostId: HostId): Promise<HostHealth | null>;
  latestAll(): Promise<Map<HostId, HostHealth>>;

  /** a window, downsampled to `stepSeconds`. */
  series(query: SeriesQuery): Promise<MetricSeries[]>;

  /**
   * The catalogue: everything that is (or was) measured, optionally for one
   * host. Backed by the `metric_series` table — cheap, because it holds one row
   * per metric and not one per sample.
   */
  listSeries(hostId?: HostId): Promise<SeriesInfo[]>;

  /** discrete events, newest first. */
  appendEvents(events: AgentEvent[]): Promise<void>;
  listEvents(hostId: HostId, limit: number): Promise<AgentEvent[]>;

  /** drop everything older than the retention window. */
  prune(olderThan: Timestamp): Promise<number>;
}

// ---- agents ---------------------------------------------------------------

export interface AgentRepository {
  list(): Promise<Agent[]>;
  get(id: AgentId): Promise<Agent | null>;
  getByHost(hostId: HostId): Promise<Agent | null>;

  /**
   * Store a freshly enrolled agent together with the *hash* of its token.
   *
   * One agent per host: if an agent already exists for `agent.hostId` it is
   * replaced (the re-install case — the old token stops working), and its
   * per-agent config carries over to the new agent id. Identity lives on
   * `hostId`; credentials rotate (docs/agent-identity.md §1).
   */
  create(agent: Agent, tokenHash: string): Promise<void>;

  /** for authentication: find the agent a presented token belongs to. */
  findByTokenHash(tokenHash: string): Promise<Agent | null>;

  /** bump `lastSeenAt` (and with it the derived `status`). */
  touch(id: AgentId, at: Timestamp): Promise<void>;

  /** revoke: the token stops working, the inventory stays. */
  revoke(id: AgentId): Promise<void>;

  /** per-agent collector config; falls back to the server default. */
  getConfig(id: AgentId): Promise<AgentConfig | null>;
  setConfig(id: AgentId, config: AgentConfig): Promise<void>;
}

// ---- alerts ---------------------------------------------------------------

export interface AlertRepository {
  listRules(): Promise<AlertRule[]>;
  upsertRule(rule: AlertRule): Promise<void>;

  /** open alerts, newest first. */
  listOpen(): Promise<Alert[]>;
  listForHost(hostId: HostId): Promise<Alert[]>;

  /** raise or update; must be idempotent per (ruleId, hostId, node). */
  raise(alert: Alert): Promise<void>;
  resolve(id: Alert['id'], at: Timestamp): Promise<void>;
  acknowledge(id: Alert['id'], at: Timestamp): Promise<void>;
}

// ---- the bundle -----------------------------------------------------------

export interface Store {
  readonly driver: StoreDriverKind;
  /** true while the inventory comes from `src/fixtures`. */
  readonly demoData: boolean;
  readonly inventory: InventoryRepository;
  readonly health: HealthRepository;
  readonly agents: AgentRepository;
  readonly alerts: AlertRepository;
  /** cheap round trip for `/readyz`. */
  ping(): Promise<void>;
  close(): Promise<void>;
}
