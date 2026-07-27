import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useApi } from '../api.js';
import ServerModal from '../components/ServerModal.jsx';
import NodeModal from '../components/NodeModal.jsx';
import {
  PageHead, Chips, FilterRow, Tile, TileRow, Sect, MasterList, DetailHead,
  KeyRow, Note,
} from '../components/ui.jsx';
import {
  serverPath, zonePath, isDirect, useGo,
} from '../nav.js';

const UP = '#3ecf9a';
const DOWN = '#e0564a';

const GROUPS = [
  ['vpn', 'vpn / overlay'],
  ['internet', 'internet'],
  ['physical', 'physical'],
];

const groupOf = (n) => (n.role === 'provider' ? 'internet' : n.role === 'lan' ? 'physical' : 'vpn');

const FILTERS = [
  ['all', 'All'],
  ['vpn', 'VPN / overlay'],
  ['internet', 'Internet'],
  ['physical', 'Physical'],
];

// build one rich view-model per network from the raw facts
function buildModel(topo, servers) {
  const serversById = Object.fromEntries(servers.map((s) => [s.id, s]));

  const memberFrom = (serverId, ifaceId, node, state) => {
    const s = serversById[serverId];
    const iface = s?.interfaces.find((i) => i.id === ifaceId);
    if (!s || !iface) return null;
    const down = state === 'down' || s.status === 'down';
    const nodeLabel = node ? s.nodes.find((x) => x.id === node)?.label ?? node : null;
    return {
      key: `${serverId}-${ifaceId}`,
      serverId,
      server: s,
      name: s.name,
      nodeLabel,
      iface,
      ip: iface.ips[0]?.ip ?? '—',
      details: iface.ports ?? '',
      rx: down ? 0 : iface.rx ?? 0,
      tx: down ? 0 : iface.tx ?? 0,
      down,
    };
  };

  const nets = topo.networks.map((n) => {
    const members = [];
    if (n.virtual) {
      (topo.p2p ?? [])
        .filter((L) => L.net === n.id)
        .forEach((L) => {
          const a = memberFrom(L.a.server, L.a.iface, null);
          const b = memberFrom(L.b.server, L.b.iface, null);
          if (a) members.push(a);
          if (b) members.push(b);
        });
    } else {
      topo.edges
        .filter((e) => e.net === n.id)
        .forEach((e) => {
          const m = memberFrom(e.server, e.iface, e.node, e.state);
          if (m) members.push(m);
        });
    }

    // classify the interface detail sections into page sections
    const dns = [];
    const magic = [];
    const routed = [];
    const facts = [];
    const notes = n.note ? [n.note] : [];
    members.forEach((m) => {
      const { iface } = m;
      const title = iface.sectionTitle ?? '';
      const owner = m.nodeLabel ? `${m.name} · ${m.nodeLabel}` : m.name;
      (iface.section ?? []).forEach((r) => {
        if (title.includes('dns records')) {
          dns.push({ host: r.l, status: r.r, tone: r.tone, via: owner });
        } else if (r.l === 'magicdns') {
          magic.push({ fqdn: r.r, owner });
        } else if (title === 'routed over this link') {
          // both tunnel endpoints describe the same routes — keep one side
          if (!routed.length || routed.side === m.key) {
            routed.side = m.key;
            routed.push(r);
          }
        } else {
          facts.push({ owner, l: r.l, r: r.r, tone: r.tone });
        }
      });
      if (iface.note && !notes.includes(iface.note)) notes.push(iface.note);
    });

    // trunks (R9) are a property of the network too: a host that joins with
    // three interfaces is a fact worth naming on this page
    const trunks = (topo.bundles ?? [])
      .filter((b) => b.net === n.id)
      .map((b) => ({
        id: b.id,
        serverId: b.server,
        server: serversById[b.server]?.name ?? b.server,
        count: b.members.length,
        traffic: b.traffic,
      }));

    const rx = members.reduce((a, m) => a + m.rx, 0);
    const tx = members.reduce((a, m) => a + m.tx, 0);
    const downCount = members.filter((m) => m.down).length;
    return {
      ...n,
      group: groupOf(n),
      members,
      rx: Math.round(rx * 10) / 10,
      tx: Math.round(tx * 10) / 10,
      downCount,
      dns,
      magic,
      routed,
      facts,
      notes,
      trunks,
    };
  });

  // vpn/overlay first, hubs before small nets, stable by id
  const groupRank = { vpn: 0, internet: 1, physical: 2 };
  nets.sort((a, b) => groupRank[a.group] - groupRank[b.group]
    || b.members.length - a.members.length
    || a.id.localeCompare(b.id));

  const memberships = nets.reduce((a, n) => a + n.members.length, 0);
  return { nets, memberships };
}

