// ---------------------------------------------------------------------------
// the client side of the admin session (see server/docs/security.md)
//
// Three calls against /api/auth/*. The session itself lives in an httpOnly
// cookie — this module never sees or stores a credential; it only asks the
// server "is this browser trusted?" and forwards the password on login.
// ---------------------------------------------------------------------------

/** fired (on window) whenever any api call answers 401 — the AuthGate listens. */
export const UNAUTHORIZED_EVENT = 'nodeward:unauthorized';

export function announceUnauthorized() {
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

/** `{ required, authenticated }` — what to render: login form or dashboard. */
export async function fetchAuthState() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Exchange the password for the session cookie. Throws with a message the
 * login form can show verbatim; the 401 text is deliberately vague ("wrong
 * password") because the server refuses to be more specific.
 */
export async function login(password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (res.status === 401) throw new Error('wrong password');
  if (res.status === 429) throw new Error('too many attempts — wait a minute');
  if (!res.ok) throw new Error(`login failed (${res.status})`);
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
}
