// ---------------------------------------------------------------------------
// the sqlite driver — the production default
//
// Built on `node:sqlite` (DatabaseSync), which ships with node ≥ 22.5: no
// native module to compile, no service to run, and the whole deployment's
// state is one file — which makes "back up nodeward" mean "copy one file".
// For the fleet sizes nodeward targets (tens of hosts, not thousands) sqlite
// is not a compromise, it is the right size.
//
// Storage shape: one table per collection, each row `(id, …owner columns…,
// json)`. The owner columns (`server`, `host_id`) exist so the snapshot
// semantics — "replace everything this host owns, touch nothing else" — are
// sql `delete where` clauses; everything the api reads back is the stored
// json verbatim. Same trade as the memory driver, durable.
//
// What it implements mirrors the memory driver exactly: inventory and agents.
// Health samples and alerts stay seams (roadmap steps 3 and 5) and throw
// `not_implemented` naming this file. The merge semantics themselves live in
// `facts.ts`, shared with the memory driver, so the two cannot drift apart.
// ---------------------------------------------------------------------------

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { notImplemented } from '../core/errors.ts';
import { demoInventory } from '../fixtures/demo.ts';
import type {
  Agent, AgentConfig, AgentEvent, AgentId, Alert, AlertRule, DnsRecord,
  HealthReport, HostHealth, HostId, HostView, Inventory, InventoryReport,
  MetricSeries, SeriesInfo, SeriesQuery, Timestamp,
} from '../domain/index.ts';
import { freshHostView, mergeById, splitRecordClaims } from './facts.ts';
import type {
  AgentRepository, AlertRepository, HealthRepository, InventoryRepository, Store,
} from './types.ts';

const WHERE = 'server/src/store/sqlite.ts';

/**
 * The schema, applied on every start (`if not exists`, so it is idempotent).
 * `user_version` records the schema generation for future migrations: bump it
 * and add an `if (version < n)` block when the shape has to change.
 */
const SCHEMA = `
  create table if not exists meta     (key text primary key, value text not null);
  create table if not exists hosts    (id text primary key, json text not null);
  create table if not exists networks (id text primary key, json text not null);
  create table if not exists edges    (id text primary key, server text not null, json text not null);
  create table if not exists p2p      (id text primary key, a_server text not null, b_server text not null, json text not null);
  create table if not exists zones    (id text primary key, json text not null);
  create table if not exists records  (id text primary key, server text, json text not null);
  create table if not exists agents   (
    id         text primary key,
    host_id    text not null unique,
    token_hash text not null,
    json       text not null,
    config     text
  );
  create index if not exists idx_edges_server   on edges(server);
  create index if not exists idx_records_server on records(server);
  create index if not exists idx_agents_token   on agents(token_hash);
`;

