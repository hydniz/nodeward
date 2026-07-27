# nodeward server

TypeScript, express, no build step: node runs the `.ts` sources directly (type
stripping, node ≥ 22.6). `npm run typecheck -w server` is what checks types.

```sh
npm run dev -w server        # node --watch src/index.ts, port 4001
npm run typecheck -w server  # tsc --noEmit
npm start -w server          # production
```

The read endpoints work today (served from the demo fixture, which is what keeps
the frontend alive), and the first two agent steps are implemented: the
**inventory ingest** (an agent posts a facts snapshot and the host appears in
the graph — [docs/inventory-ingest.md](docs/inventory-ingest.md)) and
**enrolment + per-agent auth** (join token → bearer token, heartbeat,
revocation — [docs/agent-enrolment.md](docs/agent-enrolment.md)). **The
remaining agent writes are scaffolded but not implemented**: the routes exist,
are authenticated, validated at the seam and documented — and answer `501`
with the file to implement:

```json
{ "error": { "code": "not_implemented",
             "message": "health ingest is not implemented yet",
             "details": { "implementIn": "server/src/modules/health/health.service.ts → ingest" } } }
```

Grep for `TODO(implement)` to get the full list.

---

## Layout

```
src/
  index.ts              bootstrap: config → logger → store → app → listen,
                        shutdown, and the place for periodic jobs
  app.ts                express assembly: middleware order, probes, static client
  config.ts             the only file that reads process.env

  core/                 plumbing, knows nothing about the domain
    errors.ts           ApiError + the one json error shape + notImplemented()
    http.ts             handler(), stub(), the Validator<T> seam
    logger.ts           text lines while developing, json in production
    middleware.ts       requestId → requestLog → notFound → errorHandler

  domain/               types only: the contract agents, store and ui share
    common.ts           branded ids, Status, serviceKey()
    inventory.ts        the facts: hosts, services, interfaces, networks, dns
    health.ts           the measurements: samples, snapshots, series, acks
    agents.ts           enrolment, credentials, collector config, batches
    alerts.ts           alerts + threshold rules + the fleet summary
    topology.ts         the laid-out graph = the /api/topology contract

  store/                storage behind interfaces
    types.ts            InventoryRepository · HealthRepository ·
                        AgentRepository · AlertRepository → Store
    facts.ts            the snapshot/merge semantics, shared by every driver
    memory.ts           development driver: serves the fixture, volatile
    sqlite.ts           production driver (node:sqlite): one file, durable
    index.ts            createStore(); the sql schema for postgres lives in
                        docs/storage.md

  docs/
    storage.md          how agent data is stored: three storage classes, the
                        series catalogue, retention tiers, the full sql schema
    explore.md          letting people browse the data: grafana against the same
                        postgres (role, views, queries), what nodeward answers
                        itself, csv export, prometheus interop
    inventory-ingest.md the implemented inventory ingest: validation, ownership
                        and merge semantics, decisions worth knowing
    agent-enrolment.md  the implemented enrolment + auth: join token flow,
                        token storage, re-install and revocation semantics
    security.md         the security model: trust boundaries, what the server
                        enforces, join-token blast radius, deployment checklist
    deployment.md       running it for real: docker compose, tls via caddy,
                        systemd, backup = one volume
    agent-identity.md   how an agent identifies its host (machine-id & friends),
                        join token vs bearer token vs hostId, docker and native
                        service discovery, the four service states

  modules/              one folder per bounded piece, wired in modules/index.ts
    auth/               the admin session: login, cookie, the gate in front of
                        everything a human reads
    inventory/          hosts, services, networks, domains + inventory ingest
    topology/           the layout, cached; hands out host boxes
    summary/            fleet counters for the sidebar and tiles
    health/             sample ingest + the query side for charts
    agents/             enrolment, auth, config, the reporting endpoints
    alerts/             rules and alert state

  fixtures/
    demo.data.js        the hand-written demo dataset (unchanged)
    demo.ts             the one place it is cast into the domain types
```

Rules that keep this modular:

- **modules never import each other's internals.** They are constructed in
  `modules/index.ts` and receive what they need as arguments.
