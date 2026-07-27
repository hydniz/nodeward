// ---------------------------------------------------------------------------
// validation of what agents post to the inventory ingest
//
// An agent is not a trusted client: a malformed or malicious report must be
// refused at this seam, before it can corrupt the graph or smuggle data into
// another host's picture.
//
// Strategy: every object the api accepts is REBUILT field by field from the
// raw body (allowlist). Unknown fields are dropped, every accepted field is
// type- and length-checked, every id must be canonical, and every reference
// inside the report (edge → interface, chip → service, …) must resolve.
// What leaves this file is a fully constructed `InventoryReport` — trustworthy
// by construction, not by cast.
//
// Cross-host references are the security-relevant part and are pinned here:
// edges, p2p anchors and dns records may only claim the reporting host. The
// route additionally compares `hostId` against the authenticated principal.
// ---------------------------------------------------------------------------

import { badRequest } from '../../core/errors.ts';
import { expectObject } from '../../core/http.ts';
import type { Validator } from '../../core/http.ts';
import {
  asHostId, asInterfaceId, asNetworkId, asRecordId, asZoneId,
} from '../../domain/common.ts';
import type {
  DetailRow, DnsRecord, DnsZone, EdgeFacts, HostFacts, InterfaceAddress,
  InterfaceFacts, InventoryReport, NetBadge, NetworkFacts, NetworkRole,
  P2PFacts, RecordType, ServiceChip, ServiceFacts, ZoneKind,
} from '../../domain/index.ts';

type Obj = Record<string, unknown>;

/** hard caps, so a hostile payload cannot bloat memory or the ui. The body
 *  size itself is already capped by `INGEST_MAX_BODY` before parsing. */
const MAX_STRING = 500;
const MAX_ITEMS = 1000;

/**
 * Canonical id: lowercase, starts alphanumeric, may contain `. _ -`, ≤ 100
 * chars. Host ids are stricter (no dot, see HOST_ID): `serviceKey()` joins
 * host and node as `<host>.<node>` and `parseServiceKey()` splits at the FIRST
 * dot — a dotted host id would silently break every service url.
 */
const ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const HOST_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** css hex colors only — network/zone colors end up in svg attributes. */
const COLOR = /^#[0-9a-fA-F]{3,8}$/;

/** how far in the future `collectedAt` may lie before it counts as bogus —
 *  covers honest clock skew, refuses time-travel. */
const MAX_SKEW_MS = 5 * 60 * 1000;

const ROLES: readonly NetworkRole[] = ['provider', 'mesh', 'overlay', 'lan', 'p2p'];
const RECORD_TYPES: readonly RecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'magicdns'];
const ZONE_KINDS: readonly ZoneKind[] = ['public', 'magicdns', 'internal'];
const TONES: readonly NonNullable<DetailRow['tone']>[] = ['dim', 'accent', 'warn', 'down'];

// ---- primitives -----------------------------------------------------------

/**
 * The one way this file refuses input: throws a 400 `ApiError` whose message
 * names the offending path (`edges[3].iface`) and what was wrong with it, so
 * an agent developer can fix their payload without reading server code.
 */
function fail(path: string, why: string): never {
  throw badRequest(`inventory report: ${path} ${why}`);
}

/**
 * True when the string carries ascii control characters (below 0x20, or DEL).
 * They have no business in names or notes and are the raw material of
 * log/terminal escape tricks, so `reqStr` refuses them everywhere.
 */
function hasControlChars(v: string): boolean {
  for (let i = 0; i < v.length; i += 1) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * Asserts `value` is a plain json object (not null, not an array) and returns
 * it as an indexable record. Every nested builder starts with this.
 */
function asObj(value: unknown, path: string): Obj {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'must be a json object');
  }
  return value as Obj;
}

/**
 * Asserts `value` is an array of at most `MAX_ITEMS` entries. The cap is a
 * denial-of-service guard: without it one report could carry a million fake
 * services into every render loop.
 */
function asArr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  if (value.length > MAX_ITEMS) fail(path, `must not exceed ${MAX_ITEMS} items`);
  return value;
}

