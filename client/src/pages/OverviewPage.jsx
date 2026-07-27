import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useApi } from '../api.js';
import GraphCanvas from '../graph/GraphCanvas.jsx';
import ServerModal from '../components/ServerModal.jsx';
import NodeModal from '../components/NodeModal.jsx';

const FILTERS = [
  ['all', 'All systems'],
  ['tailnet', 'Tailnet'],
  ['k3s', 'k3s cluster'],
  ['wg0', 'wg0'],
  ['docker', 'Docker'],
];

export default function OverviewPage() {
  const { data: topo } = useApi('/api/topology');
  const { data: srv } = useApi('/api/servers');
  // ?focus=<host> — where "show on map" from any other page lands
  const [params, setParams] = useSearchParams();
  const focusId = params.get('focus');
  const [filter, setFilter] = useState('all');
  const [panel, setPanel] = useState(null);
  // modal: null | { kind: 'server', id } | { kind: 'node', serverId, chipId }
  const [modal, setModal] = useState(null);
  const [tick, setTick] = useState(2);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => (n % 9) + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setModal((m) => {
        if (m) return null;
        setPanel(null);
        return m;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const servers = srv?.servers ?? [];
  const netsById = useMemo(
    () => Object.fromEntries((topo?.networks ?? []).map((n) => [n.id, n])),
    [topo],
  );

  const modalServer = modal
    ? servers.find((s) => s.id === (modal.kind === 'server' ? modal.id : modal.serverId))
    : null;
  const modalChip = modal?.kind === 'node'
    ? modalServer?.chips.find((c) => c.id === modal.chipId)
      ?? modalServer?.chips.find((c) => (c.nodes ?? []).includes(modal.chipId))
    : null;

  const focusServer = focusId ? servers.find((s) => s.id === focusId) : null;

  const subtitle = () => {
    if (modalChip) return `full mesh · ${modalChip.label} @ ${modalServer.name} selected`;
    if (modalServer) return `full mesh · ${modalServer.name} selected`;
    if (focusServer) return `full mesh · focused on ${focusServer.name}`;
    return `full mesh · updated ${tick}s ago`;
  };

  if (!topo || !srv) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>Overview</h1>
            <div className="page-sub">connecting…</div>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Overview</h1>
          <div className="page-sub">{subtitle()}</div>
        </div>
        <div className="chips">
          {focusServer && (
            <button
              type="button"
              className="chip active"
              title="clear the focus"
              onClick={() => setParams({}, { replace: true })}
            >
              focus: {focusServer.name} ×
            </button>
          )}
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`chip${filter === id ? ' active' : ''}`}
              onClick={() => setFilter((f) => (f === id && id !== 'all' ? 'all' : id))}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <GraphCanvas
        topology={topo}
        servers={servers}
        filter={filter}
        selectedId={modalServer?.id ?? focusServer?.id ?? null}
        panel={panel}
        onPanel={setPanel}
        onSelectServer={(id) => {
          setPanel(null);
          setModal({ kind: 'server', id });
        }}
        onSelectNode={(serverId, chipId) => {
          setPanel(null);
          setModal({ kind: 'node', serverId, chipId });
        }}
      />

      {modalServer && !modalChip && (
        <ServerModal
          server={modalServer}
          nets={netsById}
          context="overview"
          onOpenNode={(serverId, chipId) => setModal({ kind: 'node', serverId, chipId })}
          onClose={() => setModal(null)}
        />
      )}
      {modalServer && modalChip && (
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
