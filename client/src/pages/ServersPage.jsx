import React, { useState, useEffect, useMemo } from 'react';
import { useApi } from '../api.js';
import ServerModal from '../components/ServerModal.jsx';

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
  ['name', 'server'],
  ['mgmtIp', 'mgmt ip'],
  ['cpu', 'cpu'],
  ['ram', 'ram'],
  ['disk', 'disk'],
  ['nodes', 'nodes'],
  [null, 'networks'],
  ['uptimeDays', 'uptime'],
];

export default function ServersPage() {
  const { data: srv } = useApi('/api/servers');
  const { data: summary } = useApi('/api/summary');
  const { data: topo } = useApi('/api/topology');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [netFilter, setNetFilter] = useState(null);
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const [modalId, setModalId] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setModalId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const servers = srv?.servers ?? [];
  const netsById = useMemo(
    () => Object.fromEntries((topo?.networks ?? []).map((n) => [n.id, n])),
    [topo],
  );

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

  const modal = servers.find((s) => s.id === modalId);
  const counts = {
    all: servers.length,
    up: servers.filter((s) => s.status === 'up').length,
    warning: servers.filter((s) => s.status === 'warning').length,
    down: servers.filter((s) => s.status === 'down').length,
  };
  const nodeTotal = servers.reduce((n, s) => n + s.nodes.length, 0);

  const toggleSort = (key) => {
    if (!key) return;
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  };

  return (
    <div className="page scroll">
      <header className="page-head">
        <div>
          <h1>Servers</h1>
          <div className="page-sub">{servers.length} hosts · {nodeTotal} nodes</div>
        </div>
        <div className="head-tools">
          <input
            className="search"
            placeholder="search hosts, ips…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="add-btn">+ Add server</button>
        </div>
      </header>

      <div className="filter-row">
        {[
          ['all', `all ${counts.all}`, null],
          ['up', `up ${counts.up}`, UP],
          ['warning', `warning ${counts.warning}`, WARN],
          ['down', `down ${counts.down}`, DOWN],
        ].map(([id, label, color]) => (
          <button
            key={id}
            type="button"
            className={`chip${status === id ? ' active' : ''}`}
            onClick={() => setStatus(id)}
          >
            {color && <span className="chip-dot" style={{ background: color }} />}
            {label}
          </button>
        ))}
        {netFilter && (
          <button
            type="button"
            className="chip active"
            onClick={() => setNetFilter(null)}
          >
            net: {netsById[netFilter]?.name ?? netFilter} ×
          </button>
        )}
        <span className="filter-avg">
          avg cpu {summary?.avgCpu ?? '—'}% · avg ram {summary?.avgRam ?? '—'}%
        </span>
      </div>

      <div className="table-wrap">
        <table className="servers-table">
          <thead>
            <tr>
              {COLS.map(([key, label]) => (
                <th key={label} onClick={() => toggleSort(key)}>
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
                  onClick={() => setModalId(s.id)}
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
                  <td><Pct value={s.cpu} /></td>
                  <td><Pct value={s.ram} /></td>
                  <td><Pct value={s.disk} /></td>
                  <td className="nodes-cell">
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
                  <td>
                    <div className="badges">
                      {s.netBadges.map((b) => (
                        <button
                          key={b.label}
                          type="button"
                          className={`nbadge${b.net === 'tailnet' ? ' accent' : ''}${netFilter === b.net ? ' on' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
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
          click row → server detail&nbsp;&nbsp;&nbsp;columns sortable&nbsp;&nbsp;&nbsp;badges filter by network
        </div>
      </div>

      {modal && (
        <ServerModal
          server={modal}
          nets={netsById}
          context="servers"
          onClose={() => setModalId(null)}
        />
      )}
    </div>
  );
}
