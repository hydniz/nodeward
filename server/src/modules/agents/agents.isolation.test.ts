// ---------------------------------------------------------------------------
// the spec for what one agent may do to another host
//
// Every host in the graph is reported by a machine that could itself be
// compromised, so "a token only speaks for its own host" is a security
// boundary, not a data-modelling nicety. This file drives it through http with
// two really enrolled agents, because that is the only setup where the
// principal comes from the agent row rather than from the payload (the
// development shortcuts in `requireAgent` deliberately trust the body, and are
// refused in production).
//
// Two boundaries are covered:
//   • the payload may not name another host      (`requireOwnHost`)
//   • a report may not claim a dns record id another host holds
//     (`store/facts.ts → splitRecordClaims`)
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  asHostId, asInterfaceId, asNetworkId, asRecordId, asZoneId,
} from '../../domain/common.ts';
import type { DnsRecord, InventoryReport } from '../../domain/index.ts';
import { createTestApp } from '../../test/harness.ts';

const JOIN = 'join-secret-for-tests';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** enrol one agent and hand back the credentials later requests need. */
async function enrol(app: Express, hostId: string) {
  const res = await request(app).post('/api/agents/register').send({
    joinToken: JOIN, hostId, name: hostId, version: '1.0.0',
  });
  expect(res.status).toBe(201);
  return res.body.credentials as { agentId: string; token: string };
}

/**
 * A self-contained snapshot for `hostId`, optionally carrying dns records.
 * Everything is namespaced per host except the record ids the caller passes —
 * those are the global namespace this file is about.
 */
function reportFor(hostId: string, records: Partial<DnsRecord>[] = []): InventoryReport {
  const host = asHostId(hostId);
  return {
    hostId: host,
    collectedAt: new Date().toISOString(),
    host: {
      id: host,
      name: hostId,
      host: 'qemu vm · local',
      mgmt: '192.168.1.50',
      mgmtIp: '192.168.1.50',
      mgmtVia: null,
      tags: [],
      netBadges: [{ net: asNetworkId('lan'), label: 'lan' }],
      chips: [{ id: 'web', label: 'web', kind: 'docker', nodes: ['ngx'] }],
      nodes: [{ id: 'ngx', label: 'ngx', desc: 'nginx', res: 'docker' }],
      interfaces: [{
        id: asInterfaceId(`${hostId}-eth0`),
        title: 'eth0',
        net: asNetworkId('lan'),
        ips: [{ ip: '192.168.1.50', tag: 'primary' }],
        ports: '80 443',
      }],
    },
    networks: [{
      id: asNetworkId('lan'),
      name: 'home lan',
      cidr: '192.168.1.0/24',
      color: '#8bd5a0',
      kind: 'local network',
      role: 'lan',
    }],
    edges: [],
    zones: [{
      id: asZoneId('corp'),
      name: 'corp.example',
      kind: 'public',
      color: '#8bd5a0',
      dns: 'cloudflare',
      ns: ['ns1.example'],
      dnssec: true,
    }],
    records: records.map((r): DnsRecord => ({
      id: asRecordId('mail'),
      zone: asZoneId('corp'),
      name: 'mail',
      fqdn: 'mail.corp.example',
      type: 'A',
      value: '10.0.0.1',
      ...r,
    })),
  };
}

const postInventory = (app: Express, agentId: string, token: string, body: unknown) => request(app)
  .post(`/api/agents/${agentId}/inventory`)
  .set(bearer(token))
  .send(body as object);

describe('host pinning — the token decides the host, never the payload', () => {
  it('refuses an inventory report naming another host', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const attacker = await enrol(app, 'attacker');

    const res = await postInventory(app, attacker.agentId, attacker.token, reportFor('victim'));

    expect(res.status).toBe(403);
  });

  it('refuses a health report naming another host, before the seam is reached', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const attacker = await enrol(app, 'attacker');

    const foreign = await request(app)
      .post(`/api/agents/${attacker.agentId}/health`)
      .set(bearer(attacker.token))
      .send({ hostId: 'victim', seq: 1, samples: [{ name: 'cpu', value: 99 }] });
    expect(foreign.status).toBe(403);

    // the seam itself is still unimplemented — the point is that the 403 above
    // is decided *before* that, so implementing it cannot open the hole
    const own = await request(app)
      .post(`/api/agents/${attacker.agentId}/health`)
      .set(bearer(attacker.token))
      .send({ hostId: 'attacker', seq: 1, samples: [{ name: 'cpu', value: 99 }] });
    expect(own.status).toBe(501);
  });

  it('refuses events naming another host', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const attacker = await enrol(app, 'attacker');

    const res = await request(app)
      .post(`/api/agents/${attacker.agentId}/events`)
      .set(bearer(attacker.token))
      .send([{ hostId: 'victim', at: new Date().toISOString(), kind: 'service.down' }]);

    expect(res.status).toBe(403);
  });

  it('refuses a batch whose nested items name another host', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const attacker = await enrol(app, 'attacker');

    const res = await request(app)
      .post(`/api/agents/${attacker.agentId}/batch`)
      .set(bearer(attacker.token))
      .send({ items: [{ kind: 'health', report: { hostId: 'victim', samples: [] } }] });

    expect(res.status).toBe(403);
  });

  it('refuses a heartbeat naming another host', async () => {
    const { app } = await createTestApp({ AGENT_JOIN_TOKEN: JOIN });
    const attacker = await enrol(app, 'attacker');

    const res = await request(app)
      .post(`/api/agents/${attacker.agentId}/heartbeat`)
      .set(bearer(attacker.token))
      .send({ hostId: 'victim', at: new Date().toISOString() });

    expect(res.status).toBe(403);
  });
});

