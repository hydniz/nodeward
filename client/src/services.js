// ---------------------------------------------------------------------------
// the service view-model, derived from the host facts
//
// A service is one node of one host. Everything the services page shows comes
// from facts that already exist: which chip (stack) it belongs to, whether it
// has an own network identity, and which dns records terminate on it.
// ---------------------------------------------------------------------------

export const RUNTIMES = [
  ['docker', 'docker'],
  ['k3s', 'k3s'],
  ['vm', 'virtual machines'],
  ['native', 'on the host'],
];

function runtimeOf(chipKind, res) {
  const hay = `${chipKind ?? ''} ${res ?? ''}`.toLowerCase();
  if (hay.includes('k3s')) return 'k3s';
  if (hay.includes('docker')) return 'docker';
  if (hay.includes('vm')) return 'vm';
  return 'native';
}

// how the world reaches this service — the most important fact after "is it up"
function exposureOf(recs, netsById, ifaces) {
  if (recs.some((r) => r.proxied)) return { cls: 'proxied', text: '◆ cf proxied' };
  const direct = recs.find((r) => netsById[r.net]?.role === 'provider');
  if (direct) return { cls: 'direct', text: 'direct origin' };
  if (recs.some((r) => r.type === 'magicdns') || ifaces.some((i) => netsById[i.net]?.role === 'mesh')) {
    return { cls: 'mesh', text: 'tailnet only' };
  }
  if (recs.length) return { cls: 'mesh', text: 'lan only' };
  return { cls: 'none', text: 'internal' };
}

export function buildServices(servers, records = [], netsById = {}) {
  const out = [];
  servers.forEach((server) => {
    server.nodes.forEach((node) => {
      const chip = server.chips.find((c) => (c.nodes ?? [c.id]).includes(node.id));
      const ifaces = server.interfaces.filter((i) => i.node === node.id);
      const recs = records.filter((r) => r.server === server.id && r.node === node.id);
      const down = !!node.down || server.status === 'down';
      out.push({
        id: `${server.id}.${node.id}`,
        nodeId: node.id,
        name: node.label,
        desc: node.desc,
        res: node.res,
        server,
        chip,
        stack: chip?.nodes ?? [node.id],
        kind: chip?.kind ?? node.res,
        runtime: runtimeOf(chip?.kind, node.res),
        ifaces,
        ip: ifaces[0]?.ips?.[0]?.ip ?? null,
        tx: down ? 0 : ifaces.reduce((a, i) => a + (i.tx ?? 0), 0),
        rx: down ? 0 : ifaces.reduce((a, i) => a + (i.rx ?? 0), 0),
        records: recs,
        exposure: exposureOf(recs, netsById, ifaces),
        down,
        warn: !down && server.status === 'warning',
      });
    });
  });
  // hosts in the order the api ships them, services alphabetically inside
  out.sort((a, b) => a.server.name.localeCompare(b.server.name)
    || a.name.localeCompare(b.name));
  return out;
}

// the node a chip stands for when something links to "the chip"
export function primaryNode(server, chipId) {
  const chip = server?.chips?.find((c) => c.id === chipId);
  if (!chip) return chipId;
  const ids = chip.nodes ?? [chip.id];
  return ids.includes(chip.id) ? chip.id : ids[0];
}
