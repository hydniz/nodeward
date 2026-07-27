// ---------------------------------------------------------------------------
// the spec for agent enrolment, per-agent auth, heartbeat and revocation
//
// Everything goes through http (supertest against the real app), because that
// is the path an agent takes: join token → credentials → bearer token on every
// later request. The join token for these tests comes from the env override
// the harness supports; no AGENT_TOKEN is set, so the real per-agent lookup
// runs (not the shared-token development shortcut).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { asAgentId } from '../../domain/common.ts';
import { createTestApp } from '../../test/harness.ts';
import { sampleReport } from '../../test/inventory.fixture.ts';

// long enough to satisfy the production strength check, so the same secret
// works for the NODE_ENV=production cases below
const JOIN = 'join-secret-for-tests';

const register = (app: Express, overrides: Record<string, unknown> = {}) => request(app)
  .post('/api/agents/register')
  .send({
    joinToken: JOIN, hostId: 'testbox', name: 'testbox', version: '1.0.0', ...overrides,
  });

/** enrol and hand back what later requests need. */
async function enrol(app: Express, overrides: Record<string, unknown> = {}) {
  const res = await register(app, overrides);
  expect(res.status).toBe(201);
  return res.body.credentials as { agentId: string; token: string };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('enrolment', () => {
  it('is closed while no join token is configured', async () => {
    const { app } = await createTestApp();
    const res = await register(app);
    expect(res.status).toBe(401);
  });

  it('refuses a wrong join token', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const res = await register(app, { joinToken: 'guess' });
    expect(res.status).toBe(401);
  });

  it('refuses a malformed registration before checking anything else', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    expect((await register(app, { hostId: 'Test.Box' })).status).toBe(400);
    expect((await register(app, { name: '' })).status).toBe(400);
    expect((await register(app, { version: undefined })).status).toBe(400);
    expect((await register(app, { labels: { site: '' } })).status).toBe(400);
  });

  it('answers 201 with agent, one-time token and the collector config', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const res = await register(app, { platform: 'linux/x86_64', labels: { site: 'dorm' } });
    expect(res.status).toBe(201);
    expect(res.body.agent).toMatchObject({
      hostId: 'testbox', name: 'testbox', version: '1.0.0', status: 'pending', lastSeenAt: null,
    });
    expect(res.body.credentials.agentId).toBe(res.body.agent.id);
    expect(typeof res.body.credentials.token).toBe('string');
    expect(res.body.credentials.token.length).toBeGreaterThanOrEqual(32);
    expect(res.body.config.intervalSeconds).toBeGreaterThan(0);
    expect(res.body.config.collect.services).toBe(true);
  });

  it('never stores the plaintext token', async () => {
    const { app, store } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const { token } = await enrol(app);
    // the repository only knows hashes: looking the plaintext up as if it were
    // a hash must find nothing
    expect(await store.agents.findByTokenHash(token)).toBeNull();
  });

  it('rate limits enrolment attempts per ip', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN, REGISTER_RATE_LIMIT: '3' });
    for (let i = 0; i < 3; i += 1) {
      // wrong join token on purpose: the limiter must count *attempts*, not
      // successes — brute force is nothing but failed attempts
      expect((await register(app, { joinToken: 'guess' })).status).toBe(401);
    }
    expect((await register(app, { joinToken: 'guess' })).status).toBe(429);
    // the right token is refused too while the window lasts
    expect((await register(app)).status).toBe(429);
  });

  it('re-enrolling a host replaces the agent and kills the old token', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const first = await enrol(app);
    const second = await enrol(app);
    expect(second.agentId).not.toBe(first.agentId);

    const list = await request(app).get('/api/agents');
    expect(list.body.agents).toHaveLength(1);
    expect(list.body.agents[0].id).toBe(second.agentId);

    const oldToken = await request(app)
      .get(`/api/agents/${first.agentId}/config`).set(bearer(first.token));
    expect(oldToken.status).toBe(401);
    const newToken = await request(app)
      .get(`/api/agents/${second.agentId}/config`).set(bearer(second.token));
    expect(newToken.status).toBe(200);
  });
});