/**
 * Reads an optional array field: missing means "empty", anything present must
 * be an array. Normalising to `[]` here lets the store skip null-checks.
 */
function optArr(o: Obj, key: string, path: string): unknown[] {
  return o[key] === undefined ? [] : asArr(o[key], `${path}.${key}`);
}

/**
 * Reads a required string field: non-empty, at most `max` chars, and free of
 * control characters.
 */
function reqStr(o: Obj, key: string, path: string, max = MAX_STRING): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) fail(`${path}.${key}`, 'must be a non-empty string');
  if (v.length > max) fail(`${path}.${key}`, `must be at most ${max} characters`);
  if (hasControlChars(v)) fail(`${path}.${key}`, 'must not contain control characters');
  return v;
}

/** Like `reqStr`, but the field may be absent — never present-and-wrong. */
function optStr(o: Obj, key: string, path: string, max = MAX_STRING): string | undefined {
  return o[key] === undefined ? undefined : reqStr(o, key, path, max);
}

/**
 * Reads a string-or-null field (`mgmtVia`): absent and `null` both mean null,
 * a present string is checked like any other. Nothing else passes.
 */
function strOrNull(o: Obj, key: string, path: string): string | null {
  if (o[key] === undefined || o[key] === null) return null;
  return reqStr(o, key, path);
}

/**
 * Reads an optional non-negative finite number (traffic, rx/tx). `NaN`,
 * `Infinity` and negatives are refused — they would poison every sum and
 * animation speed derived from them.
 */
function optNum(o: Obj, key: string, path: string): number | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    fail(`${path}.${key}`, 'must be a non-negative finite number');
  }
  return v;
}

/** Reads an optional boolean; anything but `true`/`false`/absent is refused. */
function optBool(o: Obj, key: string, path: string): boolean | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') fail(`${path}.${key}`, 'must be a boolean');
  return v;
}

/** Reads a required boolean (`dnssec`). */
function reqBool(o: Obj, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') fail(`${path}.${key}`, 'must be a boolean');
  return v;
}

/**
 * Reads a required string that must be one of the allowed literals (network
 * role, record type, …). The message lists the choices, because "invalid role"
 * alone sends people into the source.
 */
function oneOf<T extends string>(o: Obj, key: string, path: string, allowed: readonly T[]): T {
  const v = reqStr(o, key, path);
  if (!allowed.includes(v as T)) fail(`${path}.${key}`, `must be one of: ${allowed.join(', ')}`);
  return v as T;
}

/** Like `oneOf`, but the field may be absent. */
function optOneOf<T extends string>(
  o: Obj, key: string, path: string, allowed: readonly T[],
): T | undefined {
  return o[key] === undefined ? undefined : oneOf(o, key, path, allowed);
}

/** Reads a required canonical id (see `ID` above). */
function reqId(o: Obj, key: string, path: string): string {
  const v = reqStr(o, key, path);
  if (!ID.test(v)) fail(`${path}.${key}`, 'must be a canonical id (lowercase, alphanumeric plus . _ -)');
  return v;
}

/** Reads a required host id — like `reqId` but with the no-dot rule. */
function reqHostId(o: Obj, key: string, path: string): string {
  const v = reqStr(o, key, path);
  if (!HOST_ID.test(v)) fail(`${path}.${key}`, 'must be a canonical host id (lowercase, alphanumeric plus _ -, no dot)');
  return v;
}

/** Reads a required hex color (`#0af`, `#8bd5a0`, …). */
function reqColor(o: Obj, key: string, path: string): string {
  const v = reqStr(o, key, path);
  if (!COLOR.test(v)) fail(`${path}.${key}`, 'must be a hex color like #8bd5a0');
  return v;
}

/**
 * Reads an optional reference to something declared elsewhere in the report
 * (a service node id, an interface id). Present ⇒ must resolve — a dangling
 * reference draws a broken graph, so it is refused rather than repaired.
 */
function optRef(o: Obj, key: string, path: string, known: ReadonlySet<string>, what: string): string | undefined {
  const v = optStr(o, key, path);
  if (v !== undefined && !known.has(v)) fail(`${path}.${key}`, `references unknown ${what} '${v}'`);
  return v;
}

