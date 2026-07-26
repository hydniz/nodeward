import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../api.js';
import ServerModal from '../components/ServerModal.jsx';

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

function Tile({ label, value, tone }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  );
}

export default function NetworksPage() {
  const { data: topo } = useApi('/api/topology');
  const { data: srv } = useApi('/api/servers');
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('all');
  const [modalId, setModalId] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setModalId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
        <header className="page-head">
          <div>
            <h1>Networks</h1>
            <div className="page-sub">connecting…</div>
          </div>
        </header>
      </div>
    );
  }

  const listed = model.nets.filter((n) => filter === 'all' || n.group === filter);
  const selected = model.nets.find((n) => n.id === params.get('net')) ?? listed[0] ?? model.nets[0];
  const modalServer = srv.servers.find((s) => s.id === modalId);
  const maxMemberTraffic = Math.max(1, ...selected.members.map((m) => m.rx + m.tx));

  return (
    <div className="page scroll">
      <header className="page-head">
        <div>
          <h1>Networks</h1>
          <div className="page-sub">
            {model.nets.length} networks · {model.memberships} memberships
          </div>
        </div>
        <div className="chips">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`chip${filter === id ? ' active' : ''}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="networks-layout">
        {/* ---- left: network list ---- */}
        <div className="netlist">
          {GROUPS.filter(([g]) => listed.some((n) => n.group === g)).map(([g, label]) => (
            <React.Fragment key={g}>
              <div className="netlist-group">{label}</div>
              {listed.filter((n) => n.group === g).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`netlist-item${selected.id === n.id ? ' active' : ''}`}
                  style={selected.id === n.id ? { borderLeftColor: n.color } : undefined}
                  onClick={() => setParams({ net: n.id }, { replace: true })}
                >
                  <span className="nl-glyph" style={{ background: n.color }} />
                  <span className="nl-text">
                    <span className="nl-name">{n.name}</span>
                    <span className="nl-kind">{n.kind}</span>
                  </span>
                  <span className="nl-meta">
                    <span className="nl-count">{n.members.length}</span>
                    <span className={`nl-state${n.downCount ? ' bad' : ''}`}>
                      {n.downCount ? `${n.downCount} down` : `▲${n.tx} ▼${n.rx}`}
                    </span>
                  </span>
                </button>
              ))}
            </React.Fragment>
          ))}
        </div>

        {/* ---- right: network detail ---- */}
        <div className="netdetail">
          <div className="nd-head">
            <span className="nd-glyph" style={{ color: selected.color }}>
              {selected.virtual ? '⇄' : '☁'}
            </span>
            <h2>{selected.name}</h2>
            {selected.cidr && <span className="mchip">{selected.cidr}</span>}
            <span className="mchip">{selected.kind}</span>
            {selected.sub && !selected.cidr && <span className="mchip">{selected.sub}</span>}
            <span className="nd-traffic">
              <span className="tx">▲{selected.tx}</span>{' '}
              <span className="rx">▼{selected.rx}</span>{' '}
              <span className="nd-unit">MB/s</span>
            </span>
          </div>

          <div className="nd-tiles">
            <Tile label="members" value={selected.members.length} />
            <Tile label="tx total" value={`${selected.tx} MB/s`} />
            <Tile label="rx total" value={`${selected.rx} MB/s`} />
            <Tile
              label="status"
              value={selected.downCount ? `${selected.downCount} down` : 'healthy'}
              tone={selected.downCount ? DOWN : UP}
            />
          </div>

          <div className="nd-sect">members · {selected.members.length}</div>
          <table className="ntable">
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
                  onClick={() => setModalId(m.serverId)}
                >
                  <td>
                    <span className="nt-member">
                      <span
                        className="dot sm"
                        style={{ background: m.down ? DOWN : UP }}
                      />
                      {m.name}
                      {m.nodeLabel && <span className="nt-node"> · {m.nodeLabel}</span>}
                    </span>
                  </td>
                  <td className="nt-iface">{m.iface.title}</td>
                  <td className="mono">{m.ip}</td>
                  <td className="nt-details">{m.details}</td>
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

          {selected.dns.length > 0 && (
            <>
              <div className="nd-sect">dns records terminating in this network</div>
              {selected.dns.map((d) => (
                <div key={d.host} className={`nd-row tone-${d.tone || 'dim'}`}>
                  <span className="nd-l">{d.host}</span>
                  <span className="nd-owner">via {d.via}</span>
                  <span className="r">{d.status}</span>
                </div>
              ))}
            </>
          )}

          {selected.magic.length > 0 && (
            <>
              <div className="nd-sect">magicdns</div>
              {selected.magic.map((m) => (
                <div key={m.fqdn} className="nd-row">
                  <span className="nd-l mono">{m.fqdn}</span>
                  <span className="nd-owner">{m.owner}</span>
                </div>
              ))}
            </>
          )}

          {selected.routed.length > 0 && (
            <>
              <div className="nd-sect">routed over this link</div>
              {selected.routed.map((r) => (
                <div key={r.l} className={`nd-row tone-${r.tone || 'dim'}`}>
                  <span className="nd-l">{r.l}</span>
                  <span className="r">{r.r}</span>
                </div>
              ))}
            </>
          )}

          {selected.facts.length > 0 && (
            <>
              <div className="nd-sect">interface facts</div>
              {selected.facts.map((f) => (
                <div key={`${f.owner}-${f.l}`} className={`nd-row tone-${f.tone || 'dim'}`}>
                  <span className="nd-owner">{f.owner}</span>
                  <span className="nd-l">{f.l}</span>
                  <span className="r">{f.r}</span>
                </div>
              ))}
            </>
          )}

          {selected.notes.length > 0 && (
            <>
              <div className="nd-sect">notes</div>
              {selected.notes.map((t) => (
                <div key={t} className="nd-note">{t}</div>
              ))}
            </>
          )}
        </div>
      </div>

      {modalServer && (
        <ServerModal
          server={modalServer}
          nets={netsById}
          context="networks"
          onClose={() => setModalId(null)}
        />
      )}
    </div>
  );
}
