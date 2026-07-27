// ---------------------------------------------------------------------------
// auth routes — the only three endpoints a browser talks to before it is
// trusted
//
//   POST /api/auth/login    {password} → session cookie        (rate limited)
//   POST /api/auth/logout   drop the session, clear the cookie
//   GET  /api/auth/me       {required, authenticated} — what the ui needs to
//                           decide between login form and dashboard
//
// The cookie is httpOnly (scripts cannot read it), SameSite=Lax (not sent on
// cross-site requests, which is the csrf defence together with the absence of
// any cors headers) and Secure whenever the session was minted over https
// (see `setSessionCookie`).
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Logger } from '../../core/logger.ts';
import { handler } from '../../core/http.ts';
import { rateLimit } from '../../core/ratelimit.ts';
import { badRequest } from '../../core/errors.ts';
import type { AuthService } from './auth.service.ts';
import { cookieValue, SESSION_COOKIE } from './auth.middleware.ts';

const WEEK_SECONDS = 7 * 24 * 60 * 60;

/**
 * `Secure` is set exactly when the login itself arrived over https
 * (`req.secure` — truthful behind a proxy once TRUST_PROXY is set): a
 * browser then refuses to send the cookie over plain http, so a tls session
 * cannot be downgraded. Keying on the request instead of on NODE_ENV keeps
 * the documented no-tls setups (trusted lan, vpn) workable — a Secure cookie
 * over plain http would never come back and the login would silently loop.
 */
function setSessionCookie(req: Request, res: Response, value: string, maxAge: number): void {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(req.secure ? ['Secure'] : []),
  ];
  res.setHeader('set-cookie', parts.join('; '));
}

export function authRoutes(auth: AuthService, log: Logger): Router {
  const router = Router();

  // tighter than enrolment: passwords are guessable in a way 256-bit tokens
  // are not, so 5 attempts per minute per ip
  const loginLimit = rateLimit({ limit: 5, windowMs: 60_000 });

  router.post('/auth/login', loginLimit, handler(async (req, res) => {
    const password = (req.body as { password?: unknown } | undefined)?.password;
    if (typeof password !== 'string' || password.length === 0 || password.length > 500) {
      throw badRequest('login needs a password field');
    }
    const session = auth.login(password);
    setSessionCookie(req, res, session, WEEK_SECONDS);
    res.status(204).end();
  }));

  router.post('/auth/logout', handler(async (req, res) => {
    auth.logout(cookieValue(req, SESSION_COOKIE));
    setSessionCookie(req, res, '', 0);
    res.status(204).end();
  }));

  // deliberately open: the ui calls it first to learn whether to show the
  // login at all. It answers about the session, never anything about the data.
  router.get('/auth/me', handler(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.json({
      required: auth.required(),
      authenticated: auth.required()
        ? auth.check(cookieValue(req, SESSION_COOKIE))
        : true,
    });
  }));

  return router;
}