// the takeover was a property of the sql, not of the shared merge helper, so
// both drivers are driven through the same expectations — sqlite is what
// production actually runs
const drivers: [string, NodeJS.ProcessEnv][] = [
  ['memory', { AGENT_JOIN_TOKEN: JOIN }],
  ['sqlite', { AGENT_JOIN_TOKEN: JOIN, STORE_DRIVER: 'sqlite', SQLITE_PATH: ':memory:' }],
];

describe.each(drivers)('record ownership (%s) — an agent may not claim a record id another host holds', (_driver, env) => {
  it('leaves the owner’s record untouched and drops the claim', async () => {
    const { app, store } = await createTestApp(env);
    const victim = await enrol(app, 'victim');
    const attacker = await enrol(app, 'attacker');

    // the victim publishes mail.corp.example, terminating on itself
    expect((await postInventory(app, victim.agentId, victim.token, reportFor('victim', [
      { server: asHostId('victim'), value: '10.0.0.1' },
    ]))).status).toBe(202);

    // the attacker reports its own host, but claims the victim's record id
    const res = await postInventory(app, attacker.agentId, attacker.token, reportFor('attacker', [
      { server: asHostId('attacker'), value: '203.0.113.9', fqdn: 'mail.corp.example' },
    ]));

    // the report itself is honest about its own host, so it is accepted …
    expect(res.status).toBe(202);
    // … but the record is untouched: same owner, same value, exactly one row
    const records = await store.inventory.listRecords();
    const mail = records.filter((r) => r.id === 'mail');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.server).toBe('victim');
    expect(mail[0]!.value).toBe('10.0.0.1');
  });

  it('refuses an ownerless claim on an owned id (no half-updated row)', async () => {
    const { app, store } = await createTestApp(env);
    const victim = await enrol(app, 'victim');
    const attacker = await enrol(app, 'attacker');

    await postInventory(app, victim.agentId, victim.token, reportFor('victim', [
      { server: asHostId('victim'), value: '10.0.0.1' },
    ]));

    // shared zone data (no `server`) merged field-wise used to overwrite the
    // json while leaving the owner column behind — the row must not move
    await postInventory(app, attacker.agentId, attacker.token, reportFor('attacker', [
      { value: '203.0.113.9' },
    ]));

    const mail = (await store.inventory.listRecords()).filter((r) => r.id === 'mail');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.server).toBe('victim');
    expect(mail[0]!.value).toBe('10.0.0.1');
  });

  it('lets a host replace its own records, and release them again', async () => {
    const { app, store } = await createTestApp(env);
    const victim = await enrol(app, 'victim');

    await postInventory(app, victim.agentId, victim.token, reportFor('victim', [
      { server: asHostId('victim'), value: '10.0.0.1' },
    ]));
    // same id, new value: its own snapshot, so this must apply
    await postInventory(app, victim.agentId, victim.token, reportFor('victim', [
      { server: asHostId('victim'), value: '10.0.0.2' },
    ]));

    let records = await store.inventory.listRecords();
    expect(records.filter((r) => r.id === 'mail')).toHaveLength(1);
    expect(records.find((r) => r.id === 'mail')!.value).toBe('10.0.0.2');

    // dropping it from the snapshot releases the id (this is what makes a
    // genuine service migration heal on the next report)
    await postInventory(app, victim.agentId, victim.token, reportFor('victim'));
    records = await store.inventory.listRecords();
    expect(records.filter((r) => r.id === 'mail')).toHaveLength(0);
  });

  it('lets the next owner claim an id the previous owner released', async () => {
    const { app, store } = await createTestApp(env);
    const victim = await enrol(app, 'victim');
    const other = await enrol(app, 'other');

    await postInventory(app, victim.agentId, victim.token, reportFor('victim', [
      { server: asHostId('victim'), value: '10.0.0.1' },
    ]));
    // the service moves: the previous owner stops claiming the name …
    await postInventory(app, victim.agentId, victim.token, reportFor('victim'));
    // … and the new one picks it up
    await postInventory(app, other.agentId, other.token, reportFor('other', [
      { server: asHostId('other'), value: '10.0.0.7' },
    ]));

    const mail = (await store.inventory.listRecords()).filter((r) => r.id === 'mail');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.server).toBe('other');
    expect(mail[0]!.value).toBe('10.0.0.7');
  });
});
