// ---------------------------------------------------------------------------
// the spec for the inventory ingest
//
// Two groups:
//
//   • "validation" — the schema rebuilds every report field by field and
//     refuses garbage at the seam, before anything reaches the store
//   • "behaviour" — what an accepted snapshot does to the world: replace,
//     merge, drop, stamp
//
// Everything goes through http (supertest against the real app), because that
// is the path an agent takes: auth → validator → 403 guard → service → store.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { asHostId } from '../../domain/common.ts';
import { createTestApp } from '../../test/harness.ts';
import { sampleReport } from '../../test/inventory.fixture.ts';

const post = (app: Express, body: unknown) => request(app)
  .post('/api/agents/testbox/inventory')
  .send(body as object);

describe('inventory ingest — validation', () => {
  it('refuses a body that is not an object', async () => {
    const { app } = await createTestApp();
    const res = await post(app, [1, 2, 3]);
    expect(res.status).toBe(400);
  });

  it('refuses a report without hostId', async () => {
    const { app } = await createTestApp();
    const { hostId, ...withoutHostId } = sampleReport();
    const res = await post(app, withoutHostId);
    expect(res.status).toBe(400);
  });

  it('refuses a non-canonical hostId (uppercase, dots, whitespace)', async () => {
    const { app } = await createTestApp();
    for (const bad of ['Testbox', 'test box', 'test.box', '-testbox']) {
      const report = { ...sampleReport(), hostId: bad };
      report.host = { ...report.host, id: bad as typeof report.host.id };
      const res = await request(app).post(`/api/agents/${encodeURIComponent(bad)}/inventory`).send(report);
      expect(res.status, `hostId '${bad}'`).toBe(400);
    }
  });

  it('refuses a report whose host.id disagrees with hostId', async () => {
    const { app } = await createTestApp();
    const report = sampleReport();
    report.host = { ...report.host, id: asHostId('someone-else') };
    const res = await post(app, report);
    expect(res.status).toBe(400);
  });

  it('refuses collections that are not arrays', async () => {
    const { app } = await createTestApp();
    const res = await post(app, { ...sampleReport(), edges: 'oops' });
    expect(res.status).toBe(400);
  });

  it('refuses a collectedAt that does not parse or lies in the future', async () => {
    const { app } = await createTestApp();
    expect((await post(app, sampleReport({ collectedAt: 'yesterday-ish' }))).status).toBe(400);
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect((await post(app, sampleReport({ collectedAt: future }))).status).toBe(400);
  });

  it('refuses an edge that claims another host', async () => {
    const { app } = await createTestApp();
    const report = sampleReport();
    report.edges![0] = { ...report.edges![0]!, server: asHostId('atlas') };
    const res = await post(app, report);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('reporting host');
  });

  it('refuses an edge pointing at an interface the report does not declare', async () => {
    const { app } = await createTestApp();
    const report = sampleReport();
    report.edges![0] = { ...report.edges![0]!, iface: 'ghost0' as never };
    const res = await post(app, report);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('unknown interface');
  });

  it('refuses a chip referencing a service that does not exist', async () => {
    const { app } = await createTestApp();
    const report = sampleReport();
    report.host = {
      ...report.host,
      chips: [{ ...report.host.chips[0]!, nodes: ['ngx', 'ghost'] }],
    };
    const res = await post(app, report);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('unknown service node');
  });

  it('refuses duplicate ids within a collection', async () => {
    const { app } = await createTestApp();
    const report = sampleReport();
    report.host = { ...report.host, nodes: [...report.host.nodes, ...report.host.nodes] };
    const res = await post(app, report);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('duplicate id');
  });

  it('refuses a network with a non-hex color', async () => {
    const { app } = await createTestApp();
    const report = sampleReport();
    report.networks![0] = { ...report.networks![0]!, color: 'javascript:alert(1)' };
    const res = await post(app, report);
    expect(res.status).toBe(400);
  });

  it('refuses strings with control characters', async () => {
    const { app } = await createTestApp();
    const report = sampleReport();
    report.host = { ...report.host, name: `test${String.fromCharCode(7)}box` };
    const res = await post(app, report);
    expect(res.status).toBe(400);
  });
});

