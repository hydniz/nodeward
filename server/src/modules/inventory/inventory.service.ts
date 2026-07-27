// ---------------------------------------------------------------------------
// inventory module — the read side of the facts, and the door the agents use
//
// Reads project whatever the store holds (the demo fixture or applied agent
// reports) into the shapes the frontend already consumes.
//
// The write side is `applyReport`: the route has authenticated the agent and
// pinned the host, the schema has rebuilt the payload field by field — what
// arrives here is trusted. The service's own job is the one check that needs
// store knowledge (dropping edges into networks nobody knows) and handing the
// snapshot to the store.
// ---------------------------------------------------------------------------

import type { Logger } from '../../core/logger.ts';
import type { Store } from '../../store/index.ts';
import {
  serviceKey,
} from '../../domain/common.ts';
import type {
  DnsRecord, DnsZone, HostHealth, HostId, HostView, Inventory, InventoryReport,
  NetworkFacts, ServiceId, ServiceView, Status,
} from '../../domain/index.ts';

export interface InventoryService {
  /** everything, for the layout engine. */
  all(): Promise<Inventory>;
  listHosts(): Promise<HostView[]>;
  getHost(id: HostId): Promise<HostView | null>;
  listServices(): Promise<ServiceView[]>;
  getService(id: ServiceId): Promise<ServiceView | null>;
  listNetworks(): Promise<NetworkFacts[]>;
  domains(): Promise<{ zones: DnsZone[]; records: DnsRecord[] }>;
  /** when the facts last changed; the topology cache keys on this. */
  lastChangedAt(): Promise<string | null>;
  /** agent ingest. */
  applyReport(report: InventoryReport): Promise<void>;
}

/**
 * Fold the latest measurements into the host facts.
 *
 * The fixture already carries cpu/ram/disk/status, so with an empty health
 * store the host is returned unchanged — that is why the prototype keeps
 * working. As soon as `HealthRepository.latest*` returns something, the
 * measured values win and the fixture numbers stop mattering.
 */
function withHealth(host: HostView, health: HostHealth | undefined): HostView {
  if (!health) return host;
  const uptimeDays = health.uptimeSeconds != null
    ? Math.floor(health.uptimeSeconds / 86400)
    : host.uptimeDays;
  return {
    ...host,
    status: health.status,
    ...(health.warn ? { warn: health.warn } : {}),
    cpu: health.cpu ?? host.cpu,
    ram: health.ram ?? host.ram,
    disk: health.disk ?? host.disk,
    uptimeDays,
    uptime: health.uptimeSeconds != null ? `${uptimeDays}d` : host.uptime,
  };
}

export function createInventoryService(store: Store, log: Logger): InventoryService {
  const hostsWithHealth = async (): Promise<HostView[]> => {
    const [hosts, health] = await Promise.all([
      store.inventory.listHosts(),
      store.health.latestAll(),
    ]);
    return hosts.map((h) => withHealth(h, health.get(h.id)));
  };

  /** one service, assembled from the host that runs it. */
  const project = (host: HostView, records: DnsRecord[]): ServiceView[] => host.nodes.map((node) => {
    const chip = host.chips.find((c) => (c.nodes ?? [c.id]).includes(node.id)) ?? null;
    const interfaces = host.interfaces.filter((i) => i.node === node.id);
    const status: Status = host.status === 'down' || node.down ? 'down' : host.status;
    return {
      id: serviceKey(host.id, node.id),
      hostId: host.id,
      hostName: host.name,
      node,
      chip,
      interfaces,
      records: records
        .filter((r) => r.server === host.id && r.node === node.id)
        .map((r) => r.fqdn),
      status,
    };
  });

  return {
    all: async () => {
      const [inventory, hosts] = await Promise.all([
        store.inventory.all(),
        hostsWithHealth(),
      ]);
      return { ...inventory, hosts };
    },

    listHosts: hostsWithHealth,

    getHost: async (id) => {
      const [host, health] = await Promise.all([
        store.inventory.getHost(id),
        store.health.latest(id).catch(() => null), // health may not be implemented yet
      ]);
      return host ? withHealth(host, health ?? undefined) : null;
    },

    listServices: async () => {
      const [hosts, records] = await Promise.all([hostsWithHealth(), store.inventory.listRecords()]);
      return hosts.flatMap((h) => project(h, records));
    },

    getService: async (id) => {
      const all = await createInventoryService(store, log).listServices();
      return all.find((s) => s.id === id) ?? null;
    },

    listNetworks: () => store.inventory.listNetworks(),

    domains: async () => {
      const [zones, records] = await Promise.all([
        store.inventory.listZones(),
        store.inventory.listRecords(),
      ]);
      return { zones, records };
    },

    lastChangedAt: () => store.inventory.lastChangedAt(),

    /**
     * Accept a validated inventory snapshot from an agent.
     *
     * How it works:
     *
     *   1. Collect every network id that will exist after this report — what
     *      the store already knows plus what the report brings along.
     *   2. Drop edges pointing at networks outside that set, and say so in the
     *      log: an edge into a network nobody reported would be a dangling
     *      line in the graph. Dropping (instead of refusing) keeps a fleet
     *      bootstrappable — the first agent may reference a mesh whose other
     *      members simply have not reported yet; its edge appears with their
     *      first report.
     *   3. Hand the snapshot to `store.inventory.replaceHost`, which swaps it
     *      in atomically and stamps `lastChangedAt` — the topology cache keys
     *      on that stamp, so the next graph read recomputes the layout.
     *   4. Log what was accepted, so an agent's "202 but nothing changed?"
     *      is answerable from the server log alone.
     *
     * The read between step 1 and the store swap is not transactional, but
     * the store only ever grows its network set — worst case a concurrently
     * added network makes this report drop an edge that the host's next
     * report (inventory is a periodic snapshot) brings back.
     */
    applyReport: async (report) => {
      const knownNets = new Set((await store.inventory.listNetworks()).map((n) => n.id));
      for (const net of report.networks ?? []) knownNets.add(net.id);

      const edges = report.edges ?? [];
      const dropped = edges.filter((e) => !knownNets.has(e.net));
      if (dropped.length > 0) {
        log.warn('dropping edges into unknown networks', {
          hostId: report.hostId,
          edges: dropped.map((e) => `${e.id}→${e.net}`),
        });
      }

      await store.inventory.replaceHost({
        ...report,
        edges: edges.filter((e) => knownNets.has(e.net)),
      });

      log.info('inventory report applied', {
        hostId: report.hostId,
        collectedAt: report.collectedAt,
        services: report.host.nodes.length,
        interfaces: report.host.interfaces.length,
        edges: edges.length - dropped.length,
        networks: report.networks?.length ?? 0,
        zones: report.zones?.length ?? 0,
        records: report.records?.length ?? 0,
      });
    },
  };
}
