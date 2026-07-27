// ---------------------------------------------------------------------------
// auth module — the admin session
//
// One password (ADMIN_PASSWORD) guards everything a human sees: the ui, the
// read api, the operator endpoints. A successful login mints a session id —
// 32 random bytes, held in an httpOnly cookie — and the session store here is
// deliberately in-memory: a deploy logs the operator out, which for a
// dashboard is a feature, not a bug (and needs no session table anywhere).
//
// Agents never touch this: their world is bearer tokens (agents.auth.ts).
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import type { Config } from '../../config.ts';
import type { Logger } from '../../core/logger.ts';
import { sameSecret } from '../../core/crypto.ts';
import { unauthorized } from '../../core/errors.ts';

/** how long a login lasts. Absolute, not sliding: after a week the operator
 *  types the password again, whatever happened in between. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** memory bound; beyond it the oldest sessions fall off. 256 concurrent
 *  operator sessions is not a small company, it is an incident. */
const MAX_SESSIONS = 256;

export interface AuthService {
  /** whether a login is required at all (password configured). */
  required(): boolean;
  /** password → session id, or a 401 that does not say which part was wrong. */
  login(password: string): string;
  /** true while the session id is known and not expired. */
  check(sessionId: string | null): boolean;
  logout(sessionId: string | null): void;
}

export function createAuthService(config: Config, log: Logger): AuthService {
  const sessions = new Map<string, { expiresAt: number }>();

  const prune = (): void => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (s.expiresAt <= now) sessions.delete(id);
    }
    // still full after dropping the expired → drop the oldest (Map preserves
    // insertion order, and sessions are inserted chronologically)
    while (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest === undefined) break;
      sessions.delete(oldest);
    }
  };

  return {
    required: () => Boolean(config.auth.adminPassword),

    login: (password) => {
      const expected = config.auth.adminPassword;
      // no password configured means there is nothing to log into — the gate
      // is open (development) or explicitly disabled; both make login moot
      if (!expected) throw unauthorized('no login is configured on this server');
      if (typeof password !== 'string' || !sameSecret(password, expected)) {
        log.warn('failed admin login');
        throw unauthorized('wrong password');
      }
      prune();
      const id = randomBytes(32).toString('base64url');
      sessions.set(id, { expiresAt: Date.now() + SESSION_TTL_MS });
      log.info('admin logged in');
      return id;
    },

    check: (sessionId) => {
      if (!sessionId) return false;
      const session = sessions.get(sessionId);
      if (!session) return false;
      if (session.expiresAt <= Date.now()) {
        sessions.delete(sessionId);
        return false;
      }
      return true;
    },

    logout: (sessionId) => {
      if (sessionId) sessions.delete(sessionId);
    },
  };
}