export default function NetworksPage() {
  const { data: topo } = useApi('/api/topology');
  const { data: srv } = useApi('/api/servers');
  const { data: dom } = useApi('/api/domains');
  const [params, setParams] = useSearchParams();
  const go = useGo();
  const [filter, setFilter] = useState('all');
  // mini overview: server | node
  const [modal, setModal] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setModal(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // which zone answers for a name — turns every dns line into a link
  const zoneOf = (fqdn) => dom?.zones.find(
    (z) => fqdn === z.id || fqdn.endsWith(`.${z.id}`),
  )?.id;

  const model = useMemo(
    () => (topo && srv ? buildModel(topo, srv.servers) : null),
    [topo, srv],
  );
  const netsById = useMemo(
    () => Object.fromEntries((topo?.networks ?? []).map((n) => [n.id, n])),
    [topo],
  );

  if (!model) {
    return (
      <div className="page">
        <PageHead title="Networks" sub="connecting…" />
      </div>
    );
  }

  const listed = model.nets.filter((n) => filter === 'all' || n.group === filter);
  const selected = model.nets.find((n) => n.id === params.get('net')) ?? listed[0] ?? model.nets[0];
  const modalServer = modal
    ? srv.servers.find((s) => s.id === (modal.kind === 'server' ? modal.id : modal.serverId))
    : null;
  const modalChip = modal?.kind === 'node'
    ? modalServer?.chips.find((c) => c.id === modal.chipId)
      ?? modalServer?.chips.find((c) => (c.nodes ?? []).includes(modal.chipId))
    : null;
  const maxMemberTraffic = Math.max(1, ...selected.members.map((m) => m.rx + m.tx));
  const downTotal = model.nets.reduce((a, n) => a + n.downCount, 0);

  const groups = GROUPS.map(([g, label]) => ({
    id: g,
    label,
    items: listed.filter((n) => n.group === g).map((n) => ({
      id: n.id,
      name: n.name,
      kind: n.kind,
      color: n.color,
      count: n.members.length,
      state: n.downCount ? `${n.downCount} down` : `▲${n.tx} ▼${n.rx}`,
      bad: n.downCount > 0,
    })),
  }));

  return (
    <div className="page scroll">
      <PageHead
        title="Networks"
        sub={`${model.nets.length} networks · ${model.memberships} memberships`}
      />

      <FilterRow meta={`${downTotal ? `${downTotal} member links down` : 'all member links up'}`}>
        <Chips options={FILTERS} value={filter} onChange={setFilter} />
      </FilterRow>

      <div className="detail-layout">
        <MasterList
          groups={groups}
          selectedId={selected.id}
          onSelect={(id) => setParams({ net: id }, { replace: true })}
        />

        <section className="detailcard">
          <DetailHead
            glyph={selected.virtual ? '⇄' : '☁'}
            color={selected.color}
            title={selected.name}
            chips={[selected.cidr, selected.kind, !selected.cidr ? selected.sub : null]}
            right={(
              <>
                <span className="tx">▲{selected.tx}</span>{' '}
                <span className="rx">▼{selected.rx}</span>{' '}
                <span className="dh-unit">MB/s</span>
              </>
            )}
          />

          <TileRow>
            <Tile label="members" value={selected.members.length} />
            <Tile label="tx total" value={`${selected.tx} MB/s`} />
            <Tile label="rx total" value={`${selected.rx} MB/s`} />
            <Tile
              label="status"
              value={selected.downCount ? `${selected.downCount} down` : 'healthy'}
              tone={selected.downCount ? DOWN : UP}
            />
          </TileRow>

          <Sect>members · {selected.members.length}</Sect>
          <div className="table-scroll">
            <table className="dtable">
            <thead>
              <tr>
                <th>member</th>
                <th>iface</th>
                <th>address</th>
                <th>link details</th>
                <th className="num">▲ tx</th>
                <th className="num">▼ rx</th>
                <th>share</th>
              </tr>
            </thead>
            <tbody>
              {selected.members.map((m) => (
                <tr
                  key={m.key}
                  className={m.down ? 'is-down' : ''}
                  title="host overview · ctrl+click opens the host page"
                  onClick={(e) => {
                    if (isDirect(e)) {
                      go(serverPath(m.serverId));
                      return;
                    }
                    setModal({ kind: 'server', id: m.serverId });
                  }}
                >
                  <td>
                    <span className="t-name">
                      <span
                        className="dot sm"
                        style={{ background: m.down ? DOWN : UP }}
                      />
                      {m.name}
                      {m.nodeLabel && <span className="t-node"> · {m.nodeLabel}</span>}
                    </span>
                  </td>
                  <td className="t-iface">{m.iface.title}</td>
                  <td className="mono">{m.ip}</td>
                  <td className="t-dim">{m.details}</td>
                  <td className="num tx">{m.down ? '—' : m.tx}</td>
                  <td className="num rx">{m.down ? '—' : m.rx}</td>
                  <td>
                    <span className="share-track">
                      <span
                        className="share-fill"
                        style={{
                          width: `${Math.round(((m.rx + m.tx) / maxMemberTraffic) * 100)}%`,
                          background: selected.color,
                        }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>

          {selected.trunks.length > 0 && (
            <>
              <Sect>bundled joins · drawn as one trunk on the map</Sect>
              {selected.trunks.map((t) => (
                <KeyRow
                  key={t.id}
                  l={t.server}
                  owner={`${t.count} interfaces`}
                  r={`${t.traffic} MB/s`}
                  tone="accent"
                  title="open this host's page"
                  onClick={() => go(serverPath(t.serverId))}
                />
              ))}
            </>
          )}

          {selected.dns.length > 0 && (
            <>
              <Sect>dns records terminating in this network</Sect>
              {selected.dns.map((d) => (
                <KeyRow
                  key={d.host}
                  l={d.host}
                  owner={`via ${d.via}`}
                  r={d.status}
                  tone={d.tone}
                  title="open the zone this name belongs to"
                  onClick={() => go(zonePath(zoneOf(d.host) ?? ''))}
                />
              ))}
            </>
          )}

          {selected.magic.length > 0 && (
            <>
              <Sect>magicdns</Sect>
              {selected.magic.map((m) => (
                <KeyRow
                  key={m.fqdn}
                  l={m.fqdn}
                  owner={m.owner}
                  mono
                  title="open the magicdns zone"
                  onClick={() => go(zonePath(zoneOf(m.fqdn) ?? ''))}
                />
              ))}
            </>
          )}

          {selected.routed.length > 0 && (
            <>
              <Sect>routed over this link</Sect>
              {selected.routed.map((r) => (
                <KeyRow key={r.l} l={r.l} r={r.r} tone={r.tone} />
              ))}
            </>
          )}

          {selected.facts.length > 0 && (
            <>
              <Sect>interface facts</Sect>
              {selected.facts.map((f) => (
                <KeyRow key={`${f.owner}-${f.l}`} l={f.l} owner={f.owner} r={f.r} tone={f.tone} />
              ))}
            </>
          )}

          {selected.notes.length > 0 && (
            <>
              <Sect>notes</Sect>
              {selected.notes.map((t) => <Note key={t}>{t}</Note>)}
            </>
          )}
        </section>
      </div>

      {modal?.kind === 'server' && modalServer && (
        <ServerModal
          server={modalServer}
          nets={netsById}
          context="networks"
          onOpenNode={(serverId, chipId) => setModal({ kind: 'node', serverId, chipId })}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'node' && modalServer && modalChip && (
        <NodeModal
          server={modalServer}
          chip={modalChip}
          nets={netsById}
          onOpenServer={(id) => setModal({ kind: 'server', id })}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
