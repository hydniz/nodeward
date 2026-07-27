# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Node ≥ 22.6 is required (the server runs `.ts` sources directly via type stripping — there is no build step for the server). The system default node may be older; `nvm use` picks the version from `.nvmrc`.

```sh
npm install                    # installs all workspaces (server, client)
npm run dev                    # api on :4001 + vite dev server on :5173 (vite proxies /api)
npm run dev -w server          # api only (node --watch)
npm run typecheck -w server    # tsc --noEmit — this is the server's type check
npm run test -w server         # vitest (node env, supertest against the real app)
npm run test -w client         # vitest (jsdom + testing-library)
npm run test -w server -- src/core/logger.test.ts   # single test file
npm run build                  # builds client/dist
npm start                      # production: express serves api + built frontend on :4001
```

## What this is

nodeward — an infrastructure dashboard rendering hosts, logical networks and links as an auto-laid-out topology graph, aimed at production use in small companies (open source, AGPL-3.0). Implemented today: the read API (demo fixture or agent data), **inventory ingest**, **agent enrolment + per-agent token auth**, the **admin session** (login guarding UI + read API), and the **sqlite store**. Still seams answering `501` with a `details.implementIn` pointer: health ingest, series/retention, alerts, batch, postgres. `grep -r "TODO(implement)" server/` lists them. `server/README.md` documents endpoints, the agent protocol, and the suggested implementation order; `server/docs/security.md` documents the security model.

## Architecture

Three npm workspaces:

- `server/` — TypeScript + express
- `client/` — React 18 + Vite (plain JS/JSX), hand-rolled SVG graph, no chart library
- `shared/` — plain JS used by both: geometry helpers + the auto-layout engine

### Server structure and its rules

`src/index.ts` bootstraps config → logger → store → app → listen, and owns shutdown + periodic jobs. Layered as `core/` (plumbing) · `domain/` (types) · `store/` (repositories) · `modules/` (features). The rules that keep it modular:

- **`config.ts` is the only file that reads `process.env`.** Everything else receives a `Config`. All env vars are documented in its header comment and the README table.
- **`domain/` is types only, no runtime dependencies** — the contract agents, store and UI share (branded ids, inventory facts, health samples, topology geometry).
- **Modules never import each other's internals and never touch a database.** They are constructed in `modules/index.ts` and talk to the `Store` repository interfaces (`store/types.ts`). Drivers today: `memory` (development, serves the fixture) and `sqlite` (production default, `node:sqlite`); `postgres` is planned per `server/docs/storage.md`. Snapshot/merge semantics shared by all drivers live in `store/facts.ts`.
- **Routes never leak internal errors.** Everything a route may fail with is an `ApiError` (`core/errors.ts`, one JSON problem shape); anything else is a bug, logged with stack, answered as a bare 500.
- Middleware order (in `app.ts`): requestId → requestLog → json body → routes → notFound → errorHandler. Request context (id, per-request child logger) hangs on the request via `contextOf(req)` in `core/middleware.ts`.

Logging (`core/logger.ts`, dependency-free): text lines in dev, JSON lines in production; production always persists daily files to `LOG_DIR` (default `server/logs`); every record carries `src` = `file:line` of the call. Level via `LOG_LEVEL`.

Server tests build the real app against the memory store via `createTestApp` in `src/test/harness.ts` (memory store, silent logger, env overrides per test) and drive it with supertest.

### Agent protocol invariants

When implementing the ingest seams, keep these (from `server/README.md`):

1. **The token decides the host, never the payload** — a `hostId` in the body that disagrees is a 403. Enforced centrally by `requireOwnHost` (`agents.auth.ts`) on every agent write route, so a new seam cannot forget it; inside a service, write `principal.hostId` to the store, never `report.hostId`.
2. **A host may only claim what it owns** — dns record ids are a global namespace, so the store refuses a claim on an id another host holds (`store/facts.ts → splitRecordClaims`). The schema can only check what a record *claims*; ownership is the store's call.
3. **Retries are harmless** — inventory is an idempotent snapshot, health carries `seq` (drop anything not newer), events dedupe on `(hostId, at, kind, subject)`.
4. **Acks steer the agent** — `IngestAck` can change the interval or request a fresh inventory.

### The layout engine

The topology graph lays itself out from pure facts — nobody places coordinates by hand. The engine is `shared/autoLayout.js`, runs **in the backend**, and `/api/topology` serves finished geometry (endpoints, bends, label boxes); the client only draws. Layout is strictly deterministic (no randomness, ties broken by id sort) so every user sees the identical graph. The rules are numbered R0–R9 in `LAYOUT.md` and referenced from the code by those numbers — read it before touching layout.

### Client structure

- `components/ui.jsx` — the page scaffolding all list pages share (head → filter chips → stat tiles → table/detail); `components/MorphLayout.jsx` — the table ⇄ master/detail morph
- `services.js` — the service view-model derived from host facts; `nav.js` — the linking rules
- Navigation convention: a page opens its own kind directly; everything else shows a mini-overview card first, ending in "open … page →"; ctrl/cmd+click skips the card. Deep links are plain URLs (`/servers?server=ug1`, `/services?service=ug1.wiki`, `/networks?net=tailnet`, `/?focus=ug1`).
- Everything is responsive — nothing is desktop-only (mobile re-stacks the same pages).

## Contribution

### Git Rules

- Never add "Co-Authored-By" lines or any AI attribution to git commits or PR descriptions.

### Git Workflow

- Do NOT use `git worktree` commands under any circumstances.
- Perform all file operations and git commands directly inside the current working directory.