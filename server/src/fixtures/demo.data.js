// ---------------------------------------------------------------------------
// nodeward mock dataset
// This is static demo data. Later it will be produced in realtime by the
// nodeward agents running on each host — the shapes below are the contract.
// ---------------------------------------------------------------------------

// ---- logical networks (drawn as clouds, center of a star topology) --------
// pure facts — all geometry is computed by the auto-layout engine
// (shared/autoLayout.js, rules in LAYOUT.md).
// role drives the layout band: provider → top, lan → bottom, rest → middle.
// networks with `virtual: true` get no cloud (used for p2p color/filtering).
export const networks = [
  {
    id: 'hetzner',
    name: 'hetzner',
    sub: 'internet · fsn1 hel1',
    color: '#7f8b99',
    kind: 'internet provider',
    role: 'provider',
  },
  {
    id: 'netcup',
    name: 'netcup',
    sub: 'internet · nbg1',
    color: '#7f8b99',
    kind: 'internet provider',
    role: 'provider',
  },
  {
    id: 'contabo',
    name: 'contabo',
    sub: 'internet',
    color: '#7f8b99',
    kind: 'internet provider',
    role: 'provider',
  },
  {
    id: 'tailnet',
    name: 'tailnet',
    sub: '100.64.0.0/10 · 12 devices',
    cidr: '100.64.0.0/10',
    color: '#2fd6a5',
    kind: 'mesh vpn',
    role: 'mesh',
    note: '+3 client devices not shown (ops-laptop, phone, desk)',
  },
  {
    id: 'k3s',
    name: 'k3s overlay',
    sub: '10.42.0.0/16 · 3 nodes',
    cidr: '10.42.0.0/16',
    color: '#4db8ff',
    kind: 'cni / flannel vxlan',
    role: 'overlay',
  },
  {
    id: 'lan',
    name: 'home lan',
    sub: '192.168.10.0/24 · NAT',
    cidr: '192.168.10.0/24',
    color: '#53d3e0',
    kind: 'physical · behind NAT',
    role: 'lan',
  },
  {
    id: 'dorm',
    name: 'dorm lan',
    sub: '192.168.80.0/24 · NAT',
    cidr: '192.168.80.0/24',
    color: '#e08fb8',
    kind: 'physical · dorm · NAT',
    role: 'lan',
  },
  {
    id: 'wg0',
    name: 'wg0',
    cidr: '10.8.0.0/24',
    color: '#9d8cff',
    kind: 'wireguard p2p',
    role: 'p2p',
    virtual: true,
  },
];

// ---- point-to-point vpn links (direct server ⇄ server, no network cloud) --
export const p2p = [
  {
    id: 'wg-hyperion-kratos',
    net: 'wg0',
    title: 'wg0',
    color: '#9d8cff',
    kind: 'wireguard p2p',
    a: { server: 'hyperion', iface: 'wg0' },
    b: { server: 'kratos', iface: 'wg0' },
    traffic: 11.8,
    // one ip label per tunnel endpoint, rendered right at each port
    labels: [
      { text: '10.8.0.1', end: 'a' },
      { text: '10.8.0.2', end: 'b' },
    ],
  },
];

