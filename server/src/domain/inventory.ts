// ---------------------------------------------------------------------------
// inventory: the facts an agent reports about its host
//
// "Facts" means everything that is true regardless of load: which services run
// here, which interfaces exist, which networks they join, which names point at
// them. Measurements live in `health.ts`, and the graph geometry derived from
// these facts lives in `topology.ts`.
//
// The split matters for the api: `/api/servers` returns a `HostView`, which is
// `HostFacts` (from the inventory store) merged with the latest `HostHealth`
// (from the health store). The demo fixture carries both in one object; once
// agents report, the merge happens in `modules/inventory/inventory.service.ts`.
// ---------------------------------------------------------------------------

import type {
  HostId, InterfaceId, NetworkId, RecordId, ServiceId, Status, Timestamp, ZoneId,
} from './common.ts';

// ---- networks -------------------------------------------------------------

/** drives the layout band (LAYOUT.md R1) and the grouping on the ui. */
export type NetworkRole = 'provider' | 'mesh' | 'overlay' | 'lan' | 'p2p';

export interface NetworkFacts {
  id: NetworkId;
  name: string;
  /** second line in the cloud, e.g. `100.64.0.0/10 · 12 devices`. */
  sub?: string;
  cidr?: string;
  /** hex, drives every colour the network owns across graph and pages. */
  color: string;
  /** free text: `mesh vpn`, `cni / flannel vxlan`, `internet provider`. */
  kind: string;
  role: NetworkRole;
  /** p2p tunnels get no cloud of their own — they are drawn host ⇄ host. */
  virtual?: boolean;
  note?: string;
}

// ---- interfaces -----------------------------------------------------------

export interface InterfaceAddress {
  ip: string;
  /** `primary`, `floating`, `v6`, `tailscale`, `pod cidr`, … */
  tag?: string;
}

/** a labelled key/value line shown in the interface panel. */
export interface DetailRow {
  l: string;
  r: string;
  tone?: 'dim' | 'accent' | 'warn' | 'down';
}

export interface InterfaceFacts {
  id: InterfaceId;
  /** what to call it in the ui: `eth0`, `ts0 @ ts-wiki`. */
  title: string;
  net: NetworkId;
  /** set when the interface belongs to a service (sidecar, cni), not the host.
   *  This is what makes the link start at the chip in the graph (R5/R8). */
  node?: string;
  ips: InterfaceAddress[];
  /** ports/summary line: `80 443 · 22 ts only`. */
  ports?: string;
  /** measured, filled from health once agents report. */
  rx?: number;
  tx?: number;
  sectionTitle?: string;
  section?: DetailRow[];
  extra?: string;
  note?: string;
  /** compact values for the host modal — derived, kept for the fixture. */
  modal?: { ip?: string; rx?: number; tx?: number; extra?: string; down?: boolean };
}

// ---- services -------------------------------------------------------------

/** one service (container, vm, unit) running on a host. */
export interface ServiceFacts {
  id: string;
  label: string;
  /** one line of what it is: `wikijs 2 · own ts-node ○`. */
  desc: string;
  /** what carries it: `docker`, `k3s`, `native`, `4 vcpu`. */
  res: string;
  down?: boolean;
}

/**
 * A chip is a *stack*: the circle drawn inside the host box. It groups the
 * services that share a lifecycle (a compose stack, a vm, a k3s node) and it
 * is what a link attaches to when the stack has its own network identity.
 */
export interface ServiceChip {
  id: string;
  label: string;
  /** `docker · wikijs stack · ts sidecar` — shown as the stack's kind. */
  kind: string;
  /** ids of the services in this stack. */
  nodes: string[];
  /** hex; set when the stack owns an interface (ring around the chip). */
  ring?: string;
}

// ---- hosts ----------------------------------------------------------------

export interface NetBadge {
  net: NetworkId;
  label: string;
}

/** the part of a host that does not change with load. */
export interface HostFacts {
  id: HostId;
  name: string;
  /** hardware/provider line: `hetzner cpx41 · fsn1`. */
  host: string;
  /** address the ui offers for management (ip or magicdns name). */
  mgmt: string;
  mgmtIp: string;
  /** `ts` when management only works over the mesh, else null. */
  mgmtVia: string | null;
  tags: string[];
  /** short inline tag next to the name in the graph, e.g. `proxmox`. */
  tag?: string;
  netBadges: NetBadge[];
  chips: ServiceChip[];
  nodes: ServiceFacts[];
  interfaces: InterfaceFacts[];
}

