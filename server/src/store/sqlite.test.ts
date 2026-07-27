// ---------------------------------------------------------------------------
// the spec for the sqlite driver
//
// Two claims are worth proving:
//
//   • equivalence — the same http flows that pass against the memory store
//     pass against sqlite: enrolment, auth, inventory snapshot semantics.
//     The merge logic is shared (`facts.ts`), but the sql around it is not,
//     and this is what pins it.
//   • durability — the reason the driver exists: a store closed and reopened
//     on the same file still knows its agents (token hashes included) and its
//     inventory. The memory driver cannot pass this test; sqlite must.
//
// In-memory sqlite (`:memory:`) keeps the equivalence tests fast; the
// durability test uses a real file in a temp directory.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { asAgentId, asHostId } from '../domain/common.ts';
import { createTestApp } from '../test/harness.ts';
import { sampleReport } from '../test/inventory.fixture.ts';

const JOIN = 'join-secret-for-tests';

const sqliteEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  STORE_DRIVER: 'sqlite', SQLITE_PATH: ':memory:', AGENT_JOIN_TOKEN: JOIN, ...extra,
});

describe('sqlite driver — same behaviour as memory', () => {
  it('applies an inventory snapshot and serves it back', async () => {
    const { app } = await createTestApp(sqliteEnv());
    const res = await request(app).post('/api/agents/testbox/inventory').send(sampleReport());
    expect(res.status).toBe(202);

    const host = await request(app).get('/api/servers/testbox');
    expect(host.status).toBe(200);
    expect(host.body.nodes).toHaveLength(1);
    expect((await request(app).get('/api/services/testbox.ngx')).status).toBe(200);
  });

  it('keeps snapshot semantics: what the next report omits is gone', async () => {
    const { app } = await createTestApp(sqliteEnv());
    await request(app).post('/api/agents/testbox/inventory').send(sampleReport());
    const empty = sampleReport({ edges: [] });
    empty.host = {
      ...empty.host, chips: [], nodes: [], interfaces: [], netBadges: [],
    };
    await request(app).post('/api/agents/testbox/inventory').send(empty);

    const host = await request(app).get('/api/servers/testbox');
    expect(host.body.nodes).toHaveLength(0);
    expect((await request(app).get('/api/services/testbox.ngx')).status).toBe(404);
  });

  it('merges shared networks instead of deleting them', async () => {
    const { app } = await createTestApp(sqliteEnv({ DEMO_DATA: 'true' }));
    await request(app).post('/api/agents/testbox/inventory').send(sampleReport());
    const res = await request(app).get('/api/networks');
    const ids = res.body.networks.map((n: { id: string }) => n.id);
    expect(ids.filter((id: string) => id === 'lan')).toHaveLength(1);
    expect(ids).toContain('tailnet');
  });

  it('runs the full enrolment lifecycle', async () => {
    const { app } = await createTestApp(sqliteEnv());
    const enrolled = await request(app).post('/api/agents/register').send({
      joinToken: JOIN, hostId: 'testbox', name: 'testbox', version: '1.0.0',
    });
    expect(enrolled.status).toBe(201);
    const { agentId, token } = enrolled.body.credentials;

    const ok = await request(app)
      .get(`/api/agents/${agentId}/config`).set('authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);

    expect((await request(app).delete(`/api/agents/${agentId}`)).status).toBe(204);
    const refused = await request(app)
      .get(`/api/agents/${agentId}/config`).set('authorization', `Bearer ${token}`);
    expect(refused.status).toBe(403);
  });

  it('re-enrolment replaces the row (host_id is unique)', async () => {
    const { app, store } = await createTestApp(sqliteEnv());
    const first = await request(app).post('/api/agents/register').send({
      joinToken: JOIN, hostId: 'testbox', name: 'testbox', version: '1.0.0',
    });
    const second = await request(app).post('/api/agents/register').send({
      joinToken: JOIN, hostId: 'testbox', name: 'testbox', version: '1.0.1',
    });
    expect(second.status).toBe(201);
    expect(await store.agents.list()).toHaveLength(1);
    expect(await store.agents.get(asAgentId(first.body.credentials.agentId))).toBeNull();
  });
});

describe('sqlite driver — durability', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nodeward-sqlite-'));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('survives a restart: agents, tokens and inventory are still there', async () => {
    const file = path.join(dir, 'nodeward.db');

    // first life: enrol and report
    const first = await createTestApp(sqliteEnv({ SQLITE_PATH: file }));
    const enrolled = await request(first.app).post('/api/agents/register').send({
      joinToken: JOIN, hostId: 'testbox', name: 'testbox', version: '1.0.0',
    });
    const { agentId, token } = enrolled.body.credentials;
    await request(first.app)
      .post(`/api/agents/${agentId}/inventory`)
      .set('authorization', `Bearer ${token}`)
      .send(sampleReport());
    await first.store.close();

    // second life: same file, fresh process state
    const second = await createTestApp(sqliteEnv({ SQLITE_PATH: file }));
    // the host is still in the graph
    const host = await request(second.app).get('/api/servers/testbox');
    expect(host.status).toBe(200);
    expect(host.body.nodes).toHaveLength(1);
    // the agent is still enrolled and its token still authenticates
    const config = await request(second.app)
      .get(`/api/agents/${agentId}/config`).set('authorization', `Bearer ${token}`);
    expect(config.status).toBe(200);
    const agent = await second.store.agents.get(asAgentId(agentId));
    expect(agent?.hostId).toBe(asHostId('testbox'));
    await second.store.close();
  });
});
