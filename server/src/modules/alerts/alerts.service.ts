// ---------------------------------------------------------------------------
// alerts module — turning samples into statements
//
// The evaluation itself is the interesting part and is left open on purpose:
// how strict, how long, what counts as recovered — that is a product decision,
// not plumbing.
//
// The shape to aim for: `evaluate()` is called from the health ingest with the
// samples that just arrived (never on a timer over the whole history), decides
// per rule whether the condition holds long enough, and raises or resolves.
// ---------------------------------------------------------------------------

import type { Logger } from '../../core/logger.ts';
import { notImplemented } from '../../core/errors.ts';
import type { Store } from '../../store/index.ts';
import type {
  Alert, AlertId, AlertRule, HealthReport, HostId,
} from '../../domain/index.ts';

const WHERE = 'server/src/modules/alerts/alerts.service.ts';

export interface AlertsService {
  listOpen(): Promise<Alert[]>;
  listForHost(hostId: HostId): Promise<Alert[]>;
  listRules(): Promise<AlertRule[]>;
  acknowledge(id: AlertId): Promise<void>;
  /** called by the health ingest with the samples that just arrived. */
  evaluate(report: HealthReport): Promise<void>;
}

export function createAlertsService(store: Store, log: Logger): AlertsService {
  return {
    // empty is a valid answer while nothing evaluates: the ui shows "no alerts"
    listOpen: () => store.alerts.listOpen(),
    listForHost: (hostId) => store.alerts.listForHost(hostId),
    listRules: () => store.alerts.listRules(),

    /** TODO(implement): mark an alert as seen (`store.alerts.acknowledge`). */
    acknowledge: async (id) => {
      log.debug('acknowledge requested', { alertId: id });
      throw notImplemented('acknowledging alerts', `${WHERE} → acknowledge`);
    },

    /**
     * TODO(implement): evaluate the rules against fresh samples.
     *
     *   1. `store.alerts.listRules()` (cache them — this runs per report)
     *   2. for each enabled rule whose `hosts` include this host, find the
     *      matching sample in `report.samples`
     *   3. compare with `threshold` using `comparator`
     *   4. hold the condition for `forSeconds` before firing: either keep a
     *      "pending since" per (rule, host) in memory, or ask the store for the
     *      window and require every sample in it to breach. In-memory is cheaper
     *      and loses state on restart — acceptable for a warning, less so for
     *      pager-worthy alerts
     *   5. `store.alerts.raise(...)` when it fires — idempotent per
     *      (ruleId, hostId, node), so re-firing only updates `observed`
     *   6. `store.alerts.resolve(...)` when the condition clears. Consider a
     *      small hysteresis (resolve at threshold − 5) so an alert does not
     *      flap around the limit
     *
     * Two alerts do not come from rules at all and are worth handling here as
     * well: "host unreachable" (no report within the heartbeat window — needs a
     * timer, not a sample) and "agent stale".
     */
    evaluate: async (report) => {
      log.debug('alert evaluation skipped (not implemented)', { hostId: report.hostId });
      throw notImplemented('alert evaluation', `${WHERE} → evaluate`);
    },
  };
}
