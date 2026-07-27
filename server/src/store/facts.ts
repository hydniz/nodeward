// ---------------------------------------------------------------------------
// snapshot semantics helpers, shared by every driver
//
// `replaceHost` must mean the same thing whether the store is a Map or a
// database — a host reporting through a sqlite deployment must not get
// different merge behaviour than the same host against the memory driver.
// The two building blocks that define that meaning live here.
// ---------------------------------------------------------------------------

import type { HostFacts, HostView } from '../domain/index.ts';

/**
 * Merge a shared collection (networks, zones) by id.
 *
 * How it works: existing entries keep their position, incoming entries are
 * folded over them — an entry with a known id is merged field-wise
 * (`{ ...old, ...incoming }`, so the last writer wins per field but optional
 * fields nobody re-reported survive), an unknown id is appended. Nothing is
 * ever deleted here: a network is shared between hosts, and one host going
 * quiet about it must not tear it out from under the others.
 */
export function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const merged = new Map<string, T>(existing.map((e) => [e.id, e]));
  for (const item of incoming) {
    const prev = merged.get(item.id);
    merged.set(item.id, prev ? { ...prev, ...item } : item);
  }
  return [...merged.values()];
}

/**
 * Who currently holds a record id: the owning host, `null` when the id holds
 * shared zone data (a record with no `server`), `undefined` when the id is
 * free.
 */
export type RecordHolder = string | null | undefined;

/** A record that was refused because its id already belongs to somebody else. */
export interface RejectedRecord {
  id: string;
  /** the host holding the id, or `null` when it is shared zone data. */
  heldBy: string | null;
}

/**
 * The record ownership rule — who may write which record id.
 *
 * Records are the one collection whose id namespace is global (a name exists
 * once), while every other collection is either owned outright or shared.
 * Without this rule an agent could post a record carrying *another* host's
 * record id and the store would happily hand the id over: `server` flips to the
 * reporting host and the stored fqdn/value/tls/state become whatever the report
 * said. One compromised machine could then re-point any name in the graph.
 *
 * The rule, applied per incoming record:
 *
 *   • the id is free → claim it
 *   • the id holds shared zone data and the incoming record is shared too →
 *     merge it (field-wise, `mergeById`), which is what shared data is for
 *   • anything else → reject. That covers claiming an id another host owns,
 *     and converting shared zone data into a record terminating on yourself —
 *     both are "re-pointing a name at (or away from) another host".
 *
 * **Precondition**: callers must already have removed the reporting host's own
 * records (that is what makes a snapshot a snapshot), so any surviving holder
 * is by definition somebody else. Both drivers do that first.
 *
 * Rejected records are dropped, not fatal — same call as dropping edges into
 * unknown networks: one bad entry must not cost the operator the whole host's
 * inventory, and a genuine migration heals itself as soon as the previous
 * owner's next snapshot stops claiming the name. The caller logs what fell out.
 */
export function splitRecordClaims<T extends { id: string; server?: string }>(
  incoming: readonly T[],
  holderOf: (id: string) => RecordHolder,
): { accepted: T[]; rejected: RejectedRecord[] } {
  const accepted: T[] = [];
  const rejected: RejectedRecord[] = [];
  for (const record of incoming) {
    const holder = holderOf(record.id);
    if (holder === undefined || (holder === null && record.server === undefined)) {
      accepted.push(record);
    } else {
      rejected.push({ id: record.id, heldBy: holder });
    }
  }
  return { accepted, rejected };
}

/**
 * Turn reported facts into the `HostView` the store keeps.
 *
 * A report carries facts only — measurements belong to the health store. The
 * view fields therefore start neutral: the host counts as `up` (it just
 * talked to us via its agent), with no cpu/ram/disk numbers and no uptime.
 * As soon as the health ingest exists, `inventory.service.withHealth` folds
 * real measurements over these defaults on every read.
 */
export function freshHostView(host: HostFacts): HostView {
  return {
    ...host,
    status: 'up',
    uptime: null,
    uptimeDays: 0,
    cpu: null,
    ram: null,
    disk: null,
  };
}
