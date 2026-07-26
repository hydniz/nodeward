// ---------------------------------------------------------------------------
// summary module — the numbers the sidebar and the fleet tiles show
//
// Small on purpose: it counts what the other stores already hold. It is also
// the one place that decides what "healthy" means for the whole fleet, which is
// why the alert list is folded in here rather than fetched separately by the ui.
// ---------------------------------------------------------------------------

import type { Logger } from '../../core/logger.ts';
import type { Store } from '../../store/index.ts';
import type { FleetSummary } from '../../domain/index.ts';
import { demoSummary } from '../../fixtures/demo.ts';
import type { InventoryService } from '../inventory/inventory.service.ts';

export interface SummaryService {
  get(): Promise<FleetSummary>;
}

export function createSummaryService(
  store: Store,
  inventory: InventoryService,
  log: Logger,
): SummaryService {
  return {
    get: async () => {
      const hosts = await inventory.listHosts();

      // while the fixture is in charge, its own summary is the honest answer:
      // it carries the demo alert list, which no store holds yet.
      if (store.demoData) return demoSummary();

      const alive = hosts.filter((h) => h.cpu != null);
      const avg = (pick: (h: typeof hosts[number]) => number | null) => (alive.length
        ? Math.round(alive.reduce((n, h) => n + (pick(h) ?? 0), 0) / alive.length)
        : 0);

      /**
       * TODO(implement): fold in the alerts.
       *
       * `store.alerts.listOpen()` once the alert module evaluates rules — until
       * then the list stays empty, which the ui renders as "no alerts".
       */
      const open = await store.alerts.listOpen().catch((e: unknown) => {
        log.debug('alerts unavailable for summary', { error: String(e) });
        return [];
      });

      return {
        hosts: hosts.length,
        nodes: hosts.reduce((n, h) => n + h.nodes.length, 0),
        up: hosts.filter((h) => h.status === 'up').length,
        warning: hosts.filter((h) => h.status === 'warning').length,
        down: hosts.filter((h) => h.status === 'down').length,
        avgCpu: avg((h) => h.cpu),
        avgRam: avg((h) => h.ram),
        alerts: open.map((a) => ({
          id: a.id,
          level: a.level,
          server: hosts.find((h) => h.id === a.hostId)?.name ?? a.hostId,
          text: a.text,
        })),
        mesh: 'full mesh',
      };
    },
  };
}
