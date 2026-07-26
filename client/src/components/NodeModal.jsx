import React from 'react';

const UP = '#3ecf9a';
const DOWN = '#e0564a';

// detail modal for a service/node inside a host (chip click)
export default function NodeModal({ server, chip, nets, onClose, onOpenServer }) {
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
          <div key={n.id} className="mrow">
            <span
              className="dot sm"
              style={{ background: n.down || down ? DOWN : UP }}
            />
            <span className="mname">{n.label}</span>
            <span className="mdesc">{n.desc}</span>
            <span className="mres">{n.res}</span>
          </div>
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
              <div key={i.id} className="mrow">
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
              </div>
            );
          })
        )}

        <div className="modal-actions">
          <button type="button" className="btn" disabled={down}>logs</button>
          <button type="button" className="btn" disabled={down}>restart</button>
          <span className="modal-link">open service page →</span>
        </div>
      </div>
    </div>
  );
}