- **modules never touch a database.** They talk to `Store` interfaces, which is
  why swapping `memory` for `postgres` cannot reach into `modules/`.
- **`domain/` has no runtime dependencies.** Types plus a few id helpers, so
  agents and ui can be generated from or checked against it.
- **the api never returns an internal error.** Everything a route may fail with
  is an `ApiError`; anything else is a bug, logged with its stack and answered
  with a bare `500`.

## Endpoints

### auth — how a browser becomes trusted

| method | path | notes |
| --- | --- | --- |
| POST | `/api/auth/login` | `{password}` → httpOnly session cookie (rate limited) |
| POST | `/api/auth/logout` | drop the session |
| GET | `/api/auth/me` | `{required, authenticated}` — what the ui renders first |

### read — what the frontend consumes (admin session required)

| method | path | notes |
| --- | --- | --- |
| GET | `/api/topology` | the laid-out graph (geometry only, cached) |
| GET | `/api/servers` | hosts: facts + latest health + box geometry |
| GET | `/api/servers/:hostId` | one host, same shape |
| GET | `/api/services` | every service, with its host and stack |
| GET | `/api/services/:serviceId` | `<host>.<node>`, e.g. `ug1.wiki` |
| GET | `/api/networks` | the logical networks |
| GET | `/api/domains` | dns zones + records |
| GET | `/api/summary` | fleet counters + open alerts |
| GET | `/api/alerts`, `/api/alerts/rules` | empty until the alert module evaluates |
| GET | `/api/health/series` | the metric catalogue (`?host=ug1`); empty until the ingest writes it |
| GET | `/api/health/hosts/:hostId/latest` | ⛔ seam |
| GET | `/api/health/hosts/:hostId/series` | ⛔ seam, `?metrics=cpu,ram&from=&to=&step=` |
| GET | `/api/health/hosts/:hostId/export.csv` | csv of the same window; route done, waits on `series()` |
| GET | `/api/meta` | version, store driver, `source: fixture \| agent` |
| GET | `/healthz`, `/readyz` | process probes, never cached |

### write — what the agents talk to

| method | path | notes |
| --- | --- | --- |
| POST | `/api/agents/register` | enrol with the join token → agent + token — implemented |
| GET | `/api/agents/:agentId/config` | collector config (implemented, returns the default) |
| POST | `/api/agents/:agentId/heartbeat` | liveness — implemented (ack may ask for inventory) |
| POST | `/api/agents/:agentId/inventory` | facts snapshot — implemented (validated, snapshot semantics) |
| POST | `/api/agents/:agentId/health` | ⛔ metric samples |
| POST | `/api/agents/:agentId/events` | ⛔ discrete events |
| POST | `/api/agents/:agentId/batch` | ⛔ several of the above at once |
| GET | `/api/agents`, `/api/agents/:agentId` | operator view (admin session) |
| DELETE | `/api/agents/:agentId` | revoke the token (admin session); inventory stays |

⛔ = mounted and documented, `501` until implemented.

## The agent protocol

```
                    ┌── POST /api/agents/register        {joinToken, hostId, …}
   install token ───┤                                 →  {agent, credentials, config}
                    └── store the token, forget the join token

   every start ─────── GET  /api/agents/:id/config     →  {intervalSeconds, collect, …}

   on change ───────── POST /api/agents/:id/inventory     {hostId, host, networks, …}
   every interval ──── POST /api/agents/:id/health        {hostId, samples[], seq}
   when it happens ─── POST /api/agents/:id/events        [{kind, at, subject}]
   nothing to say ──── POST /api/agents/:id/heartbeat     {hostId, at}
   after downtime ──── POST /api/agents/:id/batch         {items[]}
```

Every request carries `Authorization: Bearer <token>`. Four invariants the
implementation has to keep:

1. **the token decides the host, never the payload.** A report is applied to the
   host the token belongs to; a `hostId` in the body that disagrees is a `403`.
   Otherwise one agent could overwrite another's inventory. This is not left to
   each route: `requireOwnHost` (`agents.auth.ts`) is mounted on every agent
   write route and scans the whole body, so a seam cannot forget it — when you
   implement one, keep writing `principal.hostId` into the store rather than
   the report's.