/**
 * Reads a required iso-8601 timestamp. It must parse, and it must not lie
 * further than `MAX_SKEW_MS` in the future — a "collected tomorrow" report is
 * either a broken clock or an attempt to keep winning last-writer-wins merges.
 */
function reqTimestamp(o: Obj, key: string, path: string): string {
  const v = reqStr(o, key, path);
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) fail(`${path}.${key}`, 'must be an iso-8601 timestamp');
  if (ms > Date.now() + MAX_SKEW_MS) fail(`${path}.${key}`, 'must not lie in the future');
  return v;
}

/**
 * Refuses duplicate ids within one collection. Duplicates are never a valid
 * snapshot, and letting them through would make "replace by id" ambiguous in
 * the store merge.
 */
function requireUniqueIds(items: { id: string }[], path: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail(path, `contains duplicate id '${item.id}'`);
    seen.add(item.id);
  }
}

// ---- entities -------------------------------------------------------------

/** Builds one `{ ip, tag? }` address of an interface. */
function buildAddress(value: unknown, path: string): InterfaceAddress {
  const o = asObj(value, path);
  return { ip: reqStr(o, 'ip', path, 100), tag: optStr(o, 'tag', path, 50) };
}

/** Builds one labelled key/value line of an interface's detail panel. */
function buildDetailRow(value: unknown, path: string): DetailRow {
  const o = asObj(value, path);
  return {
    l: reqStr(o, 'l', path),
    r: reqStr(o, 'r', path),
    tone: optOneOf(o, 'tone', path, TONES),
  };
}

/**
 * Builds one network interface of the host. `node`, when set, must name a
 * service declared in the same report — that is what attaches the interface
 * (and its links) to a chip instead of the host box. The fixture-only `modal`
 * field is derived data and deliberately not accepted from agents.
 */
function buildInterface(value: unknown, path: string, nodeIds: ReadonlySet<string>): InterfaceFacts {
  const o = asObj(value, path);
  return {
    id: asInterfaceId(reqId(o, 'id', path)),
    title: reqStr(o, 'title', path, 100),
    net: asNetworkId(reqId(o, 'net', path)),
    node: optRef(o, 'node', path, nodeIds, 'service node'),
    ips: asArr(o.ips ?? fail(path, 'is missing ips'), `${path}.ips`)
      .map((v, i) => buildAddress(v, `${path}.ips[${i}]`)),
    ports: optStr(o, 'ports', path),
    rx: optNum(o, 'rx', path),
    tx: optNum(o, 'tx', path),
    sectionTitle: optStr(o, 'sectionTitle', path),
    section: o.section === undefined ? undefined
      : asArr(o.section, `${path}.section`).map((v, i) => buildDetailRow(v, `${path}.section[${i}]`)),
    extra: optStr(o, 'extra', path),
    note: optStr(o, 'note', path),
  };
}

/** Builds one service (container, vm, unit) entry. */
function buildNode(value: unknown, path: string): ServiceFacts {
  const o = asObj(value, path);
  return {
    id: reqId(o, 'id', path),
    label: reqStr(o, 'label', path, 100),
    desc: reqStr(o, 'desc', path),
    res: reqStr(o, 'res', path, 100),
    down: optBool(o, 'down', path),
  };
}

/**
 * Builds one chip (stack). Its `nodes` list must be a subset of the services
 * declared in the report — a chip claiming a service that does not exist would
 * render an empty circle and break the chip lookup in the service projection.
 */
function buildChip(value: unknown, path: string, nodeIds: ReadonlySet<string>): ServiceChip {
  const o = asObj(value, path);
  const nodes = asArr(o.nodes ?? fail(path, 'is missing nodes'), `${path}.nodes`)
    .map((v, i) => {
      if (typeof v !== 'string') fail(`${path}.nodes[${i}]`, 'must be a string');
      if (!nodeIds.has(v)) fail(`${path}.nodes[${i}]`, `references unknown service node '${v}'`);
      return v;
    });
  return {
    id: reqId(o, 'id', path),
    label: reqStr(o, 'label', path, 100),
    kind: reqStr(o, 'kind', path, 100),
    nodes,
    ring: o.ring === undefined ? undefined : reqColor(o, 'ring', path),
  };
}

