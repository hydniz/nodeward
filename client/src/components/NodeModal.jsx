import React from 'react';
import { serverPath, servicePath, netPath, useGo } from '../nav.js';

const UP = '#3ecf9a';
const DOWN = '#e0564a';

// mini overview of a service/node inside a host (chip click)
export default function NodeModal({ server, chip, nets, onClose, onOpenServer }) {
  const go = useGo();
  const nodeIds = chip.nodes ?? [chip.id];
  const nodes = server.nodes.filter((n) => nodeIds.includes(n.id));
  const ifaces = server.interfaces.filter(
    (i) => i.node && (nodeIds.includes(i.node) || i.node === chip.id),
  );
  const down = server.status === 'down';
  const title = nodes.length === 1 ? nodes[0].label : chip.label;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-crumb">
          <span className="crumb-dim">overview</span>
          <span className="crumb-sep">›</span>
          <button
            type="button"
            className="crumb-link"
            onClick={() => onOpenServer?.(server.id)}
          >
            {server.name}
          </button>
          <span className="crumb-sep">›</span>
          <span className="crumb-here">{title}</span>
          <span className="crumb-note">service on {server.name}</span>
        </div>
        <header className="modal-head">
          <span className="dot" style={{ background: down ? DOWN : UP }} />
          <h2>{title}</h2>
          <span className="mchip">on {server.name}</span>
          {chip.kind && <span className="mchip">{chip.kind}</span>}
          {down ? (
            <span className="mchip down">host down</span>
          ) : (
            <span className="mchip up">running</span>
          )}
          <button type="button" className="panel-close" onClick={onClose}>×</button>
        </header>

        <div className="msect no-line">services · {nodes.length}</div>
        {nodes.map((n) => (
          <button
            key={n.id}
            type="button"
            className="mrow as-link"
            title="open this service's page"
            onClick={() => { onClose?.(); go(servicePath(server.id, n.id)); }}
          >
            <span
              className="dot sm"
              style={{ background: n.down || down ? DOWN : UP }}
            />
            <span className="mname">{n.label}</span>
            <span className="mdesc">{n.desc}</span>
            <span className="mres">{n.res}</span>
          </button>
        ))}

        <div className="msect">interfaces · {ifaces.length}</div>
        {ifaces.length === 0 ? (
          <div className="mnote">
            no own network identity — traffic flows through {server.name}&apos;s
            host interfaces
          </div>
        ) : (
          ifaces.map((i) => {
            const net = nets?.[i.net];
            const m = i.modal ?? {};
            return (
              <button
                key={i.id}
                type="button"
                className="mrow as-link"
                title={`open the ${net?.name ?? i.net} page`}
                onClick={() => { onClose?.(); go(netPath(i.net)); }}
              >
                <span
                  className="msq"
                  style={{ background: net?.color ?? '#7f8b99' }}
                />
                <span className="mname iface">{i.title}</span>
                <span className="mdesc ip">{m.ip}</span>
                <span className="mres">
                  {m.extra ? m.extra : (
                    <>
                      <span className="tx">▲{m.tx ?? i.tx}</span>
                      {' '}
                      <span className="rx">▼{m.rx ?? i.rx}</span>
                    </>
                  )}
                </span>
              </button>
            );
          })
        )}

        <div className="modal-actions">
          <button type="button" className="btn" disabled={down}>logs</button>
          <button type="button" className="btn" disabled={down}>restart</button>
          <span className="modal-links">
            <button
              type="button"
              className="modal-link as-btn"
              onClick={() => { onClose?.(); go(serverPath(server.id, chip.id)); }}
            >
              open host page →
            </button>
            <button
              type="button"
              className="modal-link as-btn"
              onClick={() => { onClose?.(); go(servicePath(server.id, nodes[0]?.id ?? chip.id)); }}
            >
              open service page →
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
