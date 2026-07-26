// ---------------------------------------------------------------------------
// agent authentication
//
// Every agent request carries `Authorization: Bearer <token>`. The token is
// issued once at enrolment and stored hashed — the server never keeps the
// plaintext, exactly like a password.
//
// Two middlewares:
//   requireAgent    — for /api/agents/:agentId/*  (the reporting endpoints)
//   requireOperator — for the human-facing management endpoints
//
// What is implemented here is the *plumbing*: pulling the token out, hashing it,
// deciding what a missing configuration means. Who owns which token is a store
// lookup and therefore a seam.
// ---------------------------------------------------------------------------

import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Config } from '../../config.ts';
import type { Logger } from '../../core/logger.ts';
import { notImplemented, unauthorized } from '../../core/errors.ts';
import { asAgentId, asHostId } from '../../domain/common.ts';
import type { AgentPrincipal } from '../../domain/index.ts';
import type { Store } from '../../store/index.ts';

const PRINCIPAL = Symbol('nodeward.agent');

/** the authenticated agent, for handlers that need to know who reported. */
export function principalOf(req: Request): AgentPrincipal {
  const p = (req as Request & { [PRINCIPAL]?: AgentPrincipal })[PRINCIPAL];
  if (!p) throw unauthorized('no agent principal on this request');
  return p;
}

/** tokens are compared as sha-256 hashes, in constant time. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const sameHash = (a: string, b: string): boolean => {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

function bearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme?.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
}

export function requireAgent(config: Config, store: Store, log: Logger): RequestHandler {
  const warnOnce = new Set<string>();

  return (req: Request, _res: Response, next: NextFunction) => {
    const run = async () => {
      const token = bearer(req);
      const routeAgentId = req.params.agentId ? asAgentId(req.params.agentId) : null;

      // development shortcut: one shared token for every agent, from
      // AGENT_TOKEN. Good enough to get an agent talking, never for production.
      if (config.agents.sharedToken) {
        if (!token || !sameHash(hashToken(token), hashToken(config.agents.sharedToken))) {
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

      /**
       * TODO(implement): the real lookup.
       *
       *   const agent = await store.agents.findByTokenHash(hashToken(token));
       *   if (!agent) throw unauthorized('unknown agent token');
       *   if (agent.status === 'revoked') throw forbidden('agent revoked');
       *   if (routeAgentId && agent.id !== routeAgentId) {
       *     throw forbidden('token does not belong to this agent');
       *   }
       *   set the principal from `agent` (never from the request body) and
       *   `store.agents.touch(agent.id, new Date().toISOString())`.
       *
       * `forbidden()` and `unauthorized()` from `core/errors.ts` are the two
       * answers this should ever give.
       *
       * The last point is the one that matters for security: a report is only
       * ever applied to the host the *token* owns, never to the host id the
       * payload claims. Otherwise one agent could overwrite another's inventory.
       */
      throw notImplemented(
        'per-agent token authentication',
        'server/src/modules/agents/agents.auth.ts → requireAgent',
      );
    };
    run().catch(next);
  };
}

/**
 * Guard for the endpoints a human calls (listing and revoking agents).
 *
 * TODO(implement): whatever the ui ends up using — a session cookie, an api key
 * from `settings`, oidc. Until then the guard is a single documented gate: open
 * while developing, closed in production.
 */
export function requireOperator(config: Config, log: Logger): RequestHandler {
  let warned = false;
  return (req: Request, _res: Response, next: NextFunction) => {
    if (config.env !== 'production') {
      if (!warned) {
        warned = true;
        log.warn('operator endpoints are unauthenticated in development');
      }
      return next();
    }
    return next(notImplemented(
      'operator authentication',
      'server/src/modules/agents/agents.auth.ts → requireOperator',
    ));
  };
}