2. **a host may only claim what it owns.** Beyond the envelope, dns record ids
   are a *global* namespace: the validator checks what a record claims, the
   store checks who already holds the id, and a claim on somebody else's is
   dropped and logged (`store/facts.ts → splitRecordClaims`).
3. **retries are harmless.** Inventory is a snapshot (idempotent by design),
   health carries `seq` (drop anything not newer), events deduplicate on
   `(hostId, at, kind, subject)`.
4. **acks steer the agent.** `IngestAck` can change the interval or ask for a
   fresh inventory (`wantInventory`) — that is how a server with an empty store
   recovers without anyone logging into a host.

### Configuration

| env | default | meaning |
| --- | --- | --- |
| `PORT` | `4001` | http port |
| `NODE_ENV` | `development` | `production` closes the development shortcuts |
| `LOG_LEVEL` / `LOG_JSON` | `debug` / off | logging (`info`/on in production) |
| `LOG_DIR` | `server/logs` in production, unset in dev | daily `nodeward-YYYY-MM-DD.log` files (json lines, with `src` = `file:line` of the call) |
| `STORE_DRIVER` | `memory` dev / `sqlite` prod | `memory` \| `sqlite` \| `postgres` |
| `SQLITE_PATH` | `server/data/nodeward.db` | database file for `sqlite`; `:memory:` works (tests) |
| `DATABASE_URL` | — | required for `postgres` |
| `DEMO_DATA` | `true` on memory | serve the fixture inventory |
| `ADMIN_PASSWORD` | — | login for the ui, read api and operator endpoints. Required in production (min 8 chars) unless `AUTH_DISABLED=true` |
| `AUTH_DISABLED` | `false` | explicit opt-out: run without a login ("this dashboard is meant to be public") |
| `AGENT_JOIN_TOKEN` | — | secret needed to enrol; enrolment is closed while unset. Min 16 chars in production |
| `AGENT_TOKEN` | — | development shortcut: one token for all agents. Refused in production |
| `AGENT_HEARTBEAT_TIMEOUT` | `90` | seconds until an agent counts as `stale` |
| `AGENT_INTERVAL` | `15` | interval handed to agents |
| `INGEST_MAX_BODY` | `1048576` | max report size, refused before parsing |
| `REGISTER_RATE_LIMIT` | `10` | enrolment attempts per ip per minute before `429` |
| `TRUST_PROXY` | `false` | express `trust proxy`: `true`, a hop count, or a preset (`loopback`). Set behind nginx/caddy so client ips stay truthful |
| `HEALTH_RETENTION_DAYS` | `30` | how long samples are kept |

Production hardening, the threat model and a deployment checklist live in
[docs/security.md](docs/security.md).

## Suggested order to implement

1. ~~**inventory ingest**~~ — done: `inventory.service.applyReport` +
   `store.inventory.replaceHost` (see [docs/inventory-ingest.md](docs/inventory-ingest.md)).
   A real host appears in the graph and `DEMO_DATA=false` is possible.
2. ~~**agent enrolment + auth**~~ — done: `agents.service.register/heartbeat/revoke`,
   `store.agents.*`, and the per-agent token lookup in `agents.auth.requireAgent`
   (see [docs/agent-enrolment.md](docs/agent-enrolment.md)). Reports are now
   pinned to the host the token owns.
3. **health ingest** — `health.service.ingest` + `store.health.append/latest*`.
   The moment `latestAll()` returns data, `/api/servers` stops showing fixture
   numbers: the merge in `inventory.service.withHealth` already prefers measured
   values.
4. **series + retention** — `store.health.series`, then the hourly `prune()` job
   in `index.ts`.
5. **alerts** — `alerts.service.evaluate` from the ingest, plus the timer that
   turns "no report within the window" into a `down` host. This is the part that
   makes the dashboard useful rather than pretty.
6. **postgres** — `store/postgres.ts`, following [docs/storage.md](docs/storage.md)
   (schema, retention tiers, write path, jobs).