describe('inventory ingest — behaviour', () => {
  it('accepts a snapshot and the host appears in /api/servers', async () => {
    const { app } = await createTestApp();
    const res = await post(app, sampleReport());
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ accepted: true, hostId: 'testbox' });

    const host = await request(app).get('/api/servers/testbox');
    expect(host.status).toBe(200);
    expect(host.body.name).toBe('testbox');
    expect(host.body.nodes).toHaveLength(1);
    expect(host.body.status).toBe('up');
  });

  it('projects the reported service into /api/services', async () => {
    const { app } = await createTestApp();
    await post(app, sampleReport());
    const res = await request(app).get('/api/services/testbox.ngx');
    expect(res.status).toBe(200);
    expect(res.body.hostId).toBe('testbox');
  });

  it('the new host shows up in the laid-out topology', async () => {
    const { app } = await createTestApp({ DEMO_DATA: 'true' });
    await post(app, sampleReport());
    const res = await request(app).get('/api/topology');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain('testbox');
  });

  it('is a snapshot: what the next report omits is gone', async () => {
    const { app } = await createTestApp();
    await post(app, sampleReport());
    const empty = sampleReport({ edges: [] });
    empty.host = {
      ...empty.host, chips: [], nodes: [], interfaces: [], netBadges: [],
    };
    expect((await post(app, empty)).status).toBe(202);

    const host = await request(app).get('/api/servers/testbox');
    expect(host.status).toBe(200);
    expect(host.body.nodes).toHaveLength(0);
    expect((await request(app).get('/api/services/testbox.ngx')).status).toBe(404);
  });

  it('replacing twice does not duplicate anything (idempotent retries)', async () => {
    const { app } = await createTestApp();
    await post(app, sampleReport());
    await post(app, sampleReport());
    const res = await request(app).get('/api/servers');
    const testboxes = res.body.servers.filter((s: { id: string }) => s.id === 'testbox');
    expect(testboxes).toHaveLength(1);
    expect(testboxes[0].nodes).toHaveLength(1);
  });

  it('leaves other hosts untouched', async () => {
    const { app } = await createTestApp({ DEMO_DATA: 'true' });
    await post(app, sampleReport());
    const atlas = await request(app).get('/api/servers/atlas');
    expect(atlas.status).toBe(200);
    expect(atlas.body.nodes.length).toBeGreaterThan(0);
  });

  it('merges networks by id instead of deleting them', async () => {
    const { app } = await createTestApp({ DEMO_DATA: 'true' });
    await post(app, sampleReport());
    const res = await request(app).get('/api/networks');
    const ids = res.body.networks.map((n: { id: string }) => n.id);
    expect(ids).toContain('lan'); // merged, still one entry
    expect(ids.filter((id: string) => id === 'lan')).toHaveLength(1);
    expect(ids).toContain('tailnet'); // untouched by testbox's report
  });

  it('drops edges into networks nobody knows, but accepts the report', async () => {
    const { app } = await createTestApp({ DEMO_DATA: 'true' });
    const report = sampleReport({ networks: [] });
    report.edges = [
      report.edges![0]!, // lan exists in the demo data → kept
      { ...report.edges![0]!, id: 'testbox-ghost-edge', net: 'ghost-net' as never },
    ];
    expect((await post(app, report)).status).toBe(202);
    const topology = await request(app).get('/api/topology');
    expect(JSON.stringify(topology.body)).not.toContain('ghost-net');
  });

  it('bumps inventoryChangedAt so the topology cache recomputes', async () => {
    const { app } = await createTestApp();
    const before = await request(app).get('/api/meta');
    await post(app, sampleReport());
    const after = await request(app).get('/api/meta');
    expect(after.body.inventoryChangedAt).not.toBe(before.body.inventoryChangedAt);
  });

  it('removeHost forgets the host and what points at it', async () => {
    const { app, store } = await createTestApp();
    await post(app, sampleReport());
    await store.inventory.removeHost(asHostId('testbox'));
    expect((await request(app).get('/api/servers/testbox')).status).toBe(404);
    // the shared network survives the host
    const nets = await request(app).get('/api/networks');
    expect(nets.body.networks.map((n: { id: string }) => n.id)).toContain('lan');
  });

  // becomes constructible with per-agent tokens (roadmap step 2): with the
  // shared/dev token the principal's host is derived from the body, so a
  // mismatch cannot be produced from the outside
  it.todo('refuses a report whose hostId is not the host the token owns (403)');
});
