// ---------------------------------------------------------------------------
// the session gate
//
// `requireSession` protects everything a human reads: the read api, the
// operator endpoints, /api/meta. The decision tree mirrors the agent side
// (open while developing, fail-closed in production):
//
//   1. ADMIN_PASSWORD configured → a valid session cookie or 401, always.
//   2. not configured, AUTH_DISABLED=true → open; the operator said so.
//   3. not configured, development/test → open, with one loud warning.
//   4. not configured, production → cannot happen: config.ts refuses to boot.
//
// Cookie parsing is done here by hand (a dozen lines) instead of pulling in
// cookie-parser — the server's only runtime dependency stays express.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Config } from '../../config.ts';
import type { Logger } from '../../core/logger.ts';
import { unauthorized } from '../../core/errors.ts';
import type { AuthService } from './auth.service.ts';

export const SESSION_COOKIE = 'nodeward_session';

/** the value of one cookie from the `cookie:` header, or null. Values are the
 *  base64url session ids this server minted — no decoding needed. */
export function cookieValue(req: Request, name: string): string | null {
  const header = req.header('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

export function requireSession(config: Config, auth: AuthService, log: Logger): RequestHandler {
  let warned = false;
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!auth.required()) {
      if (!config.auth.disabled && !warned) {
        warned = true;
        log.warn('ui and read api are open — set ADMIN_PASSWORD to require a login (development only; production refuses to boot like this)');
      }
      return next();
    }
    if (!auth.check(cookieValue(req, SESSION_COOKIE))) {
      // one indistinct answer for "no cookie", "unknown session" and
      // "expired" — the client's reaction is the same: show the login
      return next(unauthorized('login required'));
    }
    return next();
  };
}
