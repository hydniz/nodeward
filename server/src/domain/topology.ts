// ---------------------------------------------------------------------------
// topology: the finished graph
//
// The layout engine (`shared/autoLayout.js`, rules in LAYOUT.md) turns the
// inventory facts into geometry — every endpoint, bend and label box — and the
// api ships that, so two browsers can never draw a different picture (R0).
//
// These types describe that payload. They are the api contract for
// `GET /api/topology`; the renderer in `client/src/graph` consumes exactly this.
// ---------------------------------------------------------------------------

import type { HostId, NetworkId, Timestamp } from './common.ts';
import type {
  EdgeFacts, HostView, NetworkFacts, P2PFacts,
} from './inventory.ts';

/** world coordinates, `[x, y]`. */
export type Point = [number, number];

export interface World {
  w: number;
  h: number;
}

/** a network cloud with its computed box. */
export interface LaidNetwork extends NetworkFacts {
  x: number;
  y: number;
  w: number;
  h: number;
  /** stable hash of the id; the cloud outline is seeded from it (R0). */
  seed: number;
}

/** the chip grid inside a host box, already placed (R4/R8). */
export interface LaidChip {
  id: string;
  label: string;
  kind: string;
  nodes: string[];
  ring?: string;
  cx: number;
  cy: number;
  r: number;
}

export interface LaidHost extends Omit<HostView, 'chips'> {
  x: number;
  y: number;
  w: number;
  h: number;
  chips: LaidChip[];
  /** which side of the box the service zone sits on, and its grid (R8). */
  zone: { side: 'top' | 'bottom'; rows: number; cols: number };
  /** top of the protected header band — name and address are drawn from here. */
  headerY: number;
}

export interface LaidEdge extends EdgeFacts {
  from?: Point;
  to?: Point;
  /** perpendicular bow in px; 0 for a straight line (R6). */
  bend?: number;
  /** explicit quadratic control point, used by stubs and sideways exits. */
  ctrl?: Point;
  /** `link` = own line to the cloud, `stub` = short hop into a trunk (R9). */
  kind?: 'link' | 'stub';
  /** the trunk this edge was bundled into. */
  bundle?: string;
  exitSide?: 'top' | 'bottom' | 'left' | 'right';
  anchor?: { side: 'top' | 'bottom' | 'left' | 'right'; at: number };
}

/** the single line that carries several links of one host into one network. */
export interface LaidBundle {
  id: string;
  server: HostId;
  net: NetworkId;
  color: string;
  side: 'top' | 'bottom' | 'left' | 'right';
  from: Point;
  to?: Point;
  bend?: number;
  members: string[];
  traffic: number;
  down: boolean;
}

export interface LaidP2P extends P2PFacts {
  from?: Point;
  to?: Point;
  bend?: number;
}

/** the little square where a host-level link leaves the box. */
export interface LaidPort {
  key: string;
  server: HostId;
  iface: string;
  at: Point;
  color?: string;
  down: boolean;
  edgeId: string;
}

/** one row of a label box; a bundle label has several (R7/R9). */
export interface LabelRow {
  text: string;
  /** which service owns this address, shown in front of it. */
  tag: string | null;
  color: string;
  down: boolean;
  edgeId: string;
  click: { kind: 'iface'; serverId: HostId; ifaceId: string } | { kind: 'p2p'; linkId: string };
}

export interface LaidLabel {
  id: string;
  rows: LabelRow[];
  /** width of the tag column, so the renderer can align the ips. */
  tagW: number;
  w: number;
  h: number;
  side: 'top' | 'bottom' | 'left' | 'right';
  /** the point the label belongs to; panels are anchored here. */
  anchor: Point;
  x: number;
  y: number;
  edgeIds: string[];
}

/**
 * The geometry of one host box, without the host's own fields.
 *
 * `/api/servers` ships facts + health + this, because the graph draws its boxes
 * from the same response the tables use — and the layout is computed on the
 * server (R0), so the client must not have to guess any of it.
 */
export type HostBox = Pick<LaidHost, 'x' | 'y' | 'w' | 'h' | 'chips' | 'zone' | 'headerY'>;

/**
 * What `/api/servers` returns per host: with its box while a layout exists,
 * plain facts + health while it does not (a host nobody laid out yet still has
 * to show up in the table).
 */
export type HostApiView = LaidHost | HostView;

/** what the layout engine takes in. */
export interface LayoutInput {
  networks: NetworkFacts[];
  servers: HostView[];
  edges: EdgeFacts[];
  p2p?: P2PFacts[];
}

/** what it returns. */
export interface LayoutResult {
  world: World;
  networks: LaidNetwork[];
  servers: LaidHost[];
  edges: LaidEdge[];
  bundles: LaidBundle[];
  p2p: LaidP2P[];
  ports: LaidPort[];
  labels: LaidLabel[];
}

/** `GET /api/topology` — the layout plus when it was computed. */
export interface TopologyPayload extends Omit<LayoutResult, 'servers'> {
  updated: number;
  /** iso form of `updated`, easier to read in logs and clients. */
  computedAt: Timestamp;
}
