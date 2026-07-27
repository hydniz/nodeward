// ---------------------------------------------------------------------------
// agents module — enrolment and liveness
//
// The lifecycle is described in `domain/agents.ts`. This service owns the parts
// that are not storage: checking the join token, minting a bearer token,
// deciding what config an agent gets, and deriving `online / stale / pending`
// from `lastSeenAt`. The flow and its decisions are documented in
// docs/agent-enrolment.md.
// ---------------------------------------------------------------------------

import { randomBytes, randomUUID } from 'node:crypto';
import type { Config } from '../../config.ts';
import type { Logger } from '../../core/logger.ts';
import { forbidden, notFound, unauthorized } from '../../core/errors.ts';
import type { Store } from '../../store/index.ts';
import { asAgentId } from '../../domain/common.ts';
import type {
  Agent, AgentConfig, AgentHeartbeat, AgentId, AgentPrincipal, AgentRegistration,
  AgentRegistrationResult, AgentStatus, IngestAck,
} from '../../domain/index.ts';
import { hashToken, sameHash } from './agents.auth.ts';

export interface AgentsService {
  /** enrol: join token in — agent, one-time bearer token and config out. */
  register(registration: AgentRegistration): Promise<AgentRegistrationResult>;
  /** operator view: every agent, with `status` derived at read time. */
  list(): Promise<Agent[]>;
  /** one agent (status derived at read time), or null when unknown. */
  get(id: AgentId): Promise<Agent | null>;
  /** cut the credential; the host's inventory stays (see the method doc). */
  revoke(id: AgentId): Promise<void>;
  /** what the agent should collect: its stored config, else the default. */
  configFor(id: AgentId): Promise<AgentConfig>;
  /** liveness ping; the ack may ask for a fresh inventory. */
  heartbeat(principal: AgentPrincipal, beat: AgentHeartbeat): Promise<IngestAck>;
}

/**
 * `online` while a report arrived within the heartbeat window, `stale` after
 * that, `pending` while nothing was ever heard.
 *
 * Derived, never stored: a stored status would be wrong the moment an agent goes
 * quiet, because nobody is there to write the change.
 */
export function deriveStatus(
  agent: Pick<Agent, 'lastSeenAt' | 'status'>,
  now: number,
  timeoutSeconds: number,
): AgentStatus {
  if (agent.status === 'revoked') return 'revoked';
  if (!agent.lastSeenAt) return 'pending';
  const age = (now - Date.parse(agent.lastSeenAt)) / 1000;
  return age <= timeoutSeconds ? 'online' : 'stale';
}

/** what an agent is told to collect when nobody configured anything else. */
export function defaultConfig(config: Config): AgentConfig {
  return {
    intervalSeconds: config.health.defaultIntervalSeconds,
    // facts change rarely; a full inventory every 10 minutes is plenty and keeps
    // the server correct even if it missed a change event
    inventoryIntervalSeconds: 600,
    collect: {
      host: true, services: true, interfaces: true, dns: true,
    },
    metrics: ['cpu', 'ram', 'disk', 'uptime', 'rx', 'tx'],
    maxBatch: 200,
  };
}

/**
 * The bearer token an agent keeps: 32 random bytes (256 bit, unguessable),
 * base64url-encoded so it survives headers, shell one-liners and config files
 * without quoting. The server stores only its sha-256 hash (`hashToken`).
 */
export function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