// ---- servers (hosts) -------------------------------------------------------
// graph: box geometry + aggregate chips; table/modal: nodes + interfaces
export const servers = [
  {
    id: 'atlas',
    name: 'atlas',
    host: 'hetzner cpx41 · fsn1',
    status: 'up',
    uptime: '142d',
    uptimeDays: 142,
    mgmtIp: '157.90.214.12',
    mgmtVia: null,
    mgmt: '157.90.214.12',
    cpu: 34, ram: 58, disk: 61,
    tags: ['hetzner cpx41', 'fsn1'],
    netBadges: [{ net: 'tailnet', label: 'tailnet' }, { net: 'hetzner', label: 'wan ×2' }],
    chips: [{
      id: 'dkr', label: 'dkr', kind: 'docker engine',
      nodes: ['trf', 'gta', 'ath', 'kum'],
    }],
    nodes: [
      { id: 'trf', label: 'trf', desc: 'traefik · reverse proxy', res: 'docker' },
      { id: 'gta', label: 'gta', desc: 'gitea · git.nyx.dev', res: 'docker' },
      { id: 'ath', label: 'ath', desc: 'authelia · sso', res: 'docker' },
      { id: 'kum', label: 'kum', desc: 'uptime-kuma · status page', res: 'docker' },
    ],
    interfaces: [
      {
        id: 'eth0', net: 'hetzner', title: 'eth0',
        ips: [
          { ip: '157.90.214.12', tag: 'primary' },
          { ip: '157.90.214.88', tag: 'floating' },
          { ip: '2a01:4f8:c2c:9a::1', tag: 'v6' },
        ],
        rx: 8.2, tx: 3.4, ports: '80 443 · 22 ts only',
        sectionTitle: 'dns records on this interface',
        section: [
          { l: 'git.nyx.dev', r: '◆ cf proxied', tone: 'warn' },
          { l: 'auth.nyx.dev', r: '◆ cf proxied', tone: 'warn' },
          { l: 'status.nyx.dev', r: 'A direct', tone: 'dim' },
        ],
        extra: 'rdns: static.12.214.90.157.clients…',
        note: '◆ proxied = origin hidden, no ssh via domain',
        modal: { ip: '157.90.214.12 +2', rx: 8.2, tx: 3.4 },
      },
      {
        id: 'ts0', net: 'tailnet', title: 'ts0',
        ips: [{ ip: '100.101.1.4', tag: 'tailscale' }],
        rx: 1.9, tx: 0.8, ports: '22 · ssh over ts',
        sectionTitle: 'tailnet',
        section: [
          { l: 'magicdns', r: 'atlas.nyx-mesh.ts.net', tone: 'dim' },
          { l: 'ssh', r: 'allowed from tag:ops', tone: 'dim' },
        ],
        note: 'derp fallback: fra1 · direct conns preferred',
        modal: { ip: '100.101.1.4', rx: 1.9, tx: 0.8 },
      },
    ],
  },
  {
    id: 'hyperion',
    name: 'hyperion',
    host: 'hetzner ax102 · hel1',
    status: 'warning',
    warn: 'disk 87%',
    uptime: '89d',
    uptimeDays: 89,
    mgmtIp: '65.108.33.7',
    mgmtVia: null,
    mgmt: '65.108.33.7',
    cpu: 71, ram: 82, disk: 87,
    tags: ['hetzner ax102', 'hel1'],
    netBadges: [
      { net: 'tailnet', label: 'tailnet' }, { net: 'wg0', label: 'wg0' },
      { net: 'k3s', label: 'k3s' }, { net: 'hetzner', label: 'wan' },
    ],
    chips: [
      { id: 'dkr', label: 'dkr', kind: 'docker engine', nodes: ['imc', 'min', 'pg'] },
      {
        id: 'k3s-1', label: 'k3s-1', kind: 'k3s server · control-plane',
        nodes: ['k3s-1', 'ing'], ring: '#4db8ff',
      },
    ],
    nodes: [
      { id: 'k3s-1', label: 'k3s-1', desc: 'k3s server · control-plane', res: '4 vcpu' },
      { id: 'ing', label: 'ing', desc: 'ingress-nginx · k3s', res: 'k3s' },
      { id: 'imc', label: 'imc', desc: 'immich · photos', res: 'docker' },
      { id: 'min', label: 'min', desc: 'minio · s3 storage', res: 'docker' },
      { id: 'pg', label: 'pg', desc: 'postgres 16 · primary', res: 'docker' },
    ],
    interfaces: [
      {
        id: 'eth0', net: 'hetzner', title: 'eth0',
        ips: [
          { ip: '65.108.33.7', tag: 'primary' },
          { ip: '2a01:4f9:4b:2a::2', tag: 'v6' },
        ],
        rx: 6.1, tx: 2.4, ports: '80 443 6443 ts only',
        sectionTitle: 'dns records on this interface',
        section: [
          { l: 'photos.nyx.dev', r: '◆ cf proxied', tone: 'warn' },
          { l: 's3.nyx.dev', r: 'A direct', tone: 'dim' },
        ],
        note: '◆ proxied = origin hidden, no ssh via domain',
        modal: { ip: '65.108.33.7 +1', rx: 6.1, tx: 2.4 },
      },
      {
        id: 'ts0', net: 'tailnet', title: 'ts0',
        ips: [{ ip: '100.101.1.7', tag: 'tailscale' }],
        rx: 2.6, tx: 1.4, ports: '22 6443 over ts',
        sectionTitle: 'tailnet',
        section: [{ l: 'magicdns', r: 'hyperion.nyx-mesh.ts.net', tone: 'dim' }],
        modal: { ip: '100.101.1.7', rx: 2.6, tx: 1.4 },
      },
      {
        id: 'wg0', net: 'wg0', title: 'wg0',
        ips: [{ ip: '10.8.0.1', tag: 'peer kratos' }],
        rx: 2.9, tx: 11.8, ports: 'udp 51820 · mtu 1420',
        sectionTitle: 'routed over this link',
        section: [
          { l: '192.168.10.0/24', r: 'via kratos', tone: 'dim' },
          { l: 'k3s api (6443)', r: '2.1 MB/s', tone: 'accent' },
          { l: 'pve backups ← kratos', r: '8.9 MB/s', tone: 'accent' },
        ],
        note: 'wireguard · keepalive 25s · last handshake 34s',
        modal: { ip: '10.8.0.1 ⇄ kratos', rx: 2.9, tx: 11.8 },
      },
      {
        id: 'cni0', net: 'k3s', title: 'cni0', node: 'k3s-1',
        ips: [{ ip: '10.42.1.0/24', tag: 'pod cidr' }],
        rx: 3.4, tx: 3.1, ports: 'vxlan 8472 · flannel',
        sectionTitle: 'k3s node',
        section: [
          { l: 'role', r: 'control-plane', tone: 'dim' },
          { l: 'pods', r: '27 running', tone: 'dim' },
        ],
        modal: { ip: '10.42.1.0/24 · k3s-1', extra: '27 pods' },
      },
    ],
  },
  {
    id: 'helios',
    name: 'helios',
    host: 'netcup rs2000 · nbg1',
    status: 'up',
    uptime: '34d',
    uptimeDays: 34,
    mgmtIp: '152.89.104.51',
    mgmtVia: null,
    mgmt: '152.89.104.51',
    cpu: 18, ram: 41, disk: 37,
    tags: ['netcup rs2000', 'nbg1'],
    netBadges: [
      { net: 'tailnet', label: 'tailnet' }, { net: 'k3s', label: 'k3s' },
      { net: 'netcup', label: 'wan' },
    ],
    chips: [
      { id: 'dkr', label: 'dkr', kind: 'docker engine', nodes: ['cdy', 'ncl', 'n8n'] },
      {
        id: 'k3s-2', label: 'k3s-2', kind: 'k3s agent · worker',
        nodes: ['k3s-2'], ring: '#4db8ff',
      },
    ],
    nodes: [
      { id: 'k3s-2', label: 'k3s-2', desc: 'k3s agent · worker', res: '4 vcpu' },
      { id: 'cdy', label: 'cdy', desc: 'caddy · static sites', res: 'docker' },
      { id: 'ncl', label: 'ncl', desc: 'nextcloud · files', res: 'docker' },
      { id: 'n8n', label: 'n8n', desc: 'n8n · automation', res: 'docker' },
    ],
    interfaces: [
      {
        id: 'eth0', net: 'netcup', title: 'eth0',
        ips: [
          { ip: '152.89.104.51', tag: 'primary' },
          { ip: '2a0a:4cc0:1:9b::5', tag: 'v6' },
        ],
        rx: 2.8, tx: 1.1, ports: '80 443 · 22 ts only',
        sectionTitle: 'dns records on this interface',
        section: [
          { l: 'cloud.nyx.dev', r: 'A direct', tone: 'dim' },
          { l: 'flows.nyx.dev', r: '◆ cf proxied', tone: 'warn' },
        ],
        note: '◆ proxied = origin hidden, no ssh via domain',
        modal: { ip: '152.89.104.51 +1', rx: 2.8, tx: 1.1 },
      },
      {
        id: 'ts0', net: 'tailnet', title: 'ts0',
        ips: [{ ip: '100.101.1.9', tag: 'tailscale' }],
        rx: 1.2, tx: 0.7, ports: '22 over ts',
        sectionTitle: 'tailnet',
        section: [{ l: 'magicdns', r: 'helios.nyx-mesh.ts.net', tone: 'dim' }],
        modal: { ip: '100.101.1.9', rx: 1.2, tx: 0.7 },
      },
      {
        id: 'cni0', net: 'k3s', title: 'cni0', node: 'k3s-2',
        ips: [{ ip: '10.42.2.0/24', tag: 'pod cidr' }],
        rx: 2.2, tx: 2.6, ports: 'vxlan 8472 · flannel',
        sectionTitle: 'k3s node',
        section: [
          { l: 'role', r: 'worker', tone: 'dim' },
          { l: 'pods', r: '19 running', tone: 'dim' },
        ],
        modal: { ip: '10.42.2.0/24 · k3s-2', extra: '19 pods' },
      },
    ],
  },
  {
    id: 'kratos',
    name: 'kratos',
    host: 'home · proxmox ve',
    status: 'up',
    uptime: '21d',
    uptimeDays: 21,
    mgmtIp: '100.101.1.12',
    mgmtVia: 'ts',
    mgmt: 'kratos.nyx-mesh.ts.net',
    cpu: 44, ram: 63, disk: 52,
    tag: 'proxmox',
    tags: ['proxmox ve', 'home · NAT'],
    netBadges: [
      { net: 'tailnet', label: 'tailnet' }, { net: 'wg0', label: 'wg0' },
      { net: 'k3s', label: 'k3s' }, { net: 'lan', label: 'lan' },
    ],
    chips: [
      { id: 'hass', label: 'hass', kind: 'vm · home-assistant', nodes: ['hass'] },
      {
        id: 'media', label: 'media', kind: 'vm · tailscale sidecar',
        nodes: ['media'], ring: '#2fd6a5',
      },
      {
        id: 'k3s-3', label: 'k3s-3', kind: 'vm · k3s worker',
        nodes: ['k3s-3'], ring: '#4db8ff',
      },
    ],
    nodes: [
      { id: 'k3s-3', label: 'vm-k3s-3', desc: 'k3s worker · 41 pods share', res: '4 vcpu' },
      { id: 'media', label: 'vm-media', desc: 'jellyfin · own ts-node ○', res: '2 vcpu' },
      { id: 'hass', label: 'vm-hass', desc: 'home-assistant · zigbee usb', res: '2 vcpu' },
    ],
    interfaces: [
      {
        id: 'ts0', net: 'tailnet', title: 'ts0',
        ips: [{ ip: '100.101.1.12', tag: 'tailscale' }],
        rx: 6.4, tx: 2.1, ports: '22 8006 over ts',
        sectionTitle: 'tailnet',
        section: [
          { l: 'magicdns', r: 'kratos.nyx-mesh.ts.net', tone: 'dim' },
          { l: 'pve ui :8006', r: 'ts only', tone: 'dim' },
        ],
        modal: { ip: '100.101.1.12', rx: 6.4, tx: 2.1 },
      },
      {
        id: 'wg0', net: 'wg0', title: 'wg0',
        ips: [{ ip: '10.8.0.2', tag: 'peer hyperion' }],
        rx: 11.8, tx: 2.9, ports: 'udp 51820 · mtu 1420',
        sectionTitle: 'routed over this link',
        section: [
          { l: '192.168.10.0/24', r: 'advertised to peers', tone: 'dim' },
          { l: 'k3s api → hyperion', r: '2.1 MB/s', tone: 'accent' },
          { l: 'pve backups → hyperion', r: '8.9 MB/s', tone: 'accent' },
        ],
        note: 'wireguard · keepalive 25s · last handshake 34s',
        modal: { ip: '10.8.0.2 ⇄ hyperion', rx: 11.8, tx: 2.9 },
      },
      {
        id: 'lan', net: 'lan', title: 'lan',
        ips: [{ ip: '192.168.10.20', tag: 'vmbr0' }],
        rx: 1.2, tx: 0.8, ports: 'gw 192.168.10.1 · NAT',
        sectionTitle: 'bridge',
        section: [
          { l: 'vmbr0', r: 'vm-k3s-3 vm-media vm-hass', tone: 'dim' },
          { l: 'dns', r: 'hermes 192.168.10.53', tone: 'dim' },
        ],
        note: 'behind NAT · no inbound from wan',
        modal: { ip: '192.168.10.20 · vmbr0', rx: 1.2, tx: 0.8 },
      },
      {
        id: 'cni0', net: 'k3s', title: 'cni0', node: 'k3s-3',
        ips: [{ ip: '10.42.3.0/24', tag: 'pod cidr' }],
        rx: 4.1, tx: 3.7, ports: 'vxlan 8472 · flannel',
        sectionTitle: 'k3s node',
        section: [
          { l: 'role', r: 'worker · via vm-k3s-3', tone: 'dim' },
          { l: 'pods', r: '14 running', tone: 'dim' },
        ],
        modal: { ip: '10.42.3.0/24 · via vm-k3s-3', extra: '14 pods' },
      },
      {
        id: 'ts1', net: 'tailnet', title: 'ts0 @ vm-media', node: 'media',
        ips: [{ ip: '100.101.1.21', tag: 'sidecar' }],
        rx: 3.8, tx: 0.4, ports: '8096 over ts',
        sectionTitle: 'tailnet sidecar',
        section: [
          { l: 'magicdns', r: 'media.nyx-mesh.ts.net', tone: 'dim' },
          { l: 'exposed', r: 'jellyfin :8096 only', tone: 'dim' },
        ],
        note: 'own ts-node inside vm-media · not on host ts0',
        modal: { ip: '100.101.1.21 · vm-media', rx: 3.8, tx: 0.4 },
      },
    ],
  },
  {
    id: 'hermes',
    name: 'hermes',
    host: 'rpi 5 · edge',
    status: 'up',
    uptime: '63d',
    uptimeDays: 63,
    mgmtIp: '100.101.1.15',
    mgmtVia: 'ts',
    mgmt: 'hermes.nyx-mesh.ts.net',
    cpu: 9, ram: 27, disk: 19,
    tags: ['rpi 5', 'edge'],
    netBadges: [{ net: 'tailnet', label: 'tailnet' }, { net: 'lan', label: 'lan' }],
    chips: [{ id: 'dns', label: 'dns', kind: 'native service', nodes: ['dns'] }],
    nodes: [
      { id: 'dns', label: 'dns', desc: 'pihole + unbound · lan dns', res: 'native' },
    ],
    interfaces: [
      {
        id: 'ts0', net: 'tailnet', title: 'ts0',
        ips: [{ ip: '100.101.1.15', tag: 'tailscale' }],
        rx: 0.6, tx: 0.3, ports: '22 53 over ts',
        sectionTitle: 'tailnet',
        section: [
          { l: 'magicdns', r: 'hermes.nyx-mesh.ts.net', tone: 'dim' },
          { l: 'split dns', r: 'nyx.lan → hermes', tone: 'dim' },
        ],
        modal: { ip: '100.101.1.15', rx: 0.6, tx: 0.3 },
      },
      {
        id: 'lan', net: 'lan', title: 'eth0',
        ips: [{ ip: '192.168.10.53', tag: 'static' }],
        rx: 0.9, tx: 0.5, ports: '53 dns for lan',
        sectionTitle: 'lan',
        section: [
          { l: 'queries', r: '41k/day · 23% blocked', tone: 'dim' },
          { l: 'upstream', r: 'unbound · recursive', tone: 'dim' },
        ],
        modal: { ip: '192.168.10.53', rx: 0.9, tx: 0.5 },
      },
    ],
  },
  {
    id: 'ug1',
    name: 'ug1',
    host: 'ugreen nas · dorm',
    status: 'warning',
    warn: 'ts key expired',
    uptime: '54d',
    uptimeDays: 54,
    mgmtIp: '192.168.80.196',
    mgmtVia: null,
    mgmt: '192.168.80.196',
    cpu: 12, ram: 46, disk: 71,
    tags: ['ugreen nas', 'dorm · NAT'],
    netBadges: [{ net: 'tailnet', label: 'tailnet' }, { net: 'dorm', label: 'dorm' }],
    chips: [
      { id: 'mea', label: 'mea', kind: 'docker · mealie stack', nodes: ['mea', 'mdb'] },
      {
        id: 'wiki', label: 'wiki', kind: 'docker · wikijs stack · ts sidecar',
        nodes: ['wiki', 'wdb'], ring: '#2fd6a5',
      },
      {
        id: 'dns', label: 'dns', kind: 'docker · coredns · ts sidecar',
        nodes: ['dns'], ring: '#2fd6a5',
      },
    ],
    nodes: [
      { id: 'wiki', label: 'wiki', desc: 'wikijs 2 · own ts-node ○', res: 'docker' },
      { id: 'wdb', label: 'wiki-db', desc: 'postgres 15 · internal only', res: 'docker' },
      { id: 'dns', label: 'coredns', desc: 'coredns · own ts-node ○', res: 'docker' },
      { id: 'mea', label: 'mealie', desc: 'mealie · :9925 · mealie.jnsm.eu', res: 'docker' },
      { id: 'mdb', label: 'mealie-db', desc: 'postgres 15 · internal only', res: 'docker' },
    ],
    interfaces: [
      {
        id: 'lan', net: 'dorm', title: 'eth0',
        ips: [{ ip: '192.168.80.196', tag: 'dhcp reserved' }],
        rx: 2.4, tx: 1.1, ports: '9925 mealie · 9443 nas ui',
        sectionTitle: 'exposed services',
        section: [
          { l: 'mealie', r: ':9925 direct on lan', tone: 'dim' },
          { l: 'mealie.jnsm.eu', r: '◆ via ts-nginx-proxy-net', tone: 'warn' },
          { l: 'nas ui', r: ':9443 · lan only', tone: 'dim' },
        ],
        note: 'dorm network · NAT · no inbound from wan',
        modal: { ip: '192.168.80.196', rx: 2.4, tx: 1.1 },
      },
      {
        id: 'ts0', net: 'tailnet', title: 'ts0',
        ips: [{ ip: '100.64.1.2', tag: 'tailscale' }],
        rx: 0, tx: 0, ports: 'unreachable · key expired',
        sectionTitle: 'tailnet',
        section: [
          { l: 'state', r: 'key expired · reauth needed', tone: 'down' },
          { l: 'last handshake', r: '3d ago', tone: 'dim' },
          { l: 'magicdns', r: 'ug1.nyx-mesh.ts.net', tone: 'dim' },
        ],
        note: 'host link down — sidecar nodes are unaffected (own auth keys)',
        modal: { ip: '100.64.1.2 · key expired', down: true },
      },
      {
        id: 'ts1', net: 'tailnet', title: 'ts0 @ ts-wiki', node: 'wiki',
        ips: [{ ip: '100.64.1.3', tag: 'sidecar' }],
        rx: 0.8, tx: 0.3, ports: '3000 wiki over ts',
        sectionTitle: 'tailnet sidecar',
        section: [
          { l: 'magicdns', r: 'wikijs-server.nyx-mesh.ts.net', tone: 'dim' },
          { l: 'netns', r: 'wiki shares ts-wiki stack', tone: 'dim' },
          { l: 'docker nets', r: 'internal · ts-nginx-proxy-net', tone: 'dim' },
          { l: 'db', r: 'postgres @ internal', tone: 'dim' },
        ],
        note: 'network_mode: service:ts-wiki — wiki has no own ip',
        modal: { ip: '100.64.1.3 · wikijs-server', rx: 0.8, tx: 0.3 },
      },
      {
        id: 'ts2', net: 'tailnet', title: 'ts0 @ ts-dns', node: 'dns',
        ips: [{ ip: '100.64.1.4', tag: 'sidecar' }],
        rx: 0.2, tx: 0.1, ports: '53 dns over ts',
        sectionTitle: 'tailnet sidecar',
        section: [
          { l: 'magicdns', r: 'dns-server.nyx-mesh.ts.net', tone: 'dim' },
          { l: 'serves', r: 'coredns :53 for tailnet', tone: 'dim' },
          { l: 'mode', r: 'kernel networking · no userspace', tone: 'dim' },
        ],
        note: 'network_mode: service:tailscale-sidecar',
        modal: { ip: '100.64.1.4 · dns-server', rx: 0.2, tx: 0.1 },
      },
    ],
  },
  {
    id: 'janus',
    name: 'janus',
    host: 'contabo vps',
    status: 'down',
    uptime: null,
    uptimeDays: -1,
    downFor: '12m',
    mgmtIp: '194.36.88.201',
    mgmtVia: null,
    mgmt: '194.36.88.201',
    cpu: null, ram: null, disk: null,
    tags: ['contabo vps', 'last seen 12m ago'],
    netBadges: [{ net: 'contabo', label: 'wan' }],
    chips: [{ id: 'bkp', label: 'bkp', kind: 'native service', nodes: ['bkp'] }],
    nodes: [
      { id: 'bkp', label: 'bkp', desc: 'restic · offsite backups', res: 'native', down: true },
    ],
    interfaces: [
      {
        id: 'eth0', net: 'contabo', title: 'eth0',
        ips: [{ ip: '194.36.88.201', tag: 'primary' }],
        rx: 0, tx: 0, ports: 'unreachable · icmp timeout',
        sectionTitle: 'last known state',
        section: [
          { l: 'last seen', r: '12m ago', tone: 'down' },
          { l: 'last backup run', r: '02:00 · ok', tone: 'dim' },
        ],
        note: 'ping timeout since 21:36 · alert #2 open',
        modal: { ip: '194.36.88.201', down: true },
      },
    ],
  },
];

