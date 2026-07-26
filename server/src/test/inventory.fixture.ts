// ---------------------------------------------------------------------------
// a realistic minimal inventory report, for tests and for poking by hand
//
// One new host (`testbox`) with one docker stack and one interface joining a
// `lan` network. The network itself is part of the report, so the snapshot is
// self-contained — it works against an empty store as well as alongside the
// demo fixture (where `lan` already exists and is merged by id).
//
// To post it with curl against a running dev server:
//
//   node --experimental-strip-types -e \
//     "import('./src/test/inventory.fixture.ts').then(m => console.log(JSON.stringify(m.sampleReport())))" \
//     > /tmp/report.json
//   curl -X POST localhost:4001/api/agents/testbox/inventory \
//     -H 'content-type: application/json' -d @/tmp/report.json
// ---------------------------------------------------------------------------

import { asHostId, asInterfaceId, asNetworkId } from '../domain/common.ts';
import type { InventoryReport } from '../domain/index.ts';

/**
 * Builds the report. `overrides` is spread over the finished object, so a test
 * can swap any top-level part (`sampleReport({ networks: [] })`) while the
 * rest stays valid.
 */
export function sampleReport(overrides: Partial<InventoryReport> = {}): InventoryReport {
  const hostId = asHostId('testbox');
  return {
    hostId,
    collectedAt: new Date().toISOString(),
    host: {
      id: hostId,
      name: 'testbox',
      host: 'qemu vm · local',
      mgmt: '192.168.1.50',
      mgmtIp: '192.168.1.50',
      mgmtVia: null,
      tags: ['qemu', 'test'],
      netBadges: [{ net: asNetworkId('lan'), label: 'lan' }],
      chips: [{
        id: 'web', label: 'web', kind: 'docker · web stack', nodes: ['ngx'],
      }],
      nodes: [{
        id: 'ngx', label: 'ngx', desc: 'nginx 1.27 · static site', res: 'docker',
      }],
      interfaces: [{
        id: asInterfaceId('testbox-eth0'),
        title: 'eth0',
        net: asNetworkId('lan'),
        ips: [{ ip: '192.168.1.50', tag: 'primary' }],
        ports: '80 443 · 22',
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
    edges: [{
      id: 'testbox-eth0-lan',
      server: hostId,
      iface: asInterfaceId('testbox-eth0'),
      net: asNetworkId('lan'),
      label: '.50',
    }],
    ...overrides,
  };
}
