import React, { useEffect, useState } from 'react';
import { fetchAuthState, login, UNAUTHORIZED_EVENT } from '../auth.js';
import { clearApiCache } from '../api.js';

/**
 * Sits between the router and the app: asks the server whether this browser
 * is trusted (`/api/auth/me`) and renders either the dashboard or the login.
 *
 * Three states: `checking` (first paint, nothing flashes), `open`, `login`.
 * A 401 from anywhere in the app (session expired, server restarted) fires
 * UNAUTHORIZED_EVENT and flips the gate back to the login without losing the
 * url — after the next successful login the same page loads again.
 */
export default function AuthGate({ children }) {
  const [state, setState] = useState('checking');

  useEffect(() => {
    let alive = true;
    fetchAuthState()
      .then((me) => alive && setState(me.required && !me.authenticated ? 'login' : 'open'))
      // an unreachable api is not a login problem — let the app render and
      // surface its own errors
      .catch(() => alive && setState('open'));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setState('login');
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (state === 'checking') return null;
  if (state === 'open') return children;
  return (
    <LoginScreen
      onSuccess={() => {
        clearApiCache();
        setState('open');
      }}
    />
  );
}

function LoginScreen({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
      onSuccess();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="brand login-brand">
          <span className="brand-mark">n</span>
          <span className="brand-name">nodeward</span>
        </div>
        <label className="login-label" htmlFor="login-password">password</label>
        <input
          id="login-password"
          className="login-input"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="login-error">{error}</div>}
        <button className="btn login-btn" type="submit" disabled={busy || !password}>
          {busy ? 'signing in…' : 'sign in'}
        </button>
      </form>
    </div>
  );
}
