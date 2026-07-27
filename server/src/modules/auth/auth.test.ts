// ---------------------------------------------------------------------------
// the spec for the admin session
//
// The claims that matter:
//
//   • with ADMIN_PASSWORD set, everything a human reads is a 401 without a
//     session — including /api/meta and the operator endpoints
//   • agents are untouched by all of it: bearer tokens keep working while the
//     humans are locked out
//   • login is rate limited and answers nothing more specific than 401
//   • without a password the api stays open (development), and /api/auth/me
//     says so, which is how the ui knows not to render a login form
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp } from '../../test/harness.ts';
import { sampleReport } from '../../test/inventory.fixture.ts';

const PASSWORD = 'correct-horse-battery';
const JOIN = 'join-secret-for-tests';

const login = (app: Express, password: string) => request(app)
  .post('/api/auth/login').send({ password });

/** log in and hand back the cookie header value for later requests. */
async function session(app: Express): Promise<string> {
  const res = await login(app, PASSWORD);
  expect(res.status).toBe(204);
  const cookie = res.headers['set-cookie']?.[0];
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Lax');
  return cookie!.split(';')[0]!;
}

describe('admin session — the gate', () => {
  it('locks the read api, meta and operator endpoints without a session', async () => {
    const { app } = await createTestApp({ ADMIN_PASSWORD: PASSWORD });
    for (const path of ['/api/servers', '/api/topology', '/api/summary', '/api/meta', '/api/agents']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
    }
  });

  it('opens after a login and closes again after logout', async () => {
    const { app } = await createTestApp({ ADMIN_PASSWORD: PASSWORD, DEMO_DATA: 'true' });
    const cookie = await session(app);

    const servers = await request(app).get('/api/servers').set('cookie', cookie);
    expect(servers.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('cookie', cookie);
    expect(me.body).toEqual({ required: true, authenticated: true });

    await request(app).post('/api/auth/logout').set('cookie', cookie);
    expect((await request(app).get('/api/servers').set('cookie', cookie)).status).toBe(401);
  });

  it('refuses a wrong password with nothing but a 401', async () => {
    const { app } = await createTestApp({ ADMIN_PASSWORD: PASSWORD });
    const res = await login(app, 'not-the-password');
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rate limits login attempts', async () => {
    const { app } = await createTestApp({ ADMIN_PASSWORD: PASSWORD });
    for (let i = 0; i < 5; i += 1) {
      expect((await login(app, 'guess')).status).toBe(401);
    }
    expect((await login(app, 'guess')).status).toBe(429);
    // the right password is refused too while the window lasts
    expect((await login(app, PASSWORD)).status).toBe(429);
  });

  it('a made-up session cookie is not a session', async () => {
    const { app } = await createTestApp({ ADMIN_PASSWORD: PASSWORD });
    const res = await request(app).get('/api/servers')
      .set('cookie', 'nodeward_session=definitely-forged');
    expect(res.status).toBe(401);
  });

  it('stays open while developing without a password, and /me says so', async () => {
    const { app } = await createTestApp();
    expect((await request(app).get('/api/servers')).status).toBe(200);
    const me = await request(app).get('/api/auth/me');
    expect(me.body).toEqual({ required: false, authenticated: true });
  });
});

describe('admin session — agents are unaffected', () => {
  it('bearer-token agents keep reporting while humans are locked out', async () => {
    const { app } = await createTestApp({ ADMIN_PASSWORD: PASSWORD, AGENT_JOIN_TOKEN: JOIN });

    const enrolled = await request(app).post('/api/agents/register').send({
      joinToken: JOIN, hostId: 'testbox', name: 'testbox', version: '1.0.0',
    });
    expect(enrolled.status).toBe(201);
    const { agentId, token } = enrolled.body.credentials;

    const report = await request(app)
      .post(`/api/agents/${agentId}/inventory`)
      .set('authorization', `Bearer ${token}`)
      .send(sampleReport());
    expect(report.status).toBe(202);

    // and the other way round: the agent's token opens no human doors
    const asAgent = await request(app).get('/api/servers')
      .set('authorization', `Bearer ${token}`);
    expect(asAgent.status).toBe(401);
  });

  it('operator endpoints take the session, not an agent token', async () => {
    const { app } = await createTestApp({ ADMIN_PASSWORD: PASSWORD, AGENT_JOIN_TOKEN: JOIN });
    await request(app).post('/api/agents/register').send({
      joinToken: JOIN, hostId: 'testbox', name: 'testbox', version: '1.0.0',
    });
    const cookie = await session(app);
    const list = await request(app).get('/api/agents').set('cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.agents).toHaveLength(1);
  });
});
