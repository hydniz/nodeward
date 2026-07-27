# agent & host identity

How an agent knows *which machine it is*, why that is a different question from
*whether it may talk to us*, and what follows for docker, native services, and
dead services. The domain types this hangs off are `domain/agents.ts` and
`domain/inventory.ts`; the storage consequences are in `storage.md` §2.

## 1. Three credentials, three jobs

The enrolment flow hands around three different strings. Confusing them is the
root of most identity bugs, so:

| | what it is | scope | lifetime | answers |
| --- | --- | --- | --- | --- |
| **join token** | shared secret from the install command (`config.agents.joinToken`) | whole installation, same for every agent | until rotated | "may you enrol at all?" |
| **bearer token + `agentId`** | minted by the server at enrolment, returned once | one agent installation | until revoked / reinstalled | "who is sending this request?" |
| **`hostId`** | chosen by the agent from the machine itself | one physical/virtual machine | forever | "which machine does this data belong to?" |

The join token *identifies nothing* — every agent presents the same one. The
binding between an agent and its host happens because the agent reports its
`hostId` in `AgentRegistration`; only the agent can know which machine it runs
on.

The bearer token is a credential, not an identity. It is replaced whenever the
agent is reinstalled or revoked, and that must be harmless: the new agent
enrols, says "I am (still) `ug1`", the server replaces the agent row
(re-install case in `agents.service.ts → register`), and the host's history
continues seamlessly — because the history hangs off `hostId`, never off
`agentId`. Auth may rotate; identity must not.

## 2. Deriving `hostId`

Resolution order on the agent, first hit wins:

1. **`NODEWARD_HOST_ID`** (env / config) — explicit override. Solves every
   edge case: containers, cloned VMs, tests.
2. **The state file** — `/var/lib/nodeward/id` (linux),
   `C:\ProgramData\nodeward\id` (windows). Once it exists, *it* is the truth;
   nothing else is ever consulted again.
3. **First run only — seed from the OS machine identity**, hash it, write the
   state file:

   | platform | source |
   | --- | --- |
   | linux | `/etc/machine-id` (systemd, 128-bit, set at install, survives everything but a reinstall) |
   | windows | registry `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` |
   | macos | `IOPlatformUUID` (via `ioreg`) |
   | none of the above | random uuid |

   The npm package `node-machine-id` wraps exactly these three sources.

Two rules about step 3:

