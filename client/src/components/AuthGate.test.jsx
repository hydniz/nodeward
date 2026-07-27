import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthGate from './AuthGate.jsx';
import { announceUnauthorized } from '../auth.js';

/** stub fetch per test: `routes` maps "METHOD path" → response. */
function stubFetch(routes) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (path, init = {}) => {
    const key = `${init.method ?? 'GET'} ${path}`;
    calls.push(key);
    const route = routes[key];
    if (!route) throw new Error(`no stub for ${key}`);
    return {
      ok: route.status < 400,
      status: route.status,
      statusText: '',
      json: async () => route.body ?? {},
    };
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('AuthGate', () => {
  it('renders the app directly when no login is required', async () => {
    stubFetch({ 'GET /api/auth/me': { status: 200, body: { required: false, authenticated: true } } });
    render(<AuthGate><div>the dashboard</div></AuthGate>);
    expect(await screen.findByText('the dashboard')).toBeInTheDocument();
  });

  it('shows the login instead of the app when the session is missing', async () => {
    stubFetch({ 'GET /api/auth/me': { status: 200, body: { required: true, authenticated: false } } });
    render(<AuthGate><div>the dashboard</div></AuthGate>);
    expect(await screen.findByLabelText('password')).toBeInTheDocument();
    expect(screen.queryByText('the dashboard')).not.toBeInTheDocument();
  });

  it('logs in and swaps to the app', async () => {
    stubFetch({
      'GET /api/auth/me': { status: 200, body: { required: true, authenticated: false } },
      'POST /api/auth/login': { status: 204 },
    });
    render(<AuthGate><div>the dashboard</div></AuthGate>);
    await userEvent.type(await screen.findByLabelText('password'), 'secret-enough');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('the dashboard')).toBeInTheDocument();
  });

  it('shows the wrong-password answer and stays on the login', async () => {
    stubFetch({
      'GET /api/auth/me': { status: 200, body: { required: true, authenticated: false } },
      'POST /api/auth/login': { status: 401 },
    });
    render(<AuthGate><div>the dashboard</div></AuthGate>);
    await userEvent.type(await screen.findByLabelText('password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('wrong password')).toBeInTheDocument();
    expect(screen.queryByText('the dashboard')).not.toBeInTheDocument();
  });

  it('falls back to the login when a 401 arrives mid-session', async () => {
    stubFetch({ 'GET /api/auth/me': { status: 200, body: { required: true, authenticated: true } } });
    render(<AuthGate><div>the dashboard</div></AuthGate>);
    expect(await screen.findByText('the dashboard')).toBeInTheDocument();

    announceUnauthorized();
    await waitFor(() => expect(screen.queryByText('the dashboard')).not.toBeInTheDocument());
    expect(screen.getByLabelText('password')).toBeInTheDocument();
  });
});