// ---- edges (graph links, star topology per network) ------------------------
// pure facts: which interface of which server/service is a member of which
// network. Anchors, bends and label positions are computed by the layout
// engine. ring + node: node-level interface — the edge starts directly at
// the service chip inside the box, so sidecars and cni links are visibly
// owned by the service, not the host.
export const edges = [
  // internet providers
  { id: 'atlas-het', server: 'atlas', iface: 'eth0', net: 'hetzner',
    label: '157.90.214.12 +2', traffic: 8.2 },
  { id: 'hyp-het', server: 'hyperion', iface: 'eth0', net: 'hetzner',
    label: '65.108.33.7 +1', traffic: 6.1 },
  { id: 'helios-netcup', server: 'helios', iface: 'eth0', net: 'netcup',
    label: '152.89.104.51 +1', traffic: 2.8 },
  { id: 'janus-contabo', server: 'janus', iface: 'eth0', net: 'contabo',
    label: '194.36.88.201', traffic: 0, state: 'down' },

  // tailnet
  { id: 'atlas-ts', server: 'atlas', iface: 'ts0', net: 'tailnet',
    label: '100.101.1.4', traffic: 1.9 },
  { id: 'hyperion-ts', server: 'hyperion', iface: 'ts0', net: 'tailnet',
    label: '100.101.1.7', traffic: 2.6 },
  { id: 'helios-ts', server: 'helios', iface: 'ts0', net: 'tailnet',
    label: '100.101.1.9', traffic: 1.2 },
  { id: 'kratos-ts', server: 'kratos', iface: 'ts0', net: 'tailnet',
    label: '100.101.1.12', traffic: 6.4 },
  { id: 'hermes-ts', server: 'hermes', iface: 'ts0', net: 'tailnet',
    label: '100.101.1.15', traffic: 0.6 },
  { id: 'media-ts', server: 'kratos', iface: 'ts1', net: 'tailnet',
    ring: true, node: 'media', label: '100.101.1.21', traffic: 3.8 },
  { id: 'ug1-ts', server: 'ug1', iface: 'ts0', net: 'tailnet',
    label: '100.64.1.2', traffic: 0, state: 'down' },
  { id: 'wiki-ts', server: 'ug1', iface: 'ts1', net: 'tailnet',
    ring: true, node: 'wiki', label: '100.64.1.3', traffic: 0.8 },
  { id: 'dns-ts', server: 'ug1', iface: 'ts2', net: 'tailnet',
    ring: true, node: 'dns', label: '100.64.1.4', traffic: 0.2 },

  // k3s overlay (all node-level → start at the k3s vm chips)
  { id: 'hyp-k3s', server: 'hyperion', iface: 'cni0', net: 'k3s',
    ring: true, node: 'k3s-1', label: '10.42.1.0/24', traffic: 3.4 },
  { id: 'helios-k3s', server: 'helios', iface: 'cni0', net: 'k3s',
    ring: true, node: 'k3s-2', label: '10.42.2.0/24', traffic: 2.6 },
  { id: 'kratos-k3s', server: 'kratos', iface: 'cni0', net: 'k3s',
    ring: true, node: 'k3s-3', label: '10.42.3.0/24', traffic: 4.1 },

  // home lan
  { id: 'kratos-lan', server: 'kratos', iface: 'lan', net: 'lan',
    label: '192.168.10.20', traffic: 1.2 },
  { id: 'hermes-lan', server: 'hermes', iface: 'lan', net: 'lan',
    label: '192.168.10.53', traffic: 0.9 },

  // dorm lan
  { id: 'ug1-dorm', server: 'ug1', iface: 'lan', net: 'dorm',
    label: '192.168.80.196', traffic: 2.4 },
];

