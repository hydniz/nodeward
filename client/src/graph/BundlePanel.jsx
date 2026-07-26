import React from 'react';
import { serverPath, netPath, useGo } from '../nav.js';

// info card for a trunk (R9): all links one host has into one network,
// bundled into a single line on the map
export default function BundlePanel({
  bundle, net, server, edges, style, onClose, onOpenIface,
}) {
  const go = useGo();
  const members = bundle.members
    .map((id) => edges.find((e) => e.id === id))
    .filter(Boolean)
    .map((e) => {
      const iface = server?.interfaces.find((i) => i.id === e.iface);
      const owner = e.node
        ? server?.chips.find((c) => c.id === e.node)?.label ?? e.node
        : e.iface;
      return {
        id: e.id,
        ifaceId: e.iface,
        owner,
        title: iface?.title ?? e.iface,
        ip: e.label ?? iface?.ips?.[0]?.ip ?? '—',
        rx: iface?.rx,
        tx: iface?.tx,
        down: e.state === 'down',
        at: e.from,
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
        <span className="hub-glyph" style={{ background: bundle.color }} />
        <span className="panel-title">
          {server?.name} <em>⇢ {net?.name}</em>
        </span>
        <span
          className="panel-net"
          style={{ color: bundle.color, borderColor: `${bundle.color}66` }}
        >
          {members.length} links
        </span>
        <button type="button" className="panel-close" onClick={onClose}>×</button>
      </div>

      <div className="panel-stats">
        <span><em>trunk</em> {bundle.traffic} MB/s</span>
        <span><em>side</em> {bundle.side}</span>
        <span><em>net</em> {net?.cidr ?? net?.sub}</span>
      </div>

      <div className="panel-sect">interfaces in this trunk</div>
      {members.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`panel-row as-btn${m.down ? ' tone-down' : ''}`}
          onClick={() => onOpenIface?.(server.id, m.ifaceId, m.at, bundle.color)}
        >
          <span className={`member${m.down ? ' down' : ''}`}>{m.owner}</span>
          <span className="member-ip">
            {m.ip}
            {!m.down && m.tx != null && (
              <span className="member-traffic"> ▲{m.tx} ▼{m.rx}</span>
            )}
          </span>
        </button>
      ))}

      <div className="panel-note">
        {members.length} interfaces of {server?.name} join {net?.name} — drawn as
        one trunk so the lines stay countable. click a row for its interface.
      </div>

      <button
        type="button"
        className="panel-openlink"
        onClick={() => go(serverPath(server?.id))}
      >
        open server page →
      </button>
      <button
        type="button"
        className="panel-openlink"
        onClick={() => go(netPath(net?.id))}
      >
        open network page →
      </button>
    </div>
  );
}