describe('per-agent authentication', () => {
  it('accepts the minted token and reports the agent online afterwards', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const { agentId, token } = await enrol(app);
    const res = await request(app).get(`/api/agents/${agentId}/config`).set(bearer(token));
    expect(res.status).toBe(200);

    const agent = await request(app).get(`/api/agents/${agentId}`);
    expect(agent.body.status).toBe('online');
    expect(agent.body.lastSeenAt).not.toBeNull();
  });

  it('refuses an unknown token', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const { agentId } = await enrol(app);
    const res = await request(app)
      .get(`/api/agents/${agentId}/config`).set(bearer('not-a-real-token'));
    expect(res.status).toBe(401);
  });

  it("refuses a token used against another agent's route", async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const a = await enrol(app, { hostId: 'host-a', name: 'host-a' });
    const b = await enrol(app, { hostId: 'host-b', name: 'host-b' });
    const res = await request(app)
      .get(`/api/agents/${b.agentId}/config`).set(bearer(a.token));
    expect(res.status).toBe(403);
  });

  it('requires a token in production instead of the open development mode', async () => {
    const { app } = await createTestApp({
      NODE_ENV: 'production', AGENT_JOIN_TOKEN: JOIN, AUTH_DISABLED: 'true',
    });
    const { agentId } = await enrol(app);
    const res = await request(app).get(`/api/agents/${agentId}/config`);
    expect(res.status).toBe(401);
  });
});

describe('heartbeat', () => {
  const beat = (hostId = 'testbox') => ({ hostId, at: new Date().toISOString() });

  it('acks, bumps lastSeenAt, and asks for inventory while the host is unknown', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const { agentId, token } = await enrol(app);
    const res = await request(app)
      .post(`/api/agents/${agentId}/heartbeat`).set(bearer(token)).send(beat());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      accepted: 1, rejected: 0, agentId, wantInventory: true,
    });

    const agent = await request(app).get(`/api/agents/${agentId}`);
    expect(agent.body.status).toBe('online');
  });

  it('stops asking for inventory once the host has reported facts', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const { agentId, token } = await enrol(app);
    const posted = await request(app)
      .post(`/api/agents/${agentId}/inventory`).set(bearer(token)).send(sampleReport());
    expect(posted.status).toBe(202);

    const res = await request(app)
      .post(`/api/agents/${agentId}/heartbeat`).set(bearer(token)).send(beat());
    expect(res.status).toBe(200);
    expect(res.body.wantInventory).toBeUndefined();
  });

  it('refuses a heartbeat claiming a host the token does not own', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const { agentId, token } = await enrol(app);
    const res = await request(app)
      .post(`/api/agents/${agentId}/heartbeat`).set(bearer(token)).send(beat('someone-else'));
    expect(res.status).toBe(403);
  });

  it('refuses a heartbeat without a parseable timestamp', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const { agentId, token } = await enrol(app);
    const res = await request(app)
      .post(`/api/agents/${agentId}/heartbeat`).set(bearer(token))
      .send({ hostId: 'testbox', at: 'five minutes ago' });
    expect(res.status).toBe(400);
  });
});

describe('revocation', () => {
  it('revokes the token but keeps the host in the graph', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const { agentId, token } = await enrol(app);
    await request(app)
      .post(`/api/agents/${agentId}/inventory`).set(bearer(token)).send(sampleReport());

    const del = await request(app).delete(`/api/agents/${agentId}`);
    expect(del.status).toBe(204);

    const agent = await request(app).get(`/api/agents/${agentId}`);
    expect(agent.body.status).toBe('revoked');

    const refused = await request(app)
      .get(`/api/agents/${agentId}/config`).set(bearer(token));
    expect(refused.status).toBe(403);

    // the inventory stays: revocation cuts a credential, not a machine
    const host = await request(app).get('/api/servers/testbox');
    expect(host.status).toBe(200);
  });

  it('answers 404 for an agent nobody enrolled', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const res = await request(app).delete('/api/agents/ghost');
    expect(res.status).toBe(404);
  });

  it('a revoked host can re-enrol with the join token', async () => {
    const { app, store } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const first = await enrol(app);
    await request(app).delete(`/api/agents/${first.agentId}`);

    const second = await enrol(app);
    const res = await request(app)
      .get(`/api/agents/${second.agentId}/config`).set(bearer(second.token));
    expect(res.status).toBe(200);
    // the revoked row is gone, not lingering next to the new one
    expect(await store.agents.get(asAgentId(first.agentId))).toBeNull();
  });
});
