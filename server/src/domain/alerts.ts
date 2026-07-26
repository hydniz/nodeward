// ---------------------------------------------------------------------------
// alerts: the conclusions drawn from health data
//
// Kept separate from health on purpose: samples are facts and are never
// changed, an alert is an opinion with a lifecycle (fires, is acknowledged,
// resolves). The rule evaluation itself is the interesting part and is left to
// `modules/alerts/alerts.service.ts`.
// ---------------------------------------------------------------------------

import type {
  AlertId, HostId, Seconds, Status, Timestamp,
} from './common.ts';
import type { MetricName } from './health.ts';

export type AlertLevel = 'warning' | 'down' | 'info';

export interface Alert {
  id: AlertId;
  level: AlertLevel;
  /** what it is about; a host is always known, a service only sometimes. */
  hostId: HostId;
  node?: string;
  /** one line for the ui: `disk 87% · threshold 85%`. */
  text: string;
  /** which rule produced it; null for alerts raised by the ingest itself
   *  (`host unreachable`). */
  ruleId: string | null;
  since: Timestamp;
  /** set once the condition cleared; kept for the history. */
  resolvedAt: Timestamp | null;
  acknowledgedAt: Timestamp | null;
  /** the value that tripped the rule, for the detail view. */
  observed?: { metric: MetricName; value: number; threshold: number };
}

export type Comparator = 'gt' | 'gte' | 'lt' | 'lte';

/**
 * A threshold rule. Deliberately boring: one metric, one comparator, one
 * duration. Anything cleverer (rate of change, prediction) should become its
 * own rule kind rather than growing this shape.
 */
export interface AlertRule {
  id: string;
  /** shown in the alert text and in the settings page. */
  name: string;
  metric: MetricName;
  comparator: Comparator;
  threshold: number;
  /** the condition must hold this long before the alert fires. */
  forSeconds: Seconds;
  level: AlertLevel;
  enabled: boolean;
  /** limit the rule to some hosts; empty means all of them. */
  hosts?: HostId[];
}

/** what the summary endpoint needs — the ui shows counts, not the list. */
export interface AlertCounts {
  warning: number;
  down: number;
  info: number;
}

/** the fleet-wide numbers behind `/api/summary`. */
export interface FleetSummary {
  hosts: number;
  nodes: number;
  up: number;
  warning: number;
  down: number;
  avgCpu: number;
  avgRam: number;
  /** the open alerts, newest first, as the sidebar badge and alerts page use. */
  alerts: { id: number | string; level: AlertLevel | Status; server: string; text: string }[];
  mesh: string;
}
