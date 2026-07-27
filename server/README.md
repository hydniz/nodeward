# nodeward server

TypeScript, express, no build step: node runs the `.ts` sources directly (type
stripping, node ≥ 22.6). `npm run typecheck -w server` is what checks types.

```sh
npm run dev -w server        # node --watch src/index.ts, port 4001
npm run typecheck -w server  # tsc --noEmit
npm start -w server          # production
```

The read endpoints work today (served from the demo fixture, which is what keeps
the frontend alive), and the **inventory ingest is implemented**: an agent can
post a facts snapshot and the host appears in the graph — see
[docs/inventory-ingest.md](docs/inventory-ingest.md). **The remaining agent
writes are scaffolded but not implemented**: the routes exist, are
authenticated, validated at the seam and documented — and answer `501` with
the file to implement:

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
    memory.ts           the driver in use: serves the fixture, every write is a seam
    index.ts            createStore(); the schema lives in docs/storage.md

  docs/
    storage.md          how agent data is stored: three storage classes, the
                        series catalogue, retention tiers, the full sql schema
    explore.md          letting people browse the data: grafana against the same
                        postgres (role, views, queries), what nodeward answers
                        itself, csv export, prometheus interop
    inventory-ingest.md the implemented inventory ingest: validation, ownership
                        and merge semantics, decisions worth knowing
    agent-identity.md   how an agent identifies its host (machine-id & friends),
                        join token vs bearer token vs hostId, docker and native
                        service discovery, the four service states

  modules/              one folder per bounded piece, wired in modules/index.ts
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

### read — what the frontend consumes

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
| POST | `/api/agents/register` | ⛔ enrol with the join token → agent + token |
| GET | `/api/agents/:agentId/config` | collector config (implemented, returns the default) |
| POST | `/api/agents/:agentId/heartbeat` | ⛔ liveness |
| POST | `/api/agents/:agentId/inventory` | facts snapshot — implemented (validated, snapshot semantics) |
| POST | `/api/agents/:agentId/health` | ⛔ metric samples |
| POST | `/api/agents/:agentId/events` | ⛔ discrete events |
| POST | `/api/agents/:agentId/batch` | ⛔ several of the above at once |
| GET | `/api/agents`, `/api/agents/:agentId` | operator view |
| DELETE | `/api/agents/:agentId` | ⛔ revoke the token |

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

Every request carries `Authorization: Bearer <token>`. Three invariants the
implementation has to keep:

1. **the token decides the host, never the payload.** A report is applied to the
   host the token belongs to; a `hostId` in the body that disagrees is a `403`.
   Otherwise one agent could overwrite another's inventory.
2. **retries are harmless.** Inventory is a snapshot (idempotent by design),
   health carries `seq` (drop anything not newer), events deduplicate on
   `(hostId, at, kind, subject)`.
3. **acks steer the agent.** `IngestAck` can change the interval or ask for a
   fresh inventory (`wantInventory`) — that is how a server with an empty store
   recovers without anyone logging into a host.

### Configuration

| env | default | meaning |
| --- | --- | --- |
| `PORT` | `4001` | http port |
| `NODE_ENV` | `development` | `production` closes the development shortcuts |
| `LOG_LEVEL` / `LOG_JSON` | `debug` / off | logging (`info`/on in production) |
| `LOG_DIR` | `server/logs` in production, unset in dev | daily `nodeward-YYYY-MM-DD.log` files (json lines, with `src` = `file:line` of the call) |
| `STORE_DRIVER` | `memory` | `memory` \| `postgres` |
| `DATABASE_URL` | — | required for `postgres` |
| `DEMO_DATA` | `true` on memory | serve the fixture inventory |
| `AGENT_JOIN_TOKEN` | — | secret needed to enrol; enrolment is closed while unset |
| `AGENT_TOKEN` | — | development shortcut: one token for all agents |
| `AGENT_HEARTBEAT_TIMEOUT` | `90` | seconds until an agent counts as `stale` |
| `AGENT_INTERVAL` | `15` | interval handed to agents |
| `INGEST_MAX_BODY` | `1048576` | max report size, refused before parsing |
| `HEALTH_RETENTION_DAYS` | `30` | how long samples are kept |

## Suggested order to implement

1. ~~**inventory ingest**~~ — done: `inventory.service.applyReport` +
   `store.inventory.replaceHost` (see [docs/inventory-ingest.md](docs/inventory-ingest.md)).
   A real host appears in the graph and `DEMO_DATA=false` is possible.
2. **agent enrolment + auth** — `agents.service.register`,
   `store.agents.create/findByTokenHash`, and the lookup in
   `agents.auth.requireAgent`. Until this exists the api trusts the route, which
   is fine on a laptop and nowhere else.
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