/** Builds one network badge shown next to the host name. */
function buildBadge(value: unknown, path: string): NetBadge {
  const o = asObj(value, path);
  return {
    net: asNetworkId(reqId(o, 'net', path)),
    label: reqStr(o, 'label', path, 50),
  };
}

/**
 * Builds the host block: identity, management address, and the three
 * collections (services, chips, interfaces). Services are built first because
 * chips and interfaces reference them by id. The host id must equal the
 * report's `hostId` — one report describes exactly one host.
 */
function buildHost(value: unknown, hostId: string): HostFacts {
  const path = 'host';
  const o = asObj(value, path);

  const id = reqHostId(o, 'id', path);
  if (id !== hostId) fail(`${path}.id`, 'must equal hostId');

  const nodes = asArr(o.nodes ?? fail(path, 'is missing nodes'), `${path}.nodes`)
    .map((v, i) => buildNode(v, `${path}.nodes[${i}]`));
  requireUniqueIds(nodes, `${path}.nodes`);
  const nodeIds = new Set(nodes.map((n) => n.id));

  const chips = asArr(o.chips ?? fail(path, 'is missing chips'), `${path}.chips`)
    .map((v, i) => buildChip(v, `${path}.chips[${i}]`, nodeIds));
  requireUniqueIds(chips, `${path}.chips`);

  const interfaces = asArr(o.interfaces ?? fail(path, 'is missing interfaces'), `${path}.interfaces`)
    .map((v, i) => buildInterface(v, `${path}.interfaces[${i}]`, nodeIds));
  requireUniqueIds(interfaces, `${path}.interfaces`);

  const tags = asArr(o.tags ?? fail(path, 'is missing tags'), `${path}.tags`)
    .map((v, i) => {
      if (typeof v !== 'string' || v.length === 0 || v.length > 100) {
        fail(`${path}.tags[${i}]`, 'must be a non-empty string of at most 100 characters');
      }
      return v;
    });

  return {
    id: asHostId(id),
    name: reqStr(o, 'name', path, 100),
    host: reqStr(o, 'host', path, 200),
    mgmt: reqStr(o, 'mgmt', path, 200),
    mgmtIp: reqStr(o, 'mgmtIp', path, 100),
    mgmtVia: strOrNull(o, 'mgmtVia', path),
    tags,
    tag: optStr(o, 'tag', path, 50),
    netBadges: asArr(o.netBadges ?? fail(path, 'is missing netBadges'), `${path}.netBadges`)
      .map((v, i) => buildBadge(v, `${path}.netBadges[${i}]`)),
    chips,
    nodes,
    interfaces,
  };
}

/** Builds one network the host can see. Networks are shared between hosts and
 *  merged by id in the store, so only well-formed ones may enter the merge. */
function buildNetwork(value: unknown, path: string): NetworkFacts {
  const o = asObj(value, path);
  return {
    id: asNetworkId(reqId(o, 'id', path)),
    name: reqStr(o, 'name', path, 100),
    sub: optStr(o, 'sub', path),
    cidr: optStr(o, 'cidr', path, 100),
    color: reqColor(o, 'color', path),
    kind: reqStr(o, 'kind', path, 100),
    role: oneOf(o, 'role', path, ROLES),
    virtual: optBool(o, 'virtual', path),
    note: optStr(o, 'note', path),
  };
}

/**
 * Builds one graph edge. The two security rules: `server` must be the
 * reporting host (nobody draws lines in someone else's name), and `iface`
 * must be an interface this very report declares (no dangling geometry).
 */
function buildEdge(
  value: unknown, path: string, hostId: string,
  ifaceIds: ReadonlySet<string>, nodeIds: ReadonlySet<string>,
): EdgeFacts {
  const o = asObj(value, path);
  const server = reqHostId(o, 'server', path);
  if (server !== hostId) fail(`${path}.server`, 'must be the reporting host');
  const iface = reqId(o, 'iface', path);
  if (!ifaceIds.has(iface)) fail(`${path}.iface`, `references unknown interface '${iface}'`);
  return {
    id: reqId(o, 'id', path),
    server: asHostId(server),
    iface: asInterfaceId(iface),
    net: asNetworkId(reqId(o, 'net', path)),
    label: optStr(o, 'label', path, 100),
    traffic: optNum(o, 'traffic', path),
    state: optOneOf(o, 'state', path, ['down'] as const),
    ring: optBool(o, 'ring', path),
    node: optRef(o, 'node', path, nodeIds, 'service node'),
  };
}

