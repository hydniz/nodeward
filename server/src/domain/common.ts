// ---------------------------------------------------------------------------
// shared primitives of the domain model
//
// Ids are branded strings: `HostId` and `AgentId` are both strings at runtime,
// but the compiler refuses to swap them. Cast at the edges (parsing a request,
// reading a fixture) with the `asHostId(...)` style helpers, never inside the
// modules.
// ---------------------------------------------------------------------------

/** iso-8601 with timezone, e.g. `2026-07-26T09:12:03.114Z`. */
export type Timestamp = string;

/** seconds; used wherever an interval or age is expressed. */
export type Seconds = number;

type Brand<T, B extends string> = T & { readonly __brand: B };

export type HostId = Brand<string, 'HostId'>;
export type ServiceId = Brand<string, 'ServiceId'>;
export type NetworkId = Brand<string, 'NetworkId'>;
export type InterfaceId = Brand<string, 'InterfaceId'>;
export type ZoneId = Brand<string, 'ZoneId'>;
export type RecordId = Brand<string, 'RecordId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type AlertId = Brand<string, 'AlertId'>;

export const asHostId = (v: string): HostId => v as HostId;
export const asServiceId = (v: string): ServiceId => v as ServiceId;
export const asNetworkId = (v: string): NetworkId => v as NetworkId;
export const asInterfaceId = (v: string): InterfaceId => v as InterfaceId;
export const asZoneId = (v: string): ZoneId => v as ZoneId;
export const asRecordId = (v: string): RecordId => v as RecordId;
export const asAgentId = (v: string): AgentId => v as AgentId;
export const asAlertId = (v: string): AlertId => v as AlertId;

/**
 * A service is only unique together with its host — two hosts may both run a
 * node called `dns`. The frontend uses the same `host.node` form in its urls
 * (`/services?service=ug1.dns`), so keep the two in sync.
 */
export const serviceKey = (host: HostId, node: string): ServiceId => `${host}.${node}` as ServiceId;

export const parseServiceKey = (
  key: string,
): { hostId: HostId; nodeId: string } | null => {
  const dot = key.indexOf('.');
  if (dot <= 0 || dot === key.length - 1) return null;
  return { hostId: asHostId(key.slice(0, dot)), nodeId: key.slice(dot + 1) };
};

/** three-state health, used for hosts, services and links alike. */
export type Status = 'up' | 'warning' | 'down';

/** where a value came from — shown in the ui so demo data is never mistaken
 *  for the real thing. */
export type DataSource = 'fixture' | 'agent';

export interface Paged<T> {
  items: T[];
  /** total before paging; `null` while a store cannot count cheaply. */
  total: number | null;
}
