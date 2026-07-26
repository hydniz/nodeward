// ---------------------------------------------------------------------------
// inventory module — the read side of the facts, and the door the agents use
//
// Reads are implemented: they project whatever the store holds (today the demo
// fixture) into the shapes the frontend already consumes.
//
// The write side — applying an inventory report — is a documented seam. It is
// the first thing to implement once an agent exists, because everything else
// (topology, services, domains) is derived from it.
// ---------------------------------------------------------------------------

import { notImplemented } from '../../core/errors.ts';
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
     * TODO(implement): accept an inventory snapshot from an agent.
     *
     * The route has already authenticated the agent and checked that
     * `report.hostId` is the host it owns. What is left:
     *
     *   1. validate the payload properly (`inventory.schema.ts`) — an agent is
     *      not a trusted client, and a malformed report must not be able to
     *      corrupt the graph
     *   2. normalise: trim ids, lowercase host ids, drop unknown network refs
     *      (an edge pointing at a network nobody reported is a dangling edge)
     *   3. `store.inventory.replaceHost(report)` — atomic, snapshot semantics
     *   4. tell the topology cache to recompute: `topology.invalidate()`
     *   5. return how much was accepted, so the agent can log it
     *
     * Worth deciding while implementing: do you diff against the previous
     * snapshot to emit `service.started` / `interface.down` events, or do you
     * let the agent report those itself? The event endpoint exists for both.
     */
    applyReport: async (report) => {
      log.debug('inventory report received', { hostId: report.hostId });
      throw notImplemented(
        'inventory ingest',
        'server/src/modules/inventory/inventory.service.ts → applyReport',
      );
    },
  };
}
