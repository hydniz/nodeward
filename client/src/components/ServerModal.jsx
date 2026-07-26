import React from 'react';

const UP = '#3ecf9a';
const WARN = '#e6b450';
const DOWN = '#e0564a';

const statusColor = (s) => (s === 'up' ? UP : s === 'warning' ? WARN : DOWN);
const meterColor = (v) => (v >= 85 ? DOWN : v >= 70 ? WARN : UP);

function Meter({ label, value }) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="meter-val">{value}%</span>
      </div>
      <div className="meter-track">
        <div
          className="meter-fill"
          style={{ width: `${value}%`, background: meterColor(value) }}
        />
      </div>
    </div>
  );
}

export default function ServerModal({ server, nets, onClose, context = 'overview' }) {
  const down = server.status === 'down';
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-crumb">
          <span className="crumb-dim">{context}</span>
          <span className="crumb-sep">›</span>
          <span className="crumb-here">{server.name}</span>
          <span className="crumb-note">host · {server.host}</span>
        </div>
        <header className="modal-head">
          <span className="dot" style={{ background: statusColor(server.status) }} />
          <h2>{server.name}</h2>
          {server.tags.map((t) => (
            <span key={t} className="mchip">{t}</span>
          ))}
          {server.status === 'warning' && (
            <span className="mchip warn">{server.warn}</span>
          )}
          {down ? (
            <span className="mchip down">down {server.downFor}</span>
          ) : (
            <span className="mchip up">up {server.uptime}</span>
          )}
          <button type="button" className="panel-close" onClick={onClose}>×</button>
        </header>

        {down ? (
          <div className="modal-down">
            unreachable · last seen {server.downFor} ago · icmp + ssh timeout
          </div>
        ) : (
          <div className="meters">
            <Meter label="cpu" value={server.cpu} />
            <Meter label="ram" value={server.ram} />
            <Meter label="disk" value={server.disk} />
          </div>
        )}

        <div className="msect">nodes · {server.nodes.length}</div>
        {server.nodes.map((n) => (
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

        <div className="msect">interfaces · {server.interfaces.length}</div>
        {server.interfaces.map((i) => {
          const net = nets?.[i.net];
          const m = i.modal ?? {};
          return (
            <div key={i.id} className="mrow">
              <span
                className="msq"
                style={{ background: down ? DOWN : net?.color ?? '#7f8b99' }}
              />
              <span className="mname iface">{i.title}</span>
              <span className="mdesc ip">{m.ip}</span>
              <span className="mres">
                {m.down ? (
                  '—'
                ) : m.extra ? (
                  m.extra
                ) : (
                  <>
                    <span className="tx">▲{m.tx ?? i.tx}</span>
                    {' '}
                    <span className="rx">▼{m.rx ?? i.rx}</span>
                  </>
                )}
              </span>
            </div>
          );
        })}

        <div className="modal-actions">
          <button type="button" className="btn" disabled={down}>ssh</button>
          <button type="button" className="btn" disabled={down}>console</button>
          <button type="button" className="btn">logs</button>
          <button type="button" className="btn warn" disabled={down}>shutdown</button>
          <span className="modal-link">open server page →</span>
        </div>
      </div>
    </div>
  );
}
