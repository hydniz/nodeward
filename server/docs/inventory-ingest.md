# the inventory ingest

`POST /api/agents/:agentId/inventory` is implemented end to end. This is the
description of how it works; the executable spec is
`src/modules/inventory/inventory.ingest.test.ts`.

## The path a report takes

```
agent ── POST /api/agents/:id/inventory
           │
           ▼
  agents.auth.requireAgent          bearer token → principal (agent + host)
           │
           ▼
  inventory.schema.asInventoryReport   rebuild the payload field by field
           │                           (400 with the offending path on failure)
           ▼
  agents.routes — the 403 guard     report.hostId must be the principal's host:
           │                        the token decides the host, never the payload
           ▼
  inventory.service.applyReport     drop edges into unknown networks (logged),
           │                        log what was accepted
           ▼
  store.inventory.replaceHost       build the next Inventory, swap atomically,
                                    stamp inventoryChangedAt
           │
           ▼
  topology cache                    keys on lastChangedAt() → next /api/topology
                                    read recomputes the layout
```

The route answers `202 { accepted: true, hostId }` — cheap and always the
same, so a retrying agent stays harmless.

## Validation (`inventory.schema.ts`)

Allowlist strategy: the validator never passes the raw body through. Every
object is rebuilt from checked fields; unknown fields are dropped (including
the fixture-only derived `modal` on interfaces). The checks, per layer:

- **envelope** — `hostId` canonical (lowercase, alphanumeric plus `_ -`, **no
  dot** — `parseServiceKey` splits `<host>.<node>` at the first dot),
  `collectedAt` parseable and at most 5 minutes in the future
- **types & limits** — strings non-empty, length-capped, free of control
  characters; numbers finite and non-negative; collections ≤ 1000 items
  (the body itself is capped by `INGEST_MAX_BODY` before parsing); colors
  must be hex (they end up in svg attributes); enums (`role`, record `type`,
  zone `kind`, `tone`, `state`) checked against their literals
- **internal references** — every edge's `iface`, every chip's `nodes`, every
  `node` field on interfaces/edges/records must resolve within the report;
  duplicate ids within a collection are refused
- **cross-host claims** — `host.id === hostId`; every edge's `server`, every
  p2p `a.server` and every record's `server` (when set) must be the reporting
  host; records without `server` are shared zone data and must not carry
  `iface`/`node`

## Ownership & merge semantics (`store/memory.ts → replaceHost`)

A report is a **snapshot**: within the host's own share, whatever it omits is
gone. What "own share" means per collection:

| collection | owned by this host | on replace |
| --- | --- | --- |
| hosts | the host itself | replaced (fresh view: `up`, no measurements) |
| edges | `server === hostId` | replaced |
| p2p | `a.server === hostId` | replaced — the `a` end owns the tunnel entry |
| records | `server === hostId` | replaced |
| records without `server` | shared | merged by id |
| networks, zones | shared | merged by id, field-wise, never deleted |

"Merged field-wise" means `{ ...old, ...incoming }`: the last writer wins per
field, optional fields nobody re-reported survive, and one host going quiet
about a shared network cannot tear it out from under the others.

The swap is atomic: the next `Inventory` is built synchronously and assigned
in one statement, so a reader sees the world before or after the report,
never a half-applied host. Every write stamps `inventoryChangedAt`, which is
the topology cache key — no explicit `invalidate()` call needed.

`removeHost` (agent revoked, machine decommissioned) removes the host, its
edges, every p2p tunnel touching it on either end, and the records
terminating on it; shared networks and zones stay.

## Decisions worth knowing

- **Edges into unknown networks are dropped, not refused** (in
  `applyReport`, with a warn log listing the dropped edge ids). Reason: the
  first agent of a fleet may reference a mesh whose other members have not
  reported yet — refusing would make bootstrapping order-dependent; dropping
  means the edge appears with the next periodic snapshot after the network
  exists.
- **No event diffing.** The service does not compare snapshots to synthesise
  `service.started`-style events — the events endpoint exists for agents to
  report those themselves.
- **Health fields start neutral.** A reported host enters as `status: 'up'`
  with `cpu/ram/disk = null`; the read-side merge (`withHealth`) overrides
  them as soon as the health ingest exists.

## Still open

- the 403 host-mismatch guard is in place but not externally testable until
  per-agent tokens exist (roadmap step 2, `agents.auth.ts`) — with the shared
  dev token the principal's host is derived from the body
- `zones`/`records` are accepted and merged, but no agent collects dns yet

## Poking it by hand

`src/test/inventory.fixture.ts` builds a self-contained report (host
`testbox` with one docker service, joining `lan`); its header comment has the
curl invocation. After posting: `GET /api/servers/testbox`, or open the map.