// ---- dns zones -------------------------------------------------------------
// a zone is a name space someone answers for: a public zone at a registrar,
// the tailnet's magicdns, or a split-horizon zone served on the lan.
// kind drives the grouping on the domains page.
export const zones = [
  {
    id: 'nyx.dev',
    name: 'nyx.dev',
    kind: 'public',
    color: '#e0a458',
    registrar: 'porkbun',
    renews: '2027-03-04',
    dns: 'cloudflare',
    ns: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
    dnssec: true,
    note: 'main public zone · origins are hidden behind the cf proxy unless a record is marked direct',
  },
  {
    id: 'jnsm.eu',
    name: 'jnsm.eu',
    kind: 'public',
    color: '#e0a458',
    registrar: 'netcup',
    renews: '2027-01-19',
    dns: 'cloudflare',
    ns: ['carol.ns.cloudflare.com', 'dan.ns.cloudflare.com'],
    dnssec: false,
    note: 'private services published from the dorm nas — the request path always ends on ug1',
  },
  {
    id: 'nyx-mesh.ts.net',
    name: 'nyx-mesh.ts.net',
    kind: 'magicdns',
    color: '#2fd6a5',
    dns: 'tailscale magicdns',
    ns: ['100.100.100.100'],
    dnssec: false,
    note: 'names are handed out by the tailnet itself · no registrar, no certificates, no public exposure',
  },
  {
    id: 'nyx.lan',
    name: 'nyx.lan',
    kind: 'internal',
    color: '#53d3e0',
    dns: 'pihole + unbound @ hermes',
    ns: ['192.168.10.53'],
    dnssec: false,
    note: 'split dns · answered on the home lan by hermes and inside the tailnet by coredns @ ug1',
  },
];

