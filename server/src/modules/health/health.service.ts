// ---------------------------------------------------------------------------
// health module — where the agents' measurements arrive
//
// This is the hot path: every agent posts here every few seconds, so whatever
// gets implemented behind `ingest()` has to be cheap and must never block on the
// slow parts (alert evaluation, notifications). The suggested shape is
//
//   validate → normalise → append (fast) → hand off (async)
//
// Nothing here is implemented yet on purpose — the storage decision (in-memory
// ring buffer, sqlite, timescale) belongs to whoever writes it, and it drives
// what `series()` can do.
// ---------------------------------------------------------------------------

import { notImplemented } from '../../core/errors.ts';
import type { Logger } from '../../core/logger.ts';
import type { Store } from '../../store/index.ts';
import type {
  AgentEvent, AgentPrincipal, HealthReport, HostHealth, HostId, IngestAck,
  MetricSeries, SeriesInfo, SeriesQuery,
} from '../../domain/index.ts';

const WHERE = 'server/src/modules/health/health.service.ts';

export interface HealthService {
  /** agent → server: a batch of samples. */
  ingest(principal: AgentPrincipal, report: HealthReport): Promise<IngestAck>;
  /** agent → server: discrete events. */
  ingestEvents(principal: AgentPrincipal, events: AgentEvent[]): Promise<IngestAck>;
  /** ui → server: the latest snapshot of one host. */
  latest(hostId: HostId): Promise<HostHealth | null>;
  /** ui → server: a window of samples, for charts. */
  series(query: SeriesQuery): Promise<MetricSeries[]>;
  /** ui → server: what is measurable at all — the metric picker reads this. */
  catalogue(hostId?: HostId): Promise<SeriesInfo[]>;
  /** housekeeping: drop samples older than the retention window. */
  prune(): Promise<number>;
}

export function createHealthService(store: Store, log: Logger): HealthService {
  return {
    /**
     * TODO(implement): accept a health report.
     *
     * The route has authenticated the agent (`requireAgent`) and refused any
     * payload naming a different host (`requireOwnHost`). Still, write
     * `principal.hostId` — never `report.hostId` — into the store: the
     * principal comes from the agent row, the report comes from the network,
     * and only one of those two is allowed to decide whose samples these are.
     *
     * What is left, in order:
     *
     *   1. validate (`health.schema.ts`): every sample needs a finite value and
     *      a parseable timestamp; refuse the whole report on the first bad
     *      sample rather than storing half of it
     *   2. drop stale pushes: if `report.seq` is not greater than the last seq
     *      seen for this agent, answer 200 with `accepted: 0` — retries are
     *      normal and must stay harmless (idempotency)
     *   3. clamp timestamps: a host with a wrong clock must not write into the
     *      future; clamp to `now` and count it
     *   4. `store.health.append(report)` — the only step that must be fast
     *   5. `store.agents.touch(principal.agentId, now)` so the agent counts as
     *      online
     *   6. hand the samples to the alert evaluation, *without awaiting* it:
     *      the ack must not wait for rule evaluation or notifications
     *   7. answer with an `IngestAck` — it is how the server steers the agent
     *      (`nextIntervalSeconds`, `wantInventory` after a restart with an empty
     *      store)
     */
    ingest: async (principal, report) => {
      log.debug('health report received', {
        agentId: principal.agentId,
        hostId: report.hostId,
        samples: report.samples?.length ?? 0,
      });
      throw notImplemented('health ingest', `${WHERE} → ingest`);
    },

    /**
     * TODO(implement): accept events.
     *
     * Same rules as `ingest`, minus the sequence handling: events are not
     * idempotent by nature, so deduplicate on (hostId, at, kind, subject) if the
     * agent may retry. `principal.hostId` decides the host here too — stamp it
     * onto every event rather than trusting what the event carries.
     */
    ingestEvents: async (principal, events) => {
      log.debug('events received', { agentId: principal.agentId, count: events.length });
      throw notImplemented('event ingest', `${WHERE} → ingestEvents`);
    },

    latest: (hostId) => store.health.latest(hostId),

    /**
     * TODO(implement): decide the downsampling.
     *
     * The store does the work, but this is where the policy belongs: cap the
     * number of returned points (a chart needs ~200, not 20 000), pick the
     * bucket size from `to - from` when the caller did not, and default the
     * window to the last hour.
     */
    series: (query) => store.health.series(query),

    catalogue: (hostId) => store.health.listSeries(hostId),

    /**
     * TODO(implement): retention.
     *
     * Call from a timer in `index.ts` (once an hour is plenty) and log what was
     * dropped. `config.health.retentionDays` is the knob.
     */
    prune: async () => {
      throw notImplemented('retention', `${WHERE} → prune`);
    },
  };
}
