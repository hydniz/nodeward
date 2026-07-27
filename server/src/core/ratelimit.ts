// ---------------------------------------------------------------------------
// a small fixed-window rate limiter, per client ip
//
// Dependency-free on purpose (the server's only runtime dependency is
// express). It exists for exactly one job today: keeping the enrolment
// endpoint — the only unauthenticated write — from being brute-forced or
// hammered. It is *not* a general ddos defence; that belongs in front of the
// process (reverse proxy, firewall), not inside it.
//
// The key is `req.ip`, which is only as truthful as `TRUST_PROXY` is
// configured: with the paranoid default (false) it is the socket address and
// cannot be forged; behind a proxy the operator must set the hop count or the
// limit keys on the proxy's address (safe, but shared by all clients).
// ---------------------------------------------------------------------------

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { tooManyRequests } from './errors.ts';

/** memory bound: beyond this many distinct ips the window sweeps expired
 *  entries, and as a last resort resets — failing open is the right failure
 *  mode for a limiter (availability over a perfect count under flood). */
const MAX_KEYS = 10_000;

/**
 * Fixed-window counting: the first hit of a window stamps it, every further
 * hit within `windowMs` counts against `limit`, and the first hit after the
 * window replaces it. Cruder than a sliding window (a burst straddling the
 * boundary can reach 2×limit) — and still plenty against brute force: at 10
 * per minute a 16-char token survives the heat death of the universe.
 */
export function rateLimit({ limit, windowMs }: { limit: number; windowMs: number }): RequestHandler {
  const hits = new Map<string, { count: number; windowStart: number }>();

  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const hit = hits.get(key);

    if (!hit || now - hit.windowStart >= windowMs) {
      if (hits.size >= MAX_KEYS) {
        for (const [k, v] of hits) {
          if (now - v.windowStart >= windowMs) hits.delete(k);
        }
        if (hits.size >= MAX_KEYS) hits.clear();
      }
      hits.set(key, { count: 1, windowStart: now });
      return next();
    }

    hit.count += 1;
    if (hit.count > limit) {
      return next(tooManyRequests('too many enrolment attempts — slow down'));
    }
    return next();
  };
}
