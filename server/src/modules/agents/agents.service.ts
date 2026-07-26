// ---------------------------------------------------------------------------
// agents module — enrolment and liveness
//
// The lifecycle is described in `domain/agents.ts`. This service owns the parts
// that are not storage: minting a token, deciding what config an agent gets, and
// deriving `online / stale / pending` from `lastSeenAt`.
//
// `deriveStatus` and `defaultConfig` are implemented, because they are policy
// the rest of the server depends on. Everything that needs to persist something
// is a seam.
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import type { Config } from '../../config.ts';
import type { Logger } from '../../core/logger.ts';
import { notImplemented } from '../../core/errors.ts';
import type { Store } from '../../store/index.ts';
import type {
  Agent, AgentConfig, AgentHeartbeat, AgentId, AgentPrincipal, AgentRegistration,
  AgentRegistrationResult, AgentStatus, IngestAck,
} from '../../domain/index.ts';

const WHERE = 'server/src/modules/agents/agents.service.ts';

export interface AgentsService {
  register(registration: AgentRegistration): Promise<AgentRegistrationResult>;
  list(): Promise<Agent[]>;
  get(id: AgentId): Promise<Agent | null>;
  revoke(id: AgentId): Promise<void>;
  configFor(id: AgentId): Promise<AgentConfig>;
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

/** a token an agent keeps: 32 random bytes, url-safe. */
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
     * TODO(implement): enrol an agent.
     *
     *   1. check `registration.joinToken` against `config.agents.joinToken`
     *      (constant time, see `hashToken`/`sameHash` in agents.auth.ts) and
     *      refuse with 401 when it does not match or is not configured at all —
     *      an api that enrols anybody is an open door into the graph
     *   2. if a non-revoked agent already exists for `registration.hostId`,
     *      decide: return 409, or replace it (re-install case). Replacing is
     *      friendlier; log it either way
     *   3. build the agent: `id: randomUUID()` (node:crypto),
     *      `enrolledAt: new Date().toISOString()`,
     *      `lastSeenAt: null`, `status: 'pending'`
     *   4. `const token = mintToken()` → store only `hashToken(token)` via
     *      `store.agents.create(agent, hash)`
     *   5. return agent + credentials + `defaultConfig(config)`; this is the only
     *      response that ever contains the plaintext token
     */
    register: async (registration) => {
      log.info('enrolment attempt', { hostId: registration.hostId, name: registration.name });
      throw notImplemented('agent enrolment', `${WHERE} → register`);
    },

    list: async () => {
      const agents = await store.agents.list();
      const at = Date.now();
      return agents.map((a) => ({
        ...a,
        status: deriveStatus(a, at, config.agents.heartbeatTimeoutSeconds),
      }));
    },

    get: async (id) => {
      const agent = await store.agents.get(id);
      if (!agent) return null;
      return {
        ...agent,
        status: deriveStatus(agent, Date.now(), config.agents.heartbeatTimeoutSeconds),
      };
    },

    /**
     * TODO(implement): revoke.
     *
     * `store.agents.revoke(id)` and decide what happens to the host: keeping its
     * inventory (so the graph stays complete but goes stale) is usually right;
     * removing it is `store.inventory.removeHost`. Both are defensible — pick one
     * and document it in the ui.
     */
    revoke: async (id) => {
      log.info('revoke requested', { agentId: id });
      throw notImplemented('agent revocation', `${WHERE} → revoke`);
    },

    configFor: async (id) => {
      const stored = await store.agents.getConfig(id);
      return stored ?? defaultConfig(config);
    },

    /**
     * TODO(implement): heartbeat.
     *
     * The cheapest endpoint there is: `store.agents.touch(agentId, now)` and an
     * ack. Its value is that a host with nothing to report still proves it is
     * alive — which is what turns a missing report into a `down` host instead of
     * a silent one.
     */
    heartbeat: async (principal, beat) => {
      log.debug('heartbeat', { agentId: principal.agentId, hostId: beat.hostId });
      throw notImplemented('heartbeat', `${WHERE} → heartbeat`);
    },
  };
}
