import React from 'react';
import { serverPath, netPath, useGo } from '../nav.js';

export default function NetworkPanel({ net, edges, serversById, style, onClose }) {
  const go = useGo();
  const members = edges
    .filter((e) => e.net === net.id)
    .map((e) => {
      const s = serversById[e.server];
      const iface = s?.interfaces.find((i) => i.id === e.iface);
      return {
        key: e.id,
        serverId: e.server,
        name: e.node ? `${s?.name} · ${e.node}` : s?.name,
        ip: iface?.ips?.[0]?.ip ?? '—',
        rx: iface?.rx,
        tx: iface?.tx,
        down: e.state === 'down' || s?.status === 'down',
      };
    });

  return (
    <div
      className="panel"
      style={style}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="panel-head">
        <span className="cloud-glyph" style={{ color: net.color }}>☁</span>
        <span className="panel-title">{net.name}</span>
        <span
          className="panel-net"
          style={{ color: net.color, borderColor: `${net.color}66` }}
        >
          {net.cidr ?? net.sub}
        </span>
        <button type="button" className="panel-close" onClick={onClose}>×</button>
      </div>

      <div className="panel-sect">members · {members.length}</div>
      {members.map((m) => (
        <button
          key={m.key}
          type="button"
          className={`panel-row as-btn${m.down ? ' tone-down' : ''}`}
          title="open this host's page"
          onClick={() => go(serverPath(m.serverId))}
        >
          <span className={`member${m.down ? ' down' : ''}`}>{m.name}</span>
          <span className="member-ip">
            {m.ip}
            {!m.down && m.tx != null && (
              <span className="member-traffic"> ▲{m.tx} ▼{m.rx}</span>
            )}
          </span>
        </button>
      ))}

      <div className="panel-note">
        {net.kind}
        {net.note ? ` · ${net.note}` : ''}
      </div>

      <button
        type="button"
        className="panel-openlink"
        onClick={() => go(netPath(net.id))}
      >
        open network page →
      </button>
    </div>
  );
}
