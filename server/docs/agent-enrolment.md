# agent enrolment & auth

How an agent gets its credentials and how every later request is
authenticated. This is roadmap step 2; the identity background (join token vs
bearer token vs `hostId`) is in [agent-identity.md](agent-identity.md), the
code lives in `modules/agents/` (`agents.service.ts`, `agents.auth.ts`,
`agents.schema.ts`) and `store/*.ts → agents`.

## The flow

```
POST /api/agents/register   {joinToken, hostId, name, version, platform?, labels?}
  → 201 {agent, credentials: {agentId, token, expiresAt: null}, config}
```

1. the body is rebuilt field by field (`agents.schema.ts` — allowlist, length
   caps, canonical `hostId`, no control characters), like every agent-facing
   seam
2. `joinToken` is compared against `AGENT_JOIN_TOKEN` in constant time (both
   sides hashed, `sameHash`). No token configured → enrolment is closed, 401.
3. the server mints the agent: `id` is a fresh uuid, the bearer token is 32
   random bytes (base64url). **Only the sha-256 hash of the token is stored**;
   the 201 response is the only place the plaintext ever exists. The agent
   persists it (state file / volume) and forgets the join token.

Every later request carries `Authorization: Bearer <token>`. `requireAgent`
resolves it with one hash lookup (`store.agents.findByTokenHash`) and builds
the principal **from the stored row, never from the request body** — which is
what enforces protocol invariant 1: a report is only ever applied to the host
the token owns; a `hostId` in any payload that disagrees is a 403.

## Decisions worth knowing

- **Re-enrolment replaces (no 409).** A wiped machine cannot know it was
  enrolled before, so enrolling a `hostId` that already has an agent is
  treated as a re-install: the store drops the old row (killing the old
  token), per-agent config follows the host to the new agent id, and the
  host's inventory/history continue seamlessly — identity lives on `hostId`,
  credentials rotate. Logged on the server either way.
- **Every authenticated request is liveness.** `requireAgent` stamps
  `lastSeenAt` (`store.agents.touch`) on each request, so `online / stale /
  pending` (derived, never stored — `deriveStatus`) is truthful without a
  dedicated ping. The heartbeat endpoint exists for hosts with nothing else
  to say.
- **Heartbeat acks steer the agent** (invariant 3): a heartbeat from a host
  the store holds no facts for answers `wantInventory: true` — how a server
  with an empty store recovers without anyone logging into a host.
- **Revocation cuts the credential, not the machine.** `DELETE
  /api/agents/:id` flips the agent to `revoked` (its token answers 403), but
  the host's inventory stays in the graph and merely goes stale. Removing the
  host is a separate, explicit act (`store.inventory.removeHost`). A revoked
  host may re-enrol with the join token — revoking forces a credential reset,
  it is not a ban.
- **The development shortcuts still exist and still say so.** `AGENT_TOKEN`
  (one shared token, host trusted from the body) and the open no-token mode
  outside production are unchanged — both bypass the per-agent lookup and are
  logged loudly. Production without per-agent tokens refuses with 401.

## Which failure gets which answer

The api distinguishes "I do not know you" from "I know you and the answer is
no" — an agent can act on that difference (re-enrol vs give up):

| answer | meaning | cases |
| --- | --- | --- |
| `400 bad_request` | fix the payload | malformed body; the message names the exact path (`registration.hostId must be …`) |
| `401 unauthorized` | get a (new) token | enrolment closed, wrong join token, missing/unknown bearer token → the agent's recovery is to re-enrol with the join token |
| `403 forbidden` | authenticated, refused | revoked agent, token used on another agent's route, payload `hostId` ≠ the token's host → retrying will not help; a human decided this |
| `404 not_found` | no such agent | operator revokes an id nobody enrolled |

A 401 after a re-install is the expected signal for a *replaced* agent: its
token died when the host re-enrolled, and the fresh credentials are already on
the machine that did.

## Trying it by hand

```sh
AGENT_JOIN_TOKEN=letmein npm run dev -w server

curl -s localhost:4001/api/agents/register -H 'content-type: application/json' \
  -d '{"joinToken":"letmein","hostId":"testbox","name":"testbox","version":"0.1.0"}'
# → keep credentials.token and credentials.agentId from the answer

curl -s localhost:4001/api/agents/<agentId>/heartbeat \
  -H "authorization: Bearer <token>" -H 'content-type: application/json' \
  -d "{\"hostId\":\"testbox\",\"at\":\"$(date -u +%FT%TZ)\"}"
# → {"accepted":1,…,"wantInventory":true}   (no inventory posted yet)
```