/** Builds one `{ server, iface }` end of a p2p tunnel. */
function buildP2PEnd(value: unknown, path: string): { server: string; iface: string } {
  const o = asObj(value, path);
  return { server: reqHostId(o, 'server', path), iface: reqId(o, 'iface', path) };
}

/**
 * Builds one host ⇄ host tunnel. Ownership rule: the reporting host must be
 * the `a` end — that makes exactly one host responsible for each tunnel entry
 * (the store replaces by `a.server`), so two peers cannot fight over it and a
 * host cannot invent tunnels between two other machines. The `a` interface
 * must exist in this report; the `b` end names the peer and is taken at face
 * value (the peer's own report is the authority on its side).
 */
function buildP2P(
  value: unknown, path: string, hostId: string, ifaceIds: ReadonlySet<string>,
): P2PFacts {
  const o = asObj(value, path);
  const a = buildP2PEnd(o.a ?? fail(path, 'is missing a'), `${path}.a`);
  if (a.server !== hostId) fail(`${path}.a.server`, 'must be the reporting host');
  if (!ifaceIds.has(a.iface)) fail(`${path}.a.iface`, `references unknown interface '${a.iface}'`);
  const b = buildP2PEnd(o.b ?? fail(path, 'is missing b'), `${path}.b`);
  const labels = o.labels === undefined ? undefined
    : asArr(o.labels, `${path}.labels`).map((v, i) => {
      const lo = asObj(v, `${path}.labels[${i}]`);
      return {
        text: reqStr(lo, 'text', `${path}.labels[${i}]`, 100),
        end: oneOf(lo, 'end', `${path}.labels[${i}]`, ['a', 'b'] as const),
      };
    });
  return {
    id: reqId(o, 'id', path),
    net: asNetworkId(reqId(o, 'net', path)),
    title: reqStr(o, 'title', path, 100),
    color: reqColor(o, 'color', path),
    kind: reqStr(o, 'kind', path, 100),
    a: { server: asHostId(a.server), iface: asInterfaceId(a.iface) },
    b: { server: asHostId(b.server), iface: asInterfaceId(b.iface) },
    traffic: optNum(o, 'traffic', path),
    labels,
  };
}

/** Builds one dns zone. Zones are shared (merged by id), like networks. */
function buildZone(value: unknown, path: string): DnsZone {
  const o = asObj(value, path);
  return {
    id: asZoneId(reqId(o, 'id', path)),
    name: reqStr(o, 'name', path, 200),
    kind: oneOf(o, 'kind', path, ZONE_KINDS),
    color: reqColor(o, 'color', path),
    dns: reqStr(o, 'dns', path, 200),
    registrar: optStr(o, 'registrar', path, 100),
    renews: optStr(o, 'renews', path, 50),
    ns: asArr(o.ns ?? fail(path, 'is missing ns'), `${path}.ns`).map((v, i) => {
      if (typeof v !== 'string' || v.length === 0 || v.length > 200) {
        fail(`${path}.ns[${i}]`, 'must be a non-empty string of at most 200 characters');
      }
      return v;
    }),
    dnssec: reqBool(o, 'dnssec', path),
    note: optStr(o, 'note', path),
  };
}

/**
 * Builds one dns record. A record either terminates on the reporting host
 * (`server` set, and then it must BE the reporting host, with `iface`/`node`
 * resolving inside the report) or it is shared zone data with no `server` at
 * all — in which case `iface`/`node` make no sense and are refused. This is
 * what stops one agent from re-pointing a name at (or away from) another
 * host's services.
 */
