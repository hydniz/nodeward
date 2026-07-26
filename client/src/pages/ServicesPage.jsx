import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../api.js';
import ServerModal from '../components/ServerModal.jsx';
import NodeModal from '../components/NodeModal.jsx';
import ServiceDetail from '../components/ServiceDetail.jsx';
import MorphLayout from '../components/MorphLayout.jsx';
import InterfacePanel from '../graph/InterfacePanel.jsx';
import {
  PageHead, Search, Chips, FilterRow, Tile, TileRow, MasterList, MiniModal,
} from '../components/ui.jsx';
import { buildServices, RUNTIMES } from '../services.js';
import { serverPath, isDirect, useGo } from '../nav.js';

const UP = '#3ecf9a';
const WARN = '#e6b450';
const DOWN = '#e0564a';

const FILTERS = [
  ['all', 'All'],
  ['docker', 'Docker'],
  ['k3s', 'k3s'],
  ['vm', 'VMs'],
  ['native', 'Native'],
];

const COLS = [
  ['name', 'service', ''],
  ['host', 'host', ''],
  ['kind', 'stack / runtime', 'mob-hide'],
  ['ip', 'address', ''],
  [null, 'exposure', 'mob-hide'],
  [null, 'dns', 'mob-hide'],
  ['tx', 'traffic', 'mob-hide'],
];

