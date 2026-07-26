// ---------------------------------------------------------------------------
// health: what changes every few seconds
//
// Agents push samples, the server keeps them, the ui reads two shapes of them:
// the *latest* value per host (badges, tiles, graph colours) and a *series*
// over a window (sparklines, charts). Both are declared here so the ingest and
// the query side cannot drift apart.
// ---------------------------------------------------------------------------

import type {
  AgentId, HostId, InterfaceId, Seconds, Status, Timestamp,
} from './common.ts';

/**
 * Metric names are open on purpose — an agent may report anything, and the ui
 * only special-cases the ones it draws. Keep the well-known ones spelled the
 * same everywhere, they are used as object keys in the api.
 */
export type KnownMetric =
  | 'cpu' // percent, 0..100
  | 'ram' // percent
  | 'disk' // percent, fullest mounted filesystem
  | 'load1' // absolute
  | 'temp' // °C
  | 'rx' // MB/s
  | 'tx' // MB/s
  | 'uptime'; // seconds

export type MetricName = KnownMetric | (string & {});

/** what a sample is about: the host itself, one service, one interface. */
export type MetricTarget =
  | { kind: 'host' }
  | { kind: 'service'; node: string }
  | { kind: 'interface'; iface: InterfaceId };

export interface MetricSample {
  name: MetricName;
  value: number;
  /** `%`, `MB/s`, `°C`, `s`; free text, only for display. */
  unit?: string;
  at: Timestamp;
  /** defaults to `{ kind: 'host' }` when absent. */
  target?: MetricTarget;
}

/**
 * One push from one agent, posted to `POST /api/agents/:agentId/health`.
 * Small on purpose: a handful of samples every interval, no history — the
 * server is the archive, the agent is not.
 */
export interface HealthReport {
  hostId: HostId;
  collectedAt: Timestamp;
  /** the agent's own view of the host; the server may override it. */
  status?: Status;
  /** why it thinks the host is not `up`. */
  warn?: string;
  /** collection interval, so the server can spot a missing report. */
  intervalSeconds?: Seconds;
  samples: MetricSample[];
  /** monotonic per agent; lets the server drop out-of-order pushes. */
  seq?: number;
}

/** the latest values, folded into one object per host. */
export interface HostHealth {
  hostId: HostId;
  status: Status;
  warn?: string;
  /** null when the value has never been reported. */
  cpu: number | null;
  ram: number | null;
  disk: number | null;
  uptimeSeconds: number | null;
  /** when this snapshot was collected on the host. */
  at: Timestamp | null;
  /** when the server last heard anything from the agent. */
  lastSeenAt: Timestamp | null;
}

/** a window of one metric, ready to be drawn. */
export interface MetricSeries {
  hostId: HostId;
  name: MetricName;
  target: MetricTarget;
  unit?: string;
  points: { at: Timestamp; value: number }[];
}

/**
 * One row of the catalogue: something that is being measured.
 *
 * This is what makes the data browsable — in nodeward's own explore page, in
 * grafana's template variables, or in a `select * from metric_series` by hand.
 * See `server/docs/explore.md`.
 */
export interface SeriesInfo {
  hostId: HostId;
  target: MetricTarget;
  name: MetricName;
  unit?: string;
  /** since when this metric exists; a series that stopped keeps its last date. */
  firstSeenAt: Timestamp;
  lastSeenAt: Timestamp;
  /** stored points, when the store can count them cheaply. */
  points?: number;
}

export interface SeriesQuery {
  hostId: HostId;
  names?: MetricName[];
  target?: MetricTarget;
  /** inclusive start / exclusive end; default: the last hour. */
  from?: Timestamp;
  to?: Timestamp;
  /** bucket size for downsampling; the store decides how to aggregate. */
  stepSeconds?: Seconds;
}

/** a discrete thing that happened, posted to `…/events`. */
export interface AgentEvent {
  hostId: HostId;
  at: Timestamp;
  kind:
    | 'service.started'
    | 'service.stopped'
    | 'service.failed'
    | 'interface.up'
    | 'interface.down'
    | 'host.boot'
    | (string & {});
  /** what the event is about. */
  subject?: { node?: string; iface?: InterfaceId };
  message?: string;
  /** anything the agent wants to carry along; never interpreted blindly. */
  data?: Record<string, unknown>;
}

/** what the ingest returns, so an agent can adapt without another round trip. */
export interface IngestAck {
  accepted: number;
  rejected: number;
  /** echo of the report the ack belongs to. */
  seq?: number;
  /** the server may ask for a different cadence than the agent uses. */
  nextIntervalSeconds?: Seconds;
  /** set when the agent should re-post its inventory (server lost state). */
  wantInventory?: boolean;
  agentId: AgentId;
  receivedAt: Timestamp;
}