export function createSqliteStore(
  { file, demoData }: { file: string; demoData: boolean },
): Store {
  // ':memory:' is a valid sqlite target (tests use it); only real paths need
  // their parent directory to exist
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  // WAL keeps readers and the writer out of each other's way and survives a
  // crash mid-write; NORMAL sync is the documented safe pairing with WAL
  db.exec('pragma journal_mode = wal');
  db.exec('pragma synchronous = normal');
  db.exec('pragma foreign_keys = on');
  db.exec(SCHEMA);
  db.exec('pragma user_version = 1');

  // every write below runs in one transaction: a reader sees the world before
  // a snapshot or after it, never a half-applied host — the same atomicity
  // the memory driver gets from its single-assignment swap
  const tx = <T>(fn: () => T): T => {
    db.exec('begin immediate');
    try {
      const result = fn();
      db.exec('commit');
      return result;
    } catch (e) {
      db.exec('rollback');
      throw e;
    }
  };

  // ---- row helpers --------------------------------------------------------

  const readAll = <T>(table: string): T[] => (
    db.prepare(`select json from ${table} order by id`).all() as { json: string }[]
  ).map((r) => JSON.parse(r.json) as T);

  const readOne = <T>(table: string, id: string): T | null => {
    const row = db.prepare(`select json from ${table} where id = ?`).get(id) as
      | { json: string } | undefined;
    return row ? JSON.parse(row.json) as T : null;
  };

  const stamp = (at: string): void => {
    db.prepare('insert into meta (key, value) values (?, ?) '
      + 'on conflict(key) do update set value = excluded.value')
      .run('inventoryChangedAt', at);
  };

  /** upsert shared collections (networks, zones) with the field-wise merge
   *  from `facts.ts`: read what is there, fold the incoming entry over it. */
  const mergeInto = <T extends { id: string }>(table: string, incoming: T[]): void => {
    const upsert = db.prepare(`insert into ${table} (id, json) values (?, ?) `
      + 'on conflict(id) do update set json = excluded.json');
    for (const item of incoming) {
      const existing = readOne<T>(table, item.id);
      const [merged] = mergeById(existing ? [existing] : [], [item]);
      upsert.run(item.id, JSON.stringify(merged));
    }
  };

  // ---- inventory ----------------------------------------------------------

  const inventory: InventoryRepository = {
    all: async (): Promise<Inventory> => ({
      hosts: readAll<HostView>('hosts'),
      networks: readAll('networks'),
      edges: readAll('edges'),
      p2p: readAll('p2p'),
      zones: readAll('zones'),
      records: readAll('records'),
    }),
    listHosts: async () => readAll<HostView>('hosts'),
    getHost: async (id) => readOne<HostView>('hosts', id),
    listNetworks: async () => readAll('networks'),
    listEdges: async () => readAll('edges'),
    listP2P: async () => readAll('p2p'),
    listZones: async () => readAll('zones'),
    listRecords: async () => readAll('records'),

    /**
     * Apply one host's snapshot. Ownership decides what "replace" means per
     * collection — the rules are the memory driver's, expressed as sql:
     *
     *   • hosts       — upsert the reported host
     *   • edges       — `delete where server = host`, insert the report's
     *   • p2p         — `delete where a_server = host` (tunnels anchored
     *                   here), insert the report's
     *   • records     — records terminating here are replaced; ownerless
     *                   records are shared zone data, merged by id. Ids held
     *                   by another host are refused (`splitRecordClaims`) and
     *                   returned to the caller, never overwritten
     *   • networks/zones — shared, merged field-wise, never deleted
     *
     * All inside one transaction, closed by stamping `inventoryChangedAt` —
     * the topology cache keys on that stamp.
     */
    replaceHost: async (report: InventoryReport) => tx(() => {
      const hostId = report.hostId as string;
      db.prepare('insert into hosts (id, json) values (?, ?) '
        + 'on conflict(id) do update set json = excluded.json')
        .run(hostId, JSON.stringify(freshHostView(report.host)));

      mergeInto('networks', report.networks ?? []);
      mergeInto('zones', report.zones ?? []);

      db.prepare('delete from edges where server = ?').run(hostId);
      const insertEdge = db.prepare('insert into edges (id, server, json) values (?, ?, ?)');
      for (const e of report.edges ?? []) insertEdge.run(e.id, e.server as string, JSON.stringify(e));

      db.prepare('delete from p2p where a_server = ?').run(hostId);
      const insertP2P = db.prepare('insert into p2p (id, a_server, b_server, json) values (?, ?, ?, ?)');
      for (const p of report.p2p ?? []) {
        insertP2P.run(p.id, p.a.server as string, p.b.server as string, JSON.stringify(p));
      }

      // this host's own records go first, so whatever still holds an id below
      // belongs to somebody else — that is what lets `splitRecordClaims` tell
      // a claim from a takeover
      db.prepare('delete from records where server = ?').run(hostId);
      const holder = db.prepare('select server from records where id = ?');
      const { accepted, rejected } = splitRecordClaims(report.records ?? [], (id) => {
        const row = holder.get(id) as { server: string | null } | undefined;
        return row === undefined ? undefined : row.server;
      });

      mergeInto('records', accepted.filter((r) => !r.server));
      // a plain insert, not an upsert: every accepted owned record has a free
      // id by construction, so the primary key is the database restating the
      // ownership rule rather than silently overwriting somebody else's row
      const insertRecord = db.prepare('insert into records (id, server, json) values (?, ?, ?)');
      for (const r of accepted.filter((rec) => rec.server === report.hostId)) {
        insertRecord.run(r.id as string, hostId, JSON.stringify(r));
      }

      stamp(new Date().toISOString());
      return { rejectedRecords: rejected };
    }),

    /**
     * Forget a host completely: the host itself, its edges, every tunnel with
     * the host on either end, and the dns records terminating on it. Shared
     * data (networks, zones, ownerless records) stays — other hosts still
     * live there. Same rules as the memory driver, same stamp at the end.
     */
    removeHost: async (id: HostId) => {
      tx(() => {
        db.prepare('delete from hosts where id = ?').run(id as string);
        db.prepare('delete from edges where server = ?').run(id as string);
        db.prepare('delete from p2p where a_server = ? or b_server = ?').run(id as string, id as string);
        db.prepare('delete from records where server = ?').run(id as string);
        stamp(new Date().toISOString());
      });
    },

    lastChangedAt: async (): Promise<Timestamp | null> => {
      const row = db.prepare('select value from meta where key = ?').get('inventoryChangedAt') as
        | { value: string } | undefined;
      return row?.value ?? null;
    },
  };

  // demo data makes sense for kicking the tires on sqlite too; it is seeded
  // once into an empty database and from then on behaves like agent data
  if (demoData) {
    const count = db.prepare('select count(*) as n from hosts').get() as { n: number };
    if (count.n === 0) {
      tx(() => {
        const demo = demoInventory();
        const ins = (table: string) => db.prepare(`insert into ${table} (id, json) values (?, ?)`);
        for (const h of demo.hosts) ins('hosts').run(h.id as string, JSON.stringify(h));
        for (const n of demo.networks) ins('networks').run(n.id as string, JSON.stringify(n));
        for (const z of demo.zones) ins('zones').run(z.id as string, JSON.stringify(z));
        const insEdge = db.prepare('insert into edges (id, server, json) values (?, ?, ?)');
        for (const e of demo.edges) insEdge.run(e.id, e.server as string, JSON.stringify(e));
        const insP2P = db.prepare('insert into p2p (id, a_server, b_server, json) values (?, ?, ?, ?)');
        for (const p of demo.p2p) insP2P.run(p.id, p.a.server as string, p.b.server as string, JSON.stringify(p));
        const insRecord = db.prepare('insert into records (id, server, json) values (?, ?, ?)');
        for (const r of demo.records) insRecord.run(r.id as string, (r as DnsRecord).server ?? null, JSON.stringify(r));
        stamp(new Date().toISOString());
      });
    }
  }

  // ---- health (seams, like the memory driver) -----------------------------

  const health: HealthRepository = {
    append: async (_report: HealthReport) => {
      throw notImplemented('health ingest', `${WHERE} → health.append`);
    },
    latest: async (_hostId: HostId): Promise<HostHealth | null> => {
      throw notImplemented('latest health lookup', `${WHERE} → health.latest`);
    },
    latestAll: async (): Promise<Map<HostId, HostHealth>> => new Map(),
    series: async (_query: SeriesQuery): Promise<MetricSeries[]> => {
      throw notImplemented('metric series', `${WHERE} → health.series`);
    },
    listSeries: async (_hostId?: HostId): Promise<SeriesInfo[]> => [],
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

  // ---- agents -------------------------------------------------------------

  const agents: AgentRepository = {
    list: async (): Promise<Agent[]> => readAll<Agent>('agents'),
    get: async (id: AgentId): Promise<Agent | null> => readOne<Agent>('agents', id as string),
    getByHost: async (hostId: HostId): Promise<Agent | null> => {
      const row = db.prepare('select json from agents where host_id = ?').get(hostId as string) as
        | { json: string } | undefined;
      return row ? JSON.parse(row.json) as Agent : null;
    },

    /**
     * One agent per host (the `host_id` unique constraint is the database
     * saying so): enrolment for an already-enrolled host is a re-install —
     * the previous row (and its token) is dropped, per-agent config follows
     * the host to the new agent id. See docs/agent-identity.md §1.
     */
    create: async (agent: Agent, tokenHash: string) => {
      tx(() => {
        const old = db.prepare('select id, config from agents where host_id = ?')
          .get(agent.hostId as string) as { id: string; config: string | null } | undefined;
        if (old) db.prepare('delete from agents where id = ?').run(old.id);
        db.prepare('insert into agents (id, host_id, token_hash, json, config) values (?, ?, ?, ?, ?)')
          .run(agent.id as string, agent.hostId as string, tokenHash, JSON.stringify(agent), old?.config ?? null);
      });
    },

    // indexed lookup on the hash — plain equality is fine, both sides are
    // sha-256 digests (see the same note in memory.ts)
    findByTokenHash: async (hash: string): Promise<Agent | null> => {
      const row = db.prepare('select json from agents where token_hash = ?').get(hash) as
        | { json: string } | undefined;
      return row ? JSON.parse(row.json) as Agent : null;
    },

    // liveness is a json field, not a column: it is only ever read back as
    // part of the whole agent. Unknown ids are ignored (same reasoning as the
    // memory driver: a touch can race a re-install)
    touch: async (id: AgentId, at: Timestamp) => {
      db.prepare("update agents set json = json_set(json, '$.lastSeenAt', ?) where id = ?")
        .run(at, id as string);
    },

    revoke: async (id: AgentId) => {
      db.prepare("update agents set json = json_set(json, '$.status', 'revoked') where id = ?")
        .run(id as string);
    },

    getConfig: async (id: AgentId): Promise<AgentConfig | null> => {
      const row = db.prepare('select config from agents where id = ?').get(id as string) as
        | { config: string | null } | undefined;
      return row?.config ? JSON.parse(row.config) as AgentConfig : null;
    },
    setConfig: async (id: AgentId, config: AgentConfig) => {
      db.prepare('update agents set config = ? where id = ?')
        .run(JSON.stringify(config), id as string);
    },
  };

  // ---- alerts (seams) -----------------------------------------------------

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
    driver: 'sqlite',
    demoData,
    inventory,
    health,
    agents,
    alerts,
    ping: async () => {
      db.prepare('select 1').get();
    },
    close: async () => {
      db.close();
    },
  };
}
