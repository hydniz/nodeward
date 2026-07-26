// ---------------------------------------------------------------------------
// agents: the programs that report
//
// Lifecycle the api is built around:
//
//   1. enrol   POST /api/agents/register        (join token → agent + token)
//   2. pull     GET /api/agents/:id/config      (what and how often to collect)
//   3. report  POST /api/agents/:id/inventory   (facts, on change)
//              POST /api/agents/:id/health      (samples, every interval)
//              POST /api/agents/:id/events      (things that happened)
//              POST /api/agents/:id/heartbeat   (liveness when nothing changed)
//   4. retire  DELETE /api/agents/:id           (operator revokes the token)
//
// The agent id is issued by the server; the host id is chosen by the agent (it
// knows its own hostname) and must be stable across restarts, because every
// piece of inventory hangs off it.
// ---------------------------------------------------------------------------

import type {
  AgentId, HostId, Seconds, Timestamp,
} from './common.ts';

export type AgentStatus =
  /** reported within the heartbeat window. */
  | 'online'
  /** enrolled, but nothing heard for longer than the window. */
  | 'stale'
  /** enrolled and never reported. */
  | 'pending'
  /** token revoked; reports are refused. */
  | 'revoked';

export interface Agent {
  id: AgentId;
  hostId: HostId;
  /** display name, usually the hostname the agent runs on. */
  name: string;
  version: string;
  /** `linux/x86_64`, `linux/aarch64`, … */
  platform?: string;
  enrolledAt: Timestamp;
  lastSeenAt: Timestamp | null;
  status: AgentStatus;
  /** free labels an operator can filter by (`site=dorm`, `role=nas`). */
  labels?: Record<string, string>;
}

/** what an agent sends to enrol itself. */
export interface AgentRegistration {
  /** shared secret from the install command; see `config.agents.joinToken`. */
  joinToken: string;
  hostId: HostId;
  name: string;
  version: string;
  platform?: string;
  labels?: Record<string, string>;
}

/** what it gets back — the only time the server hands out a token. */
export interface AgentCredentials {
  agentId: AgentId;
  /** bearer token for every later request. Store hashed, return once. */
  token: string;
  /** null when tokens do not expire. */
  expiresAt: Timestamp | null;
}

export interface AgentRegistrationResult {
  agent: Agent;
  credentials: AgentCredentials;
  config: AgentConfig;
}

/**
 * The server tells the agent what to do, so collection can be changed centrally
 * without touching hosts. Pulled on start and after every config change.
 */
export interface AgentConfig {
  /** how often to send a health report. */
  intervalSeconds: Seconds;
  /** how often to re-send the full inventory even when nothing changed. */
  inventoryIntervalSeconds: Seconds;
  collect: {
    host: boolean;
    services: boolean;
    interfaces: boolean;
    dns: boolean;
  };
  /** metric names the server actually wants; empty means "everything". */
  metrics: string[];
  /** samples may be batched up to this many before a push. */
  maxBatch: number;
}

/** liveness ping when there is nothing else to say. */
export interface AgentHeartbeat {
  hostId: HostId;
  at: Timestamp;
  version?: string;
  /** seconds the agent process has been running. */
  uptimeSeconds?: number;
}

/**
 * Envelope for `POST /api/agents/:agentId/batch`: one request that carries
 * several reports, so an agent that was offline can catch up in one round trip.
 * Order matters — apply in array order, stop at the first rejected item.
 */
export interface AgentBatch {
  hostId: HostId;
  sentAt: Timestamp;
  items: AgentBatchItem[];
}

export type AgentBatchItem =
  | { kind: 'inventory'; payload: unknown }
  | { kind: 'health'; payload: unknown }
  | { kind: 'events'; payload: unknown[] }
  | { kind: 'heartbeat'; payload: unknown };

/** the identity a request was authenticated as (see `agents.auth.ts`). */
export interface AgentPrincipal {
  agentId: AgentId;
  hostId: HostId;
  /** true while the api runs without a configured token (development only). */
  unauthenticated: boolean;
}
