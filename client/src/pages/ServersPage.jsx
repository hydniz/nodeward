import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useApi } from '../api.js';
import NodeModal from '../components/NodeModal.jsx';
import ServerDetail from '../components/ServerDetail.jsx';
import MorphLayout from '../components/MorphLayout.jsx';
import InterfacePanel from '../graph/InterfacePanel.jsx';
import {
  PageHead, Search, Chips, FilterRow, Tile, TileRow, MasterList, MiniModal,
} from '../components/ui.jsx';
import { primaryNode } from '../services.js';
import {
  isDirect, netPath, servicePath, useGo,
} from '../nav.js';

const UP = '#3ecf9a';
const WARN = '#e6b450';
const DOWN = '#e0564a';

const statusColor = (s) => (s === 'up' ? UP : s === 'warning' ? WARN : DOWN);

function Pct({ value }) {
  if (value == null) return <span className="pct nil">—</span>;
  const cls = value >= 85 ? 'crit' : value >= 70 ? 'warn' : '';
  return <span className={`pct ${cls}`}>{value}%</span>;
}

const COLS = [
  ['name', 'server', ''],
  ['mgmtIp', 'mgmt ip', ''],
  ['cpu', 'cpu', 'mob-hide'],
  ['ram', 'ram', 'mob-hide'],
  ['disk', 'disk', 'mob-hide'],
  ['nodes', 'nodes', 'mob-hide'],
  [null, 'networks', 'mob-hide'],
  ['uptimeDays', 'uptime', ''],
];

// public hosts first — same reading order as the bands on the map
const GROUPS = [
  ['public', 'public hosts'],
  ['edge', 'private / edge'],
];