function buildRecord(
  value: unknown, path: string, hostId: string,
  ifaceIds: ReadonlySet<string>, nodeIds: ReadonlySet<string>,
): DnsRecord {
  const o = asObj(value, path);
  const server = o.server === undefined ? undefined : reqHostId(o, 'server', path);
  if (server !== undefined && server !== hostId) fail(`${path}.server`, 'must be the reporting host when set');
  if (server === undefined && (o.iface !== undefined || o.node !== undefined)) {
    fail(path, 'must not carry iface/node without server');
  }
  const tls = o.tls === undefined ? undefined : (() => {
    const to = asObj(o.tls, `${path}.tls`);
    return {
      issuer: reqStr(to, 'issuer', `${path}.tls`, 100),
      expires: reqStr(to, 'expires', `${path}.tls`, 50),
    };
  })();
  const iface = server === undefined ? undefined : optRef(o, 'iface', path, ifaceIds, 'interface');
  return {
    id: asRecordId(reqId(o, 'id', path)),
    zone: asZoneId(reqId(o, 'zone', path)),
    name: reqStr(o, 'name', path, 200),
    fqdn: reqStr(o, 'fqdn', path, 200),
    type: oneOf(o, 'type', path, RECORD_TYPES),
    value: reqStr(o, 'value', path),
    ttl: optStr(o, 'ttl', path, 50),
    proxied: optBool(o, 'proxied', path),
    server: server === undefined ? undefined : asHostId(server),
    iface: iface === undefined ? undefined : asInterfaceId(iface),
    node: server === undefined ? undefined : optRef(o, 'node', path, nodeIds, 'service node'),
    net: o.net === undefined ? undefined : asNetworkId(reqId(o, 'net', path)),
    via: optStr(o, 'via', path, 200),
    tls,
    state: optOneOf(o, 'state', path, ['down'] as const),
    note: optStr(o, 'note', path),
  };
}

// ---- the report -----------------------------------------------------------

/**
 * The validator the ingest route runs every report through.
 *
 * How it works, in order:
 *
 *   1. envelope — `hostId` (canonical, dotless) and `collectedAt` (parseable,
 *      not in the future)
 *   2. `host` — built first, because everything else references its service
 *      and interface ids
 *   3. the optional collections (networks, edges, p2p, zones, records) — each
 *      entry rebuilt through its `build*` function, each collection checked
 *      for duplicate ids, missing collections normalised to `[]`
 *
 * Anything that fails throws a 400 naming the exact path; nothing about the
 * input is repaired silently except the documented normalisations (absent
 * collection → `[]`, absent `mgmtVia` → `null`). Returns a fully typed
 * `InventoryReport` whose every field this file constructed.
 */
export const asInventoryReport: Validator<InventoryReport> = (input) => {
  const raw = expectObject(input, 'inventory report');

  const hostId = reqHostId(raw, 'hostId', 'report');
  const collectedAt = reqTimestamp(raw, 'collectedAt', 'report');
  const host = buildHost(raw.host, hostId);

  const ifaceIds: ReadonlySet<string> = new Set(host.interfaces.map((i) => i.id as string));
  const nodeIds: ReadonlySet<string> = new Set(host.nodes.map((n) => n.id));

  const networks = optArr(raw, 'networks', 'report')
    .map((v, i) => buildNetwork(v, `networks[${i}]`));
  requireUniqueIds(networks, 'networks');

  const edges = optArr(raw, 'edges', 'report')
    .map((v, i) => buildEdge(v, `edges[${i}]`, hostId, ifaceIds, nodeIds));
  requireUniqueIds(edges, 'edges');

  const p2p = optArr(raw, 'p2p', 'report')
    .map((v, i) => buildP2P(v, `p2p[${i}]`, hostId, ifaceIds));
  requireUniqueIds(p2p, 'p2p');

  const zones = optArr(raw, 'zones', 'report')
    .map((v, i) => buildZone(v, `zones[${i}]`));
  requireUniqueIds(zones, 'zones');

  const records = optArr(raw, 'records', 'report')
    .map((v, i) => buildRecord(v, `records[${i}]`, hostId, ifaceIds, nodeIds));
  requireUniqueIds(records, 'records');

  return {
    hostId: asHostId(hostId), collectedAt, host, networks, edges, p2p, zones, records,
  };
};