export default function ServicesPage() {
  const { data: srv } = useApi('/api/servers');
  const { data: topo } = useApi('/api/topology');
  const { data: dom } = useApi('/api/domains');
  const [params, setParams] = useSearchParams();
  const go = useGo();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState({ key: null, dir: 1 });
  // mini overview: host | node (stack) | iface
  const [modal, setModal] = useState(null);

  const selectedId = params.get('service');

  const netsById = useMemo(
    () => Object.fromEntries((topo?.networks ?? []).map((n) => [n.id, n])),
    [topo],
  );
  const services = useMemo(
    () => (srv ? buildServices(srv.servers, dom?.records ?? [], netsById) : []),
    [srv, dom, netsById],
  );

  const openService = (id) => {
    setModal(null);
    setParams({ service: id });
  };
  const closeDetail = () => setParams({});

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
    let list = services.filter((s) => {
      if (filter !== 'all' && s.runtime !== filter) return false;
      if (!q) return true;
      return [s.name, s.desc, s.server.name, s.kind, s.ip,
        ...s.records.map((r) => r.fqdn)]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    const { key, dir } = sort;
    if (key) {
      list = [...list].sort((a, b) => {
        const pick = (s) => {
          if (key === 'host') return s.server.name;
          if (key === 'tx') return s.tx + s.rx;
          return s[key] ?? '';
        };
        const av = pick(a);
        const bv = pick(b);
        if (typeof av === 'string') return av.localeCompare(bv) * dir;
        return (av - bv) * dir;
      });
    }
    return list;
  }, [services, query, filter, sort]);

  const detail = services.find((s) => s.id === selectedId);
  const siblings = detail
    ? services.filter((s) => s.server.id === detail.server.id
      && s.id !== detail.id
      && detail.stack.includes(s.nodeId))
    : [];

  const modalServer = modal
    ? srv?.servers.find((s) => s.id === (modal.kind === 'server' ? modal.id : modal.serverId))
    : null;
  const modalChip = modal?.kind === 'node'
    ? modalServer?.chips.find((c) => c.id === modal.chipId)
    : null;
  const modalIface = modal?.kind === 'iface'
    ? modalServer?.interfaces.find((i) => i.id === modal.ifaceId)
    : null;

  const counts = {
    all: services.length,
    own: services.filter((s) => s.ip).length,
    public: services.filter((s) => s.exposure.cls === 'proxied' || s.exposure.cls === 'direct').length,
    down: services.filter((s) => s.down).length,
  };

  const toggleSort = (key) => {
    if (!key) return;
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  };

  const groups = RUNTIMES.map(([id, label]) => ({
    id,
    label,
    items: rows.filter((s) => s.runtime === id).map((s) => ({
      id: s.id,
      name: s.name,
      kind: `${s.server.name} · ${s.desc}`,
      color: s.down ? DOWN : s.warn ? WARN : UP,
      count: s.records.length || '–',
      state: s.ip ?? 'via host',
      bad: s.down,
    })),
  }));

  const table = (
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
          {rows.map((s) => (
            <tr
              key={s.id}
              className={s.down ? 'is-down' : ''}
              title="open this service"
              onClick={() => openService(s.id)}
            >
              <td>
                <div className="sname">
                  <span
                    className="dot"
                    style={{ background: s.down ? DOWN : s.warn ? WARN : UP }}
                  />
                  {s.name}
                </div>
                <div className="shost">{s.desc}</div>
              </td>
              <td>
                <button
                  type="button"
                  className="rec-host as-btn"
                  title="host overview · ctrl+click opens its page"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isDirect(e)) {
                      go(serverPath(s.server.id));
                      return;
                    }
                    setModal({ kind: 'server', id: s.server.id });
                  }}
                >
                  {s.server.name}
                </button>
              </td>
              <td className="t-dim mob-hide">{s.kind}</td>
              <td className="mono">
                {s.ip ?? <span className="nil">via host</span>}
              </td>
              <td className="mob-hide">
                <span className={`expose ${s.exposure.cls}`}>{s.exposure.text}</span>
              </td>
              <td className="mob-hide">
                {s.records.length ? (
                  <span className="ncount">{s.records.length}</span>
                ) : (
                  <span className="nil">—</span>
                )}
              </td>
              <td className="mob-hide">
                {s.ifaces.length ? (
                  <span className="mres">
                    <span className="tx">▲{s.tx.toFixed(1)}</span>{' '}
                    <span className="rx">▼{s.rx.toFixed(1)}</span>
                  </span>
                ) : (
                  <span className="nil">—</span>
                )}
              </td>
              <td className="chevron">›</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-foot">
        click a service → its page&nbsp;&nbsp;&nbsp;host name → host overview&nbsp;&nbsp;&nbsp;columns sortable
      </div>
    </div>
  );

  return (
    <div className="page scroll">
      <PageHead
        title="Services"
        sub={detail
          ? `${services.length} services · ${detail.name} open`
          : `${services.length} services on ${srv?.servers.length ?? 0} hosts`}
      >
        <Search value={query} onChange={setQuery} placeholder="search services, names…" />
      </PageHead>

      <FilterRow
        meta={detail
          ? `${detail.server.name} · ${detail.kind}`
          : `${rows.length} of ${services.length} shown`}
      >
        <Chips options={FILTERS} value={filter} onChange={setFilter} />
      </FilterRow>

      {!detail && (
        <TileRow>
          <Tile label="services" value={counts.all} hint={`across ${srv?.servers.length ?? 0} hosts`} />
          <Tile label="own identity" value={counts.own} hint="services with their own ip" />
          <Tile label="public" value={counts.public} hint="reachable from the internet" />
          <Tile
            label="unreachable"
            value={counts.down}
            tone={counts.down ? DOWN : UP}
            hint={counts.down ? 'host down' : 'all hosts answering'}
          />
        </TileRow>
      )}

      <MorphLayout
        open={!!detail}
        table={table}
        rail={(
          <div className="rail">
            <button type="button" className="rail-back" onClick={closeDetail}>
              ‹ all services
            </button>
            <MasterList groups={groups} selectedId={detail?.id} onSelect={openService} />
          </div>
        )}
        detail={detail && (
          <ServiceDetail
            service={detail}
            nets={netsById}
            siblings={siblings}
            onOpenHost={(id) => setModal({ kind: 'server', id })}
            onOpenIface={(serverId, ifaceId) => setModal({ kind: 'iface', serverId, ifaceId })}
            onClose={closeDetail}
          />
        )}
      />

      {modal?.kind === 'server' && modalServer && (
        <ServerModal
          server={modalServer}
          nets={netsById}
          context="services"
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