export default function ServersPage() {
  const { data: srv } = useApi('/api/servers');
  const { data: summary } = useApi('/api/summary');
  const { data: topo } = useApi('/api/topology');
  const { data: dom } = useApi('/api/domains');
  const [params, setParams] = useSearchParams();
  const go = useGo();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [netFilter, setNetFilter] = useState(null);
  const [sort, setSort] = useState({ key: null, dir: 1 });
  // mini overview for the things that live elsewhere: node | iface
  const [modal, setModal] = useState(null);

  const selectedId = params.get('server');
  const nodeParam = params.get('node');

  const servers = srv?.servers ?? [];
  const netsById = useMemo(
    () => Object.fromEntries((topo?.networks ?? []).map((n) => [n.id, n])),
    [topo],
  );
  const providerIds = useMemo(
    () => new Set((topo?.networks ?? []).filter((n) => n.role === 'provider').map((n) => n.id)),
    [topo],
  );
  const groupOf = (s) => (s.netBadges.some((b) => providerIds.has(b.net)) ? 'public' : 'edge');

  const openServer = (id, node) => {
    setModal(null);
    setParams(node ? { server: id, node } : { server: id });
  };
  // MorphLayout animates the way out, so the url can change right away
  const closeDetail = () => setParams({});

  // escape closes the mini overview first, then the expanded host view
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (modal) setModal(null);
      else if (selectedId) closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, selectedId]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = servers.filter((s) => {
      if (status !== 'all' && s.status !== status) return false;
      if (netFilter && !s.netBadges.some((b) => b.net === netFilter)) return false;
      if (!q) return true;
      const hay = [
        s.name, s.host, s.mgmtIp,
        ...s.nodes.map((n) => n.label),
        ...s.interfaces.flatMap((i) => i.ips.map((r) => r.ip)),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
    const { key, dir } = sort;
    if (key) {
      list = [...list].sort((a, b) => {
        const av = key === 'nodes' ? a.nodes.length : a[key];
        const bv = key === 'nodes' ? b.nodes.length : b[key];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'string') return av.localeCompare(bv) * dir;
        return (av - bv) * dir;
      });
    }
    return list;
  }, [servers, query, status, netFilter, sort]);

  const detail = servers.find((s) => s.id === selectedId);
  const modalServer = modal ? servers.find((s) => s.id === modal.serverId) : null;
  const modalChip = modal?.kind === 'node'
    ? modalServer?.chips.find((c) => c.id === modal.chipId)
      ?? modalServer?.chips.find((c) => (c.nodes ?? []).includes(modal.chipId))
    : null;
  const modalIface = modal?.kind === 'iface'
    ? modalServer?.interfaces.find((i) => i.id === modal.ifaceId)
    : null;

  const counts = {
    all: servers.length,
    up: servers.filter((s) => s.status === 'up').length,
    warning: servers.filter((s) => s.status === 'warning').length,
    down: servers.filter((s) => s.status === 'down').length,
  };
  const nodeTotal = servers.reduce((n, s) => n + s.nodes.length, 0);
  const worst = servers.filter((s) => s.disk != null).sort((a, b) => b.disk - a.disk)[0];

  const toggleSort = (key) => {
    if (!key) return;
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  };

  const groups = GROUPS.map(([g, label]) => ({
    id: g,
    label,
    items: rows.filter((s) => groupOf(s) === g).map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.host,
      color: statusColor(s.status),
      count: s.nodes.length,
      state: s.status === 'down' ? `down ${s.downFor}` : s.uptime,
      bad: s.status === 'down',
    })),
  }));

  return (
    <div className="page scroll">
      <PageHead
        title="Servers"
        sub={detail
          ? `${servers.length} hosts · ${detail.name} open`
          : `${servers.length} hosts · ${nodeTotal} nodes`}
      >
        <Search value={query} onChange={setQuery} placeholder="search hosts, ips…" />
        <button type="button" className="add-btn">+ Add server</button>
      </PageHead>

      <FilterRow
        meta={netFilter
          ? `filtered to ${netsById[netFilter]?.name ?? netFilter}`
          : `${rows.length} of ${servers.length} shown`}
      >
        <Chips
          options={[
            ['all', `all ${counts.all}`, null],
            ['up', `up ${counts.up}`, UP],
            ['warning', `warning ${counts.warning}`, WARN],
            ['down', `down ${counts.down}`, DOWN],
          ]}
          value={status}
          onChange={setStatus}
        />
        {netFilter && (
          <button type="button" className="chip active" onClick={() => setNetFilter(null)}>
            net: {netsById[netFilter]?.name ?? netFilter} ×
          </button>
        )}
      </FilterRow>

      {!detail && (
        <TileRow>
            <Tile label="hosts" value={counts.all} hint={`${counts.up} up · ${counts.warning} warn · ${counts.down} down`} />
            <Tile label="nodes" value={nodeTotal} hint="services across all hosts" />
            <Tile label="avg cpu" value={`${summary?.avgCpu ?? '—'}%`} hint={`avg ram ${summary?.avgRam ?? '—'}%`} />
            <Tile
              label="fullest disk"
              value={worst ? `${worst.disk}%` : '—'}
              tone={worst && worst.disk >= 85 ? DOWN : undefined}
              hint={worst?.name}
            />
            <Tile
              label="alerts"
              value={summary?.alerts?.length ?? 0}
              tone={summary?.alerts?.length ? WARN : undefined}
              hint="open, all hosts"
            />
        </TileRow>
      )}

      <MorphLayout
        open={!!detail}
        table={(
          <div className="table-wrap">
            <table className="dtable lg">
              <thead>
                <tr>
                  {COLS.map(([key, label, cls]) => (
                    <th key={label} className={cls} onClick={() => toggleSort(key)}>
                      {label}
                      {key && sort.key === key && (
                        <span className="sort-arrow">{sort.dir === 1 ? ' ▲' : ' ▼'}</span>
                      )}
                    </th>
                  ))}
                  <th aria-label="open" />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const down = s.status === 'down';
                  return (
                    <tr
                      key={s.id}
                      className={down ? 'is-down' : ''}
                      title="open this host"
                      onClick={() => openServer(s.id)}
                    >
                      <td>
                        <div className="sname">
                          <span className="dot" style={{ background: statusColor(s.status) }} />
                          {s.name}
                        </div>
                        <div className="shost">{s.host}</div>
                      </td>
                      <td className="mono">
                        {s.mgmtIp}
                        {s.mgmtVia && <span className="ts-chip">{s.mgmtVia}</span>}
                      </td>
                      <td className="mob-hide"><Pct value={s.cpu} /></td>
                      <td className="mob-hide"><Pct value={s.ram} /></td>
                      <td className="mob-hide"><Pct value={s.disk} /></td>
                      <td className="nodes-cell mob-hide">
                        {down ? (
                          <span className="nil">{s.nodes.length} · {s.nodes.map((n) => n.label).join(' ')}</span>
                        ) : (
                          <>
                            <span className="ncount">{s.nodes.length}</span>
                            <span className="nlist">
                              {' · '}
                              {s.nodes.slice(0, 4).map((n) => n.label.replace(/^vm-/, '')).join(' ')}
                              {s.nodes.length > 4 ? ` +${s.nodes.length - 4}` : ''}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="mob-hide">
                        <div className="badges">
                          {s.netBadges.map((b) => (
                            <button
                              key={b.label}
                              type="button"
                              className={`nbadge${b.net === 'tailnet' ? ' accent' : ''}${netFilter === b.net ? ' on' : ''}`}
                              title="filter by this network · ctrl+click opens the network page"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isDirect(e)) {
                                  go(netPath(b.net));
                                  return;
                                }
                                setNetFilter((f) => (f === b.net ? null : b.net));
                              }}
                            >
                              {b.label}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className={`uptime${down ? ' crit' : ''}`}>
                        {down ? `down ${s.downFor}` : s.uptime}
                      </td>
                      <td className="chevron">›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="table-foot">
              click a host → its page&nbsp;&nbsp;&nbsp;columns sortable&nbsp;&nbsp;&nbsp;badges filter by network · ctrl+click opens the network
            </div>
          </div>
        )}
        rail={(
          <div className="rail">
            <button type="button" className="rail-back" onClick={closeDetail}>
              ‹ all hosts
            </button>
            <MasterList
              groups={groups}
              selectedId={detail?.id}
              onSelect={(id) => openServer(id)}
            />
          </div>
        )}
        detail={detail && (
          <ServerDetail
            server={detail}
            nets={netsById}
            records={dom?.records ?? []}
            highlightNode={nodeParam}
            onOpenNode={(serverId, chipId, nodeId, e) => {
              if (isDirect(e)) {
                go(servicePath(serverId, nodeId ?? primaryNode(detail, chipId)));
                return;
              }
              setModal({ kind: 'node', serverId, chipId });
            }}
            onOpenIface={(serverId, ifaceId) => setModal({ kind: 'iface', serverId, ifaceId })}
            onClose={closeDetail}
          />
        )}
      />

      {modal?.kind === 'node' && modalServer && modalChip && (
        <NodeModal
          server={modalServer}
          chip={modalChip}
          nets={netsById}
          onOpenServer={(id) => setModal({ kind: 'server', id })}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'iface' && modalServer && modalIface && (
        <MiniModal onClose={() => setModal(null)}>
          <InterfacePanel
            server={modalServer}
            iface={modalIface}
            net={netsById[modalIface.net]}
            asCard
            onClose={() => setModal(null)}
          />
        </MiniModal>
      )}
    </div>
  );
}