export function createAgentsService(
  config: Config,
  store: Store,
  log: Logger,
): AgentsService {
  return {
    /**
     * Enrol an agent: join token in, agent + bearer token out.
     *
     * The join token is the one gate — an api that enrols anybody is an open
     * door into the graph, so enrolment is closed (401) while no token is
     * configured, and the comparison runs in constant time (hash both sides,
     * `sameHash`). A host that already has an agent is the re-install case:
     * the store replaces the old row (friendlier than a 409 — a wiped machine
     * cannot know it was enrolled before), which also kills the old token.
     *
     * Only the hash of the minted token is stored; the response is the one
     * place the plaintext ever exists.
     */
    register: async (registration) => {
      log.info('enrolment attempt', { hostId: registration.hostId, name: registration.name });

      const expected = config.agents.joinToken;
      if (!expected) throw unauthorized('enrolment is closed: no join token configured');
      if (!sameHash(hashToken(registration.joinToken), hashToken(expected))) {
        throw unauthorized('invalid join token');
      }

      const previous = await store.agents.getByHost(registration.hostId);
      if (previous) {
        // an agent that is *still reporting* being replaced is not a normal
        // re-install — it is what a stolen join token or a cloned vm (two
        // machines, one machine-id → one hostId) looks like. The enrolment
        // still goes through (the operator may genuinely be re-imaging), but
        // loudly, so the log tells the story before the graph gets weird.
        const state = deriveStatus(previous, Date.now(), config.agents.heartbeatTimeoutSeconds);
        if (state === 'online') {
          log.warn('replacing an agent that is still reporting — a re-install would be offline; check for a cloned machine or a leaked join token', {
            hostId: registration.hostId, previousAgentId: previous.id, lastSeenAt: previous.lastSeenAt,
          });
        } else {
          log.info('replacing existing agent for host (re-install)', {
            hostId: registration.hostId, previousAgentId: previous.id,
          });
        }
      }

      const agent: Agent = {
        id: asAgentId(randomUUID()),
        hostId: registration.hostId,
        name: registration.name,
        version: registration.version,
        ...(registration.platform !== undefined ? { platform: registration.platform } : {}),
        ...(registration.labels !== undefined ? { labels: registration.labels } : {}),
        enrolledAt: new Date().toISOString(),
        lastSeenAt: null,
        status: 'pending',
      };
      const token = mintToken();
      await store.agents.create(agent, hashToken(token));

      log.info('agent enrolled', { agentId: agent.id, hostId: agent.hostId });
      return {
        agent,
        credentials: { agentId: agent.id, token, expiresAt: null },
        config: defaultConfig(config),
      };
    },

    /**
     * The operator's list. The stored `status` only distinguishes
     * revoked/not-revoked — everything else is a function of `lastSeenAt` and
     * the heartbeat window, so it is recomputed on every read (`deriveStatus`)
     * against one shared `now`, keeping the whole list consistent.
     */
    list: async () => {
      const agents = await store.agents.list();
      const at = Date.now();
      return agents.map((a) => ({
        ...a,
        status: deriveStatus(a, at, config.agents.heartbeatTimeoutSeconds),
      }));
    },

    /** one agent, status derived exactly like in `list()`. */
    get: async (id) => {
      const agent = await store.agents.get(id);
      if (!agent) return null;
      return {
        ...agent,
        status: deriveStatus(agent, Date.now(), config.agents.heartbeatTimeoutSeconds),
      };
    },

    /**
     * Revoke: the token stops working, the host's inventory stays.
     *
     * Keeping the inventory means the graph stays complete and merely goes
     * stale — revocation cuts a credential, it does not decommission a
     * machine. An operator who wants the host gone removes it explicitly
     * (`store.inventory.removeHost`); until then "revoked but still drawn"
     * is the honest picture.
     */
    revoke: async (id) => {
      const agent = await store.agents.get(id);
      if (!agent) throw notFound(`agent ${id}`);
      await store.agents.revoke(id);
      log.info('agent revoked', { agentId: id, hostId: agent.hostId });
    },

    /**
     * The config an agent pulls on start and after every change. Per-agent
     * config (set by an operator, survives re-installs — the store carries it
     * over to the new agent id) wins; without one the server default applies.
     * This is what lets collection be changed centrally without touching hosts.
     */
    configFor: async (id) => {
      const stored = await store.agents.getConfig(id);
      return stored ?? defaultConfig(config);
    },

    /**
     * The cheapest endpoint there is: touch `lastSeenAt`, answer an ack. Its
     * value is that a host with nothing to report still proves it is alive —
     * which is what turns a missing report into a `down` host instead of a
     * silent one.
     *
     * The ack steers the agent (protocol invariant 3): a heartbeat from a host
     * the store holds no facts for gets `wantInventory`, which is how a server
     * with an empty store recovers without anyone logging into a host.
     */
    heartbeat: async (principal, beat) => {
      log.debug('heartbeat', { agentId: principal.agentId, hostId: beat.hostId });
      // the token decides the host, never the payload (protocol invariant 1)
      if (beat.hostId !== principal.hostId) {
        throw forbidden('heartbeat hostId does not match the host this token owns');
      }
      const receivedAt = new Date().toISOString();
      await store.agents.touch(principal.agentId, receivedAt);
      const known = await store.inventory.getHost(principal.hostId);
      return {
        accepted: 1,
        rejected: 0,
        agentId: principal.agentId,
        receivedAt,
        ...(known ? {} : { wantInventory: true }),
      };
    },
  };
}