// ---- dns records -----------------------------------------------------------
// pure facts per record: where it points, which interface answers it and what
// terminates the tls. `via` names an extra hop between the record and its
// origin (proxy, tunnel), `state` marks a record whose target is unhealthy.
export const records = [
  // ---- nyx.dev ----
  {
    id: 'nyx-apex', zone: 'nyx.dev', name: '@', fqdn: 'nyx.dev', type: 'A',
    value: '157.90.214.12', ttl: 'auto', proxied: true,
    server: 'atlas', iface: 'eth0', node: 'trf', net: 'hetzner',
    tls: { issuer: "let's encrypt", expires: '2026-10-02' },
    note: 'landing page · traefik router web-main',
  },
  {
    id: 'nyx-www', zone: 'nyx.dev', name: 'www', fqdn: 'www.nyx.dev', type: 'CNAME',
    value: 'nyx.dev', ttl: 'auto', proxied: true,
    server: 'atlas', iface: 'eth0', node: 'trf', net: 'hetzner',
    tls: { issuer: "let's encrypt", expires: '2026-10-02' },
  },
  {
    id: 'nyx-git', zone: 'nyx.dev', name: 'git', fqdn: 'git.nyx.dev', type: 'A',
    value: '157.90.214.12', ttl: 'auto', proxied: true,
    server: 'atlas', iface: 'eth0', node: 'gta', net: 'hetzner',
    tls: { issuer: "let's encrypt", expires: '2026-09-12' },
    note: 'ssh clone only over tailnet — the proxy hides the origin',
  },
  {
    id: 'nyx-auth', zone: 'nyx.dev', name: 'auth', fqdn: 'auth.nyx.dev', type: 'A',
    value: '157.90.214.12', ttl: 'auto', proxied: true,
    server: 'atlas', iface: 'eth0', node: 'ath', net: 'hetzner',
    tls: { issuer: "let's encrypt", expires: '2026-09-12' },
    note: 'sso for every other public service in this zone',
  },
  {
    id: 'nyx-status', zone: 'nyx.dev', name: 'status', fqdn: 'status.nyx.dev', type: 'A',
    value: '157.90.214.88', ttl: '300', proxied: false,
    server: 'atlas', iface: 'eth0', node: 'kum', net: 'hetzner',
    tls: { issuer: "let's encrypt", expires: '2026-09-30' },
    note: 'on the floating ip and deliberately not proxied — must stay up when cf is the problem',
  },
  {
    id: 'nyx-photos', zone: 'nyx.dev', name: 'photos', fqdn: 'photos.nyx.dev', type: 'A',
    value: '65.108.33.7', ttl: 'auto', proxied: true,
    server: 'hyperion', iface: 'eth0', node: 'imc', net: 'hetzner',
    tls: { issuer: "let's encrypt", expires: '2026-10-11' },
  },
  {
    id: 'nyx-s3', zone: 'nyx.dev', name: 's3', fqdn: 's3.nyx.dev', type: 'A',
    value: '65.108.33.7', ttl: '300', proxied: false,
    server: 'hyperion', iface: 'eth0', node: 'min', net: 'hetzner',
    tls: { issuer: "let's encrypt", expires: '2026-08-05' },
    note: 'direct: s3 clients need the real origin for presigned urls',
  },
  {
    id: 'nyx-k8s', zone: 'nyx.dev', name: '*.k8s', fqdn: '*.k8s.nyx.dev', type: 'A',
    value: '65.108.33.7', ttl: 'auto', proxied: false,
    server: 'hyperion', iface: 'eth0', node: 'ing', net: 'hetzner',
    tls: { issuer: "let's encrypt · dns-01", expires: '2026-09-08' },
    note: 'wildcard · every k3s ingress host lands here',
  },
  {
    id: 'nyx-cloud', zone: 'nyx.dev', name: 'cloud', fqdn: 'cloud.nyx.dev', type: 'A',
    value: '152.89.104.51', ttl: '300', proxied: false,
    server: 'helios', iface: 'eth0', node: 'ncl', net: 'netcup',
    tls: { issuer: "let's encrypt", expires: '2026-09-21' },
    note: 'direct: webdav + large uploads do not survive the proxy limits',
  },
  {
    id: 'nyx-flows', zone: 'nyx.dev', name: 'flows', fqdn: 'flows.nyx.dev', type: 'A',
    value: '152.89.104.51', ttl: 'auto', proxied: true,
    server: 'helios', iface: 'eth0', node: 'n8n', net: 'netcup',
    tls: { issuer: "let's encrypt", expires: '2026-09-21' },
  },
  {
    id: 'nyx-backup', zone: 'nyx.dev', name: 'backup', fqdn: 'backup.nyx.dev', type: 'A',
    value: '194.36.88.201', ttl: '300', proxied: false,
    server: 'janus', iface: 'eth0', node: 'bkp', net: 'contabo',
    state: 'down',
    tls: { issuer: "let's encrypt", expires: '2026-08-28' },
    note: 'points at an unreachable host since 21:36 · restic repo endpoint',
  },
  {
    id: 'nyx-mx', zone: 'nyx.dev', name: '@', fqdn: 'nyx.dev', type: 'MX',
    value: 'mx1.mailbox.org · prio 10', ttl: 'auto', proxied: false,
    note: 'mail is external — nothing in this infrastructure receives mail',
  },
  {
    id: 'nyx-spf', zone: 'nyx.dev', name: '@', fqdn: 'nyx.dev', type: 'TXT',
    value: 'v=spf1 include:mailbox.org -all', ttl: 'auto', proxied: false,
  },
  {
    id: 'nyx-dmarc', zone: 'nyx.dev', name: '_dmarc', fqdn: '_dmarc.nyx.dev', type: 'TXT',
    value: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@nyx.dev', ttl: 'auto', proxied: false,
  },

  // ---- jnsm.eu ----
  {
    id: 'jnsm-apex', zone: 'jnsm.eu', name: '@', fqdn: 'jnsm.eu', type: 'A',
    value: '157.90.214.12', ttl: 'auto', proxied: true,
    server: 'atlas', iface: 'eth0', node: 'trf', net: 'hetzner',
    tls: { issuer: "let's encrypt", expires: '2026-10-02' },
  },
  {
    id: 'jnsm-mealie', zone: 'jnsm.eu', name: 'mealie', fqdn: 'mealie.jnsm.eu', type: 'A',
    value: '157.90.214.12', ttl: 'auto', proxied: true,
    server: 'ug1', iface: 'lan', node: 'mea', net: 'dorm',
    via: 'atlas · traefik → tailnet → ts-nginx-proxy-net',
    tls: { issuer: "let's encrypt", expires: '2026-08-14' },
    note: 'the nas has no public ip — the request rides the tailnet into the dorm',
  },
  {
    id: 'jnsm-wiki', zone: 'jnsm.eu', name: 'wiki', fqdn: 'wiki.jnsm.eu', type: 'CNAME',
    value: 'wikijs-server.nyx-mesh.ts.net', ttl: 'auto', proxied: false,
    server: 'ug1', iface: 'ts1', node: 'wiki', net: 'tailnet',
    note: 'resolves publicly, reachable only from inside the tailnet — by design',
  },

  // ---- nyx-mesh.ts.net (magicdns) ----
  {
    id: 'md-atlas', zone: 'nyx-mesh.ts.net', name: 'atlas', fqdn: 'atlas.nyx-mesh.ts.net',
    type: 'magicdns', value: '100.101.1.4',
    server: 'atlas', iface: 'ts0', net: 'tailnet',
  },
  {
    id: 'md-hyperion', zone: 'nyx-mesh.ts.net', name: 'hyperion', fqdn: 'hyperion.nyx-mesh.ts.net',
    type: 'magicdns', value: '100.101.1.7',
    server: 'hyperion', iface: 'ts0', net: 'tailnet',
  },
  {
    id: 'md-helios', zone: 'nyx-mesh.ts.net', name: 'helios', fqdn: 'helios.nyx-mesh.ts.net',
    type: 'magicdns', value: '100.101.1.9',
    server: 'helios', iface: 'ts0', net: 'tailnet',
  },
  {
    id: 'md-kratos', zone: 'nyx-mesh.ts.net', name: 'kratos', fqdn: 'kratos.nyx-mesh.ts.net',
    type: 'magicdns', value: '100.101.1.12',
    server: 'kratos', iface: 'ts0', net: 'tailnet',
    note: 'proxmox ui :8006 is reachable on this name only',
  },
  {
    id: 'md-hermes', zone: 'nyx-mesh.ts.net', name: 'hermes', fqdn: 'hermes.nyx-mesh.ts.net',
    type: 'magicdns', value: '100.101.1.15',
    server: 'hermes', iface: 'ts0', net: 'tailnet',
  },
  {
    id: 'md-media', zone: 'nyx-mesh.ts.net', name: 'media', fqdn: 'media.nyx-mesh.ts.net',
    type: 'magicdns', value: '100.101.1.21',
    server: 'kratos', iface: 'ts1', node: 'media', net: 'tailnet',
    note: 'own ts identity inside vm-media · exposes jellyfin :8096 only',
  },
  {
    id: 'md-wiki', zone: 'nyx-mesh.ts.net', name: 'wikijs-server',
    fqdn: 'wikijs-server.nyx-mesh.ts.net', type: 'magicdns', value: '100.64.1.3',
    server: 'ug1', iface: 'ts1', node: 'wiki', net: 'tailnet',
    note: 'sidecar identity · the wiki container shares its netns',
  },
  {
    id: 'md-dns', zone: 'nyx-mesh.ts.net', name: 'dns-server',
    fqdn: 'dns-server.nyx-mesh.ts.net', type: 'magicdns', value: '100.64.1.4',
    server: 'ug1', iface: 'ts2', node: 'dns', net: 'tailnet',
    note: 'coredns :53 for the whole tailnet',
  },
  {
    id: 'md-ug1', zone: 'nyx-mesh.ts.net', name: 'ug1', fqdn: 'ug1.nyx-mesh.ts.net',
    type: 'magicdns', value: '100.64.1.2',
    server: 'ug1', iface: 'ts0', net: 'tailnet',
    state: 'down',
    note: 'host key expired · the name stays, nothing answers on it',
  },

  // ---- nyx.lan (split horizon) ----
  {
    id: 'lan-dns', zone: 'nyx.lan', name: 'dns', fqdn: 'dns.nyx.lan', type: 'A',
    value: '192.168.10.53', ttl: '60', proxied: false,
    server: 'hermes', iface: 'lan', node: 'dns', net: 'lan',
    note: 'the resolver answering this zone answers for itself as well',
  },
  {
    id: 'lan-pve', zone: 'nyx.lan', name: 'pve', fqdn: 'pve.nyx.lan', type: 'A',
    value: '192.168.10.20', ttl: '60', proxied: false,
    server: 'kratos', iface: 'lan', net: 'lan',
  },
  {
    id: 'lan-jelly', zone: 'nyx.lan', name: 'jelly', fqdn: 'jelly.nyx.lan', type: 'CNAME',
    value: 'media.nyx-mesh.ts.net', ttl: '60', proxied: false,
    server: 'kratos', iface: 'ts1', node: 'media', net: 'tailnet',
    note: 'lan name, tailnet target — works from both sides',
  },
  {
    id: 'lan-nas', zone: 'nyx.lan', name: 'nas', fqdn: 'nas.nyx.lan', type: 'A',
    value: '192.168.80.196', ttl: '60', proxied: false,
    server: 'ug1', iface: 'lan', net: 'dorm',
    via: 'coredns @ ug1 (tailnet clients)',
    note: 'only answered inside the dorm lan and by coredns for tailnet clients',
  },
];

// ---- summary ---------------------------------------------------------------
export function summary() {
  const up = servers.filter((s) => s.status === 'up').length;
  const warning = servers.filter((s) => s.status === 'warning').length;
  const down = servers.filter((s) => s.status === 'down').length;
  const nodes = servers.reduce((n, s) => n + s.nodes.length, 0);
  const alive = servers.filter((s) => s.cpu != null);
  const avgCpu = Math.round(alive.reduce((n, s) => n + s.cpu, 0) / alive.length);
  const avgRam = Math.round(alive.reduce((n, s) => n + s.ram, 0) / alive.length);
  return {
    hosts: servers.length, nodes, up, warning, down, avgCpu, avgRam,
    alerts: [
      { id: 1, level: 'warning', server: 'hyperion', text: 'disk 87% · threshold 85%' },
      { id: 2, level: 'down', server: 'janus', text: 'host unreachable · 12m' },
      { id: 3, level: 'warning', server: 'ug1', text: 'tailscale key expired · host link down' },
    ],
    mesh: 'full mesh',
  };
}