- **Never send the raw machine-id.** It is a system-wide key and the systemd
  man page explicitly warns against exposing it. Hash it with an application
  namespace instead — `sha256("nodeward:" + machineId)`, truncated to taste —
  so nodeward gets an app-specific id that cannot be traced back. (This is the
  same idea as systemd's `sd_id128_get_machine_app_specific`.)
- **The OS id is only a seed.** After the first run the agent reads the state
  file and nothing else — deterministic, platform-independent, and a later OS
  change cannot silently re-identify the host.

The derived id must fit the canonical `hostId` form the ingest enforces
(lowercase alphanumeric plus `_ -`, no dot — see `inventory-ingest.md`); hex
output does.

**Cloned VMs** are the known failure mode: a template whose machine-id was not
cleared produces two machines with the same id. Well-built images clear it
(cloud-init regenerates), but the server should still notice two live agents
reporting under one `hostId` at once and warn, instead of letting them
alternately overwrite each other's inventory.

## 3. Docker: the agent represents the host, never a service

A container like nextcloud is a `ServiceFacts` row inside its host's report —
`service_id = (host_id, node_id)` — not something that enrols on its own. This
is not just taste, the ingest enforces it: an `InventoryReport` is a snapshot
per host ("whatever is missing is gone", `replaceHost`), so two agents
reporting the same `hostId` would perpetually erase each other's view. **One
agent per host.** The agent discovers containers through the docker socket and
reports them as services:

- compose project → `ServiceChip` (the stack), compose service name →
  `ServiceFacts.id`, `res: 'docker'`
- identity comes from the compose labels (`com.docker.compose.project`,
  `com.docker.compose.service`), falling back to the container name. **Never
  the container id** — it changes on every recreate, which makes it an
  `agentId`, not a `hostId`.
- a container with its own network identity (tailscale sidecar, macvlan)
  becomes an `InterfaceFacts` with `node` set — the field exists for exactly
  this.

When the agent itself runs as a container it needs three things from the host
— identity, persistence, sight:

```yaml
services:
  nodeward-agent:
    image: nodeward/agent
    network_mode: host                                  # host interfaces, rx/tx
    volumes:
      - /etc/machine-id:/etc/machine-id:ro              # host identity (§2)
      - nodeward-state:/var/lib/nodeward                # hostId AND bearer token
      - /var/run/docker.sock:/var/run/docker.sock:ro    # service discovery
      - /proc:/host/proc:ro                             # host metrics
volumes:
  nodeward-state:
```

The state volume is load-bearing, not convenience: it holds the bearer token.
Without it every `docker rm` + recreate re-enrols — new token, new `agentId`,
one pointless trip through the re-install path per restart.

The socket, even read-only, is effectively root on the host. That is the
industry-standard trade (netdata, traefik, portainer all take it); the
cautious variant is a socket proxy (e.g. `tecnativa/docker-socket-proxy`) that
only exposes the container list.

## 4. Native services: systemd is the source of truth

The same host agent collects native (non-container) services; both go into the
same snapshot. On debian that means systemd:

- **discovery**: `systemctl list-units --type=service --output=json`
  (systemd ≥ 246), or the d-bus api (`org.freedesktop.systemd1 → ListUnits`)
  once parsing text feels wrong
- **identity**: `node_id` = unit name without suffix (`nextcloud.service` →
  `nextcloud`), `res: 'native'`. Unit names survive reboots and upgrades — the
  native counterpart to the compose service name.
- **status**: `ActiveState`/`SubState` → the `down` flag; a transition to
  `failed` is also an `AgentEvent` (§5)
- **chips**: native services normally stand alone (`chip: null` in
  `ServiceView`) — grouping needs a real shared lifecycle, and there isn't one

A stock debian runs 60–100 units; reporting them all makes the ui worthless.
The filter, in order:

1. **Default heuristic: report services that listen on a socket.** nodeward is
   a network tool; what has a port open (nginx, sshd, postgres) is a service,
   what doesn't (`cron`, `getty`) is plumbing. Mapping: listening socket →
   inode (`/proc/net/tcp`) → pid → unit via `/proc/<pid>/cgroup` (the path
   contains `system.slice/<unit>.service`). Side effect: the same correlation
   yields the `ports` line on interfaces for free.
2. **Built-in denylist** for listeners nobody wants to see
   (`systemd-resolved` and friends). Small and static.
3. **Allowlist in `AgentConfig`** (e.g. `services.include`) for units that
   matter without listening (`wg-quick@wg0`, backup timers). The config is
   pulled from the server anyway, so this is controlled centrally without
   touching hosts — the existing principle.

Consequence for deployment: seeing the host's systemd from inside a container
needs `/run/dbus/system_bus_socket`, `pid: host` and the host's `/proc` — a
container pretending not to be one. So: **on a host with native services, run
the agent natively** (its own systemd unit, installed by the join-token
one-liner). The containerised agent is for hosts where everything is a
container anyway.

## 5. Dead is not gone: the four service states

The snapshot semantics raise an obvious worry: does a dead service simply
vanish from the report? No — *dead* and *gone* are different cases, and only
gone needs new machinery.

**Dead but known.** A crashed unit still appears in the unit list
(`ActiveState=failed`); an exited container still appears in `docker ps -a`,
compose labels intact. The collector rule is: **report what exists, not what
runs** (`--all`, `ps -a`). A dead service then stays in the snapshot with
`down: true` and the ui shows it red. No model change — just a collector that
looks properly.

**Fast path.** The inventory interval (600 s) is too slow to *learn* about
death. On the transition the agent immediately posts `service.failed` /
`service.stopped` (`AgentEvent`, `domain/health.ts`). Division of labour:
**events make it fast, the snapshot makes it true.** Current state in the ui
derives from inventory (self-healing — a missed event is corrected by the next
snapshot); events feed alerts and the timeline. This is why the ingest does no
event diffing (see `inventory-ingest.md`, "Decisions worth knowing").

**Actually gone.** Only `docker rm` / uninstall removes a service from the
snapshot — and then the disappearance itself is the information. The server
cannot know whether it was decommissioning or an incident, so it must not
silently delete: a service present in the previous snapshot and missing from
the new one writes a `removed` entry into `inventory_changes` (`storage.md`
§5) and surfaces as **vanished** — greyed out, "last seen 3 weeks ago",
dismissible by the operator. "Vanished without ever being down" is then a
one-line alert rule.

**Host silent.** When the heartbeat stops the server knows *nothing* about
the services — they are neither up nor down. Grey them with the host
(**stale**), never mark them down: one dead agent must not fake twenty dead
services.

| state | source | ui |
| --- | --- | --- |
| running | in snapshot, `down` unset | normal |
| down | in snapshot, `down: true` | red |
| vanished | missing from snapshot, `inventory_changes` has the removal | ghost, "last seen …" |
| stale | host past heartbeat window | grey, with the host |

Of these, running/down work today; *vanished* needs the change-log comparison
in the store, and *stale* needs the heartbeat-derived host status on the read
side — both are read/ingest work, no agent involvement.
