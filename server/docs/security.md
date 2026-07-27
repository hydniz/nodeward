# security model

What the server defends, how, and — just as important — what it deliberately
does **not** defend yet. nodeward is meant to run in production at small
companies, and its inventory is one of the most sensitive documents such a
company owns: hostnames, internal ips, open ports, dns. Read this before
exposing a deployment.

## Trust boundaries

```
 browser ──── ui + read api (/api/topology, /api/servers, …)  admin session (ADMIN_PASSWORD)
 operator ─── management (/api/agents, DELETE …)              admin session
 agents ───── write api (/api/agents/register + /:id/*)       join token → per-agent bearer token
 anyone ───── /api/auth/login (rate limited), /healthz, /readyz
```

- **Humans hold a session.** One password (`ADMIN_PASSWORD`) guards
  everything a human sees — the ui, the read api, the operator endpoints. A
  login mints an httpOnly `SameSite=Lax` cookie (Secure whenever the login
  arrived over https, so a tls session can never be replayed over plain http),
  held in memory server-side: a deploy logs the operator out, nothing to persist.
  The inventory is the sensitive document here (hostnames, internal ips, open
  ports, dns), which is why the read api is gated exactly like the ui that
  renders it. Production **refuses to boot** without the password unless
  `AUTH_DISABLED=true` says the openness is intentional. Csrf: the cookie is
  Lax, all writes are json posts, and the api sends no cors headers — a
  foreign origin gets neither the cookie nor a readable response.
- **Agents hold bearer tokens** — the two worlds never mix: an agent token
  opens no human doors, a session opens no agent doors. Enrolment sits behind
  the join token (constant-time compare, rate limited), everything else
  behind per-agent hashed tokens, every payload rebuilt field by field at the
  seam, every report pinned to the host the token owns
  ([agent-enrolment.md](agent-enrolment.md), [inventory-ingest.md](inventory-ingest.md)).
- **Transport is the reverse proxy's job.** The node process speaks plain
  http; credentials in cleartext are only acceptable on loopback or a trusted
  network. Production means tls at nginx/caddy in front ([deployment.md](deployment.md))
  — the server supports that with `TRUST_PROXY` (client ips stay truthful)
  and sends HSTS in production.

## What the server enforces itself

| measure | where | notes |
| --- | --- | --- |
| login required in production | `config.ts`, `modules/auth/` | no `ADMIN_PASSWORD` and no explicit `AUTH_DISABLED=true` → the server refuses to boot |
| admin login rate limit | `auth.routes.ts` | 5 attempts per ip per minute; the session cookie is httpOnly, SameSite=Lax, Secure when minted over https |
| enrolment closed by default | `agents.service.ts → register` | no `AGENT_JOIN_TOKEN` → every enrolment is a 401 |
| join token strength | `config.ts` | production refuses tokens under 16 chars at boot |
| no dev shortcuts in production | `config.ts` | `AGENT_TOKEN` (shared token) refuses to boot; the open no-token mode never applies with `NODE_ENV=production` |
| constant-time token compares | `agents.auth.ts` | join/shared token via `timingSafeEqual` over hashes; per-agent tokens are a hash lookup |
| tokens stored hashed | `store/*` | sha-256; a database leak yields no credentials; plaintext exists only in the one 201 response |
| enrolment rate limit | `core/ratelimit.ts` | per ip per minute (`REGISTER_RATE_LIMIT`, default 10) — at that rate a 16-char token is unguessable in any human timeframe |
| honest client ips | `config.ts → trustProxy` | `x-forwarded-for` is ignored unless `TRUST_PROXY` says otherwise, so the rate limit cannot be sidestepped by header forgery |
| payload allowlisting | `*.schema.ts` | every accepted object rebuilt field by field; length caps, canonical ids, no control characters, item caps |
| host pinning | `agents.auth.ts → requireOwnHost` | mounted on every agent write route: a `hostId` anywhere in the body (nested `items[]` included) that is not the token's host is a 403, decided before any handler runs |
| record ownership | `store/facts.ts → splitRecordClaims` | dns record ids are a global namespace; a report may not claim an id another host holds, in either driver ([inventory-ingest.md](inventory-ingest.md)) |
| body size cap | `app.ts` | `INGEST_MAX_BODY` (default 1 MB) refused before parsing |
| browser hardening headers | `app.ts` | strict CSP (the client is fully self-contained), `nosniff`, `frame-ancestors 'none'`, `referrer-policy: no-referrer`, HSTS in production |
| one json error shape | `core/errors.ts` | internals and stacks never leave the process; unexpected errors answer a bare 500 |
| hijack visibility | `agents.service.ts → register` | replacing an agent that is still *online* logs a loud warning — the signature of a leaked join token or a cloned vm |

## What the join token can and cannot do

The join token is an *enrolment capability*, not an identity: whoever holds it
can enrol an agent for **any** `hostId`, including one that already exists —
which replaces that host's agent and lets the holder feed inventory in its
name. That is by design (re-installs must work on a wiped machine), and it
means:

- treat the join token like a root credential for the *graph* (not the hosts);
- rotate it after it was in anyone's hands who left (`AGENT_JOIN_TOKEN` is
  read at boot — set a new value and restart; enrolled agents are unaffected,
  their bearer tokens stay valid);
- watch for the "replacing an agent that is still reporting" warning — that is
  what abuse of a leaked token looks like;
- revocation is a credential reset, not a ban: a revoked host can re-enrol
  with the join token. Banning a machine means rotating the join token.

## What one compromised agent can and cannot do

Every host in the graph is described by a machine that could itself be owned,
so an agent token is treated as hostile input with a name attached. What that
token buys an attacker:

- **its own host's picture, entirely.** Services, interfaces, addresses, open
  ports, tags — a compromised host can lie freely about *itself*, and no server
  can tell the difference. Read the dashboard accordingly: it shows what hosts
  claim, and the claim is only as trustworthy as the host.
- **liveness.** It can go quiet (its host turns `stale`) or keep reporting.

What it cannot do:

- **speak for another host.** The principal is built from the agent row, never
  from the body, and `requireOwnHost` refuses any payload naming a different
  host — on every write route, including the ingest seams that are not
  implemented yet, so finishing them cannot reopen the hole.
- **take over another host's dns records.** Record ids are global; a claim on an
  id another host holds is dropped and logged
  ([inventory-ingest.md](inventory-ingest.md)).
- **reach anything a human sees.** Agent tokens open no read api, no operator
  endpoint, no session — the two worlds share no credential.
- **escalate to another agent's credentials.** Tokens are stored only as
  sha-256 hashes and never appear in a response after enrolment.

The honest gap: an agent token is a *credential*, and a host that holds one can
always poison its own facts. Detection, not prevention, is the answer — the
inventory is a document about the fleet, not evidence about it.

## Deployment checklist

The step-by-step version (docker compose, caddy, systemd) is
[deployment.md](deployment.md); the security essence:

1. `NODE_ENV=production` — this is what arms all fail-closed behaviour.
2. `ADMIN_PASSWORD` set (`openssl rand -base64 18`); `AUTH_DISABLED=true`
   only for a dashboard that is *meant* to be public.
3. tls in front (nginx/caddy), `TRUST_PROXY=1` (or your hop count).
4. `AGENT_JOIN_TOKEN` from `openssl rand -base64 24`.
5. no `AGENT_TOKEN` (production refuses to boot with it anyway).
6. store on the sqlite driver (the production default) and its file inside
   the backed-up volume. The memory driver loses every enrolled agent on
   restart — it exists for development and tests, not deployments.