/** what `/api/servers` returns: facts + the latest measurements. */
export interface HostView extends HostFacts {
  status: Status;
  /** why the host is in `warning`, e.g. `disk 87%`. */
  warn?: string;
  uptime: string | null;
  uptimeDays: number;
  /** how long it has been unreachable, e.g. `12m`. */
  downFor?: string;
  cpu: number | null;
  ram: number | null;
  disk: number | null;
}

/**
 * What `/api/services` returns: one service together with the host it runs on.
 *
 * A projection, not stored: it is assembled from `HostFacts` every time. The
 * frontend builds the same shape locally (`client/src/services.js`) — keep the
 * two in step, the service page can switch to the endpoint any time.
 */
export interface ServiceView {
  id: ServiceId;
  hostId: HostId;
  hostName: string;
  node: ServiceFacts;
  /** the stack (chip) it belongs to; null when it stands alone. */
  chip: ServiceChip | null;
  /** interfaces the service owns itself; empty means "through the host". */
  interfaces: InterfaceFacts[];
  /** fqdns that terminate on this service. */
  records: string[];
  status: Status;
}

// ---- graph edges ----------------------------------------------------------

/** a membership: this interface of this host joins this network. */
export interface EdgeFacts {
  id: string;
  server: HostId;
  iface: InterfaceId;
  net: NetworkId;
  /** ip label drawn at the interface. */
  label?: string;
  /** MB/s, drives the dash speed. */
  traffic?: number;
  state?: 'down';
  /** service-level link: starts at the chip, not at the box border. */
  ring?: boolean;
  node?: string;
}

/** a direct host ⇄ host tunnel (wireguard); no cloud in between. */
export interface P2PFacts {
  id: string;
  net: NetworkId;
  title: string;
  color: string;
  kind: string;
  a: { server: HostId; iface: InterfaceId };
  b: { server: HostId; iface: InterfaceId };
  traffic?: number;
  labels?: { text: string; end: 'a' | 'b' }[];
}

// ---- dns ------------------------------------------------------------------

export type ZoneKind = 'public' | 'magicdns' | 'internal';

export interface DnsZone {
  id: ZoneId;
  name: string;
  kind: ZoneKind;
  color: string;
  /** who answers: `cloudflare`, `tailscale magicdns`, `pihole @ hermes`. */
  dns: string;
  registrar?: string;
  /** iso date the registration renews. */
  renews?: string;
  ns: string[];
  dnssec: boolean;
  note?: string;
}

export type RecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'magicdns';

export interface DnsRecord {
  id: RecordId;
  zone: ZoneId;
  /** label inside the zone; `@` for the apex. */
  name: string;
  fqdn: string;
  type: RecordType;
  value: string;
  ttl?: string;
  /** behind a reverse proxy that hides the origin (cloudflare). */
  proxied?: boolean;
  /** where the request actually ends up. */
  server?: HostId;
  iface?: InterfaceId;
  node?: string;
  net?: NetworkId;
  /** extra hops between record and origin: `atlas · traefik → tailnet`. */
  via?: string;
  tls?: { issuer: string; expires: string };
  state?: 'down';
  note?: string;
}

// ---- what an agent posts --------------------------------------------------

/**
 * One host's complete inventory, as posted to
 * `POST /api/agents/:agentId/inventory`.
 *
 * It is a *snapshot*, not a patch: whatever is missing is gone. That keeps the
 * agent stateless and makes the ingest idempotent — see
 * `InventoryRepository.replaceHost`.
 */
export interface InventoryReport {
  hostId: HostId;
  collectedAt: Timestamp;
  host: HostFacts;
  /** networks this host can see; the server merges them by id. */
  networks?: NetworkFacts[];
  edges?: EdgeFacts[];
  p2p?: P2PFacts[];
  zones?: DnsZone[];
  records?: DnsRecord[];
}

/** the whole picture, as the read modules hand it around. */
export interface Inventory {
  hosts: HostView[];
  networks: NetworkFacts[];
  edges: EdgeFacts[];
  p2p: P2PFacts[];
  zones: DnsZone[];
  records: DnsRecord[];
}
