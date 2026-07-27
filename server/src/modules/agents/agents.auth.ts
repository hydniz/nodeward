// ---------------------------------------------------------------------------
// agent authentication
//
// Every agent request carries `Authorization: Bearer <token>`. The token is
// issued once at enrolment and stored hashed — the server never keeps the
// plaintext, exactly like a password.
//
// Two middlewares, always paired on the reporting endpoints
// (/api/agents/:agentId/*): `requireAgent` decides *who* is calling, and
// `requireOwnHost` enforces that the payload does not claim to be somebody
// else. The human-facing management endpoints are guarded by the admin session
// from `modules/auth/` instead — wired together in modules/index.ts.
//
// `requireAgent` resolves the token to its agent via the store (hash lookup)
// and sets the principal from that row — never from the request body. Two
// documented development shortcuts remain: the shared AGENT_TOKEN, and the
// open no-token mode outside production.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Config } from '../../config.ts';
import type { Logger } from '../../core/logger.ts';
import { hashToken, sameSecret } from '../../core/crypto.ts';
import { forbidden, unauthorized } from '../../core/errors.ts';
import { asAgentId, asHostId } from '../../domain/common.ts';
import type { AgentPrincipal } from '../../domain/index.ts';
import type { Store } from '../../store/index.ts';

// the comparison primitives live in core/crypto.ts (shared with the admin
// login); re-exported here because they are part of this module's api surface
export { hashToken, sameHash } from '../../core/crypto.ts';

// the principal hangs on the request under a symbol so no route or middleware
// can collide with (or fake) it by setting a plain string property
const PRINCIPAL = Symbol('nodeward.agent');

/**
 * The authenticated agent, for handlers that need to know who reported.
 * Only `requireAgent` ever sets it; calling this on a route that is not behind
 * that middleware is a programming error and answers 401 instead of crashing.
 */
export function principalOf(req: Request): AgentPrincipal {
  const p = (req as Request & { [PRINCIPAL]?: AgentPrincipal })[PRINCIPAL];
  if (!p) throw unauthorized('no agent principal on this request');
  return p;
}

/**
 * Every `hostId` anywhere in a parsed json body.
 *
 * Iterative rather than recursive on purpose: the body is attacker-supplied
 * json, and a deeply nested one would blow the stack of a recursive walk.
 * Only the key name matters — `server` fields (a p2p tunnel legitimately names
 * the peer on its far end) are not `hostId` and are never collected.
 */
function claimedHostIds(body: unknown): string[] {
  const found: string[] = [];
  const stack: unknown[] = [body];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'hostId' && typeof nested === 'string') found.push(nested);
      else if (nested && typeof nested === 'object') stack.push(nested);
    }
  }
  return found;
}

/**
 * Protocol invariant 1, as middleware: **the token decides the host, never the
 * payload.**
 *
 * Mounted on every route an agent writes through, so a new ingest seam cannot
 * quietly forget the check — which is exactly what had happened to the health,
 * events and batch routes, where the invariant was documented but never coded.
 * The check runs over the whole body (`items[]` of a batch included) so it
 * covers the seams before they are implemented.
 *
 * A body that names no host at all is fine: the principal decides anyway, and
 * every service reads the host from there. Only a *disagreeing* claim is a 403
 * — "I know you, and you are not that host".
 */
export const requireOwnHost: RequestHandler = (req, _res, next) => {
  const mine = principalOf(req).hostId as string;
  for (const claimed of claimedHostIds(req.body)) {
    if (claimed !== mine) {
      next(forbidden('payload hostId does not match the host this token owns'));
      return;
    }
  }
  next();
};

/** the token from `Authorization: Bearer <token>`, or null when the header is
 *  missing or not bearer-shaped. Never throws — what a missing token means
 *  (401 or the open development mode) is `requireAgent`'s decision. */
function bearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme?.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
}

/**
 * Authentication for everything under `/api/agents/:agentId/*` — every route
 * an agent reports to. Three paths, checked in order:
 *
 *   1. `AGENT_TOKEN` configured → shared-token mode: one secret for every
 *      agent. The token cannot name a host, so the principal's host comes
 *      from the body/route — a documented compromise for laptops, never
 *      production.
 *   2. no token sent → refused in production, allowed while developing (so
 *      the api can be poked with curl), logged loudly once per route and
 *      marked `unauthenticated: true` on the principal.
 *   3. otherwise per-agent lookup: hash the token, find the agent row, refuse
 *      unknown (401) / revoked (403) / wrong route (403), build the principal
 *      from the row, stamp liveness.
 *
 * The two error answers are deliberate: 401 means "I do not know you" (get a
 * new token by re-enrolling), 403 means "I know you and the answer is no"
 * (revoked, or a token used for another agent's route).
 */
export function requireAgent(config: Config, store: Store, log: Logger): RequestHandler {
  const warnOnce = new Set<string>();

  return (req: Request, _res: Response, next: NextFunction) => {
    const run = async () => {
      const token = bearer(req);
      const routeAgentId = req.params.agentId ? asAgentId(req.params.agentId) : null;

      // development shortcut: one shared token for every agent, from
      // AGENT_TOKEN. Good enough to get an agent talking, never for production.
      if (config.agents.sharedToken) {
        if (!token || !sameSecret(token, config.agents.sharedToken)) {
          throw unauthorized('invalid agent token');
        }
        if (!routeAgentId) throw unauthorized('agent id missing from the route');
        (req as Request & { [PRINCIPAL]?: AgentPrincipal })[PRINCIPAL] = {
          agentId: routeAgentId,
          // with a shared token the server cannot know the host from the token,
          // so it trusts the route. Per-agent tokens remove this compromise.
          hostId: asHostId(String(req.body?.hostId ?? routeAgentId)),
          unauthenticated: false,
        };
        return next();
      }

      // no token configured at all: refuse in production, allow while developing
      // so the api can be poked with curl — but say so, once per route.
      if (!token) {
        if (config.env === 'production') throw unauthorized('agent token required');
        if (!warnOnce.has(req.path)) {
          warnOnce.add(req.path);
          log.warn('agent endpoint hit without a token (development only)', { path: req.path });
        }
        if (!routeAgentId) throw unauthorized('agent id missing from the route');
        (req as Request & { [PRINCIPAL]?: AgentPrincipal })[PRINCIPAL] = {
          agentId: routeAgentId,
          hostId: asHostId(String(req.body?.hostId ?? routeAgentId)),
          unauthenticated: true,
        };
        return next();
      }

      // per-agent tokens: the token names the agent, the agent row names the
      // host. The principal is built from that row and never from the request
      // body — a report is only ever applied to the host the token owns.
      const agent = await store.agents.findByTokenHash(hashToken(token));
      if (!agent) throw unauthorized('unknown agent token');
      if (agent.status === 'revoked') throw forbidden('agent revoked');
      if (routeAgentId && agent.id !== routeAgentId) {
        throw forbidden('token does not belong to this agent');
      }
      (req as Request & { [PRINCIPAL]?: AgentPrincipal })[PRINCIPAL] = {
        agentId: agent.id,
        hostId: agent.hostId,
        unauthenticated: false,
      };
      // every authenticated request proves liveness, so `lastSeenAt` (and the
      // derived online/stale status) is stamped here instead of in each service
      await store.agents.touch(agent.id, new Date().toISOString());
      return next();
    };
    run().catch(next);
  };
}

// the guard for the endpoints a human calls (listing and revoking agents) is
// the admin session — `modules/auth/auth.middleware.ts → requireSession`,
// handed to `agentRoutes` by the module registry
