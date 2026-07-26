// ---------------------------------------------------------------------------
// the demo inventory, typed
//
// `demo.data.js` is the hand-written dataset the prototype was built from. It
// predates the domain types, so this file is the *one* place where it is cast
// into them — if a field ever disagrees with `domain/inventory.ts`, it shows up
// here and nowhere else.
//
// The fixture is what makes the ui work before a single agent exists. It is
// loaded only when `config.store.demoData` is on, and every response derived
// from it is marked `source: 'fixture'` (see `/api/meta`), so demo numbers can
// never be mistaken for measurements.
// ---------------------------------------------------------------------------

import * as raw from './demo.data.js';
import type {
  DnsRecord, DnsZone, EdgeFacts, FleetSummary, HostView, Inventory,
  NetworkFacts, P2PFacts,
} from '../domain/index.ts';

/** the fixture, as the store expects it. */
export function demoInventory(): Inventory {
  return {
    hosts: raw.servers as unknown as HostView[],
    networks: raw.networks as unknown as NetworkFacts[],
    edges: raw.edges as unknown as EdgeFacts[],
    p2p: raw.p2p as unknown as P2PFacts[],
    zones: raw.zones as unknown as DnsZone[],
    records: raw.records as unknown as DnsRecord[],
  };
}

/**
 * The fixture's own summary function.
 *
 * Kept for the prototype only — the real one is
 * `modules/summary/summary.service.ts`, which counts what the store holds and
 * folds in the open alerts.
 */
export function demoSummary(): FleetSummary {
  return raw.summary() as unknown as FleetSummary;
}
