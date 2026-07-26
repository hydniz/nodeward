import React from 'react';
import { serverPath, netPath, useGo } from '../nav.js';

// mini overview of a single interface. `asCard` renders it as a centered card
// (used inside a modal on the servers page) instead of a floating panel.
export default function InterfacePanel({
  server, iface, net, style, onClose, asCard,
}) {
  const go = useGo();
  const color = net?.color ?? '#7f8b99';
  return (
    <div
      className={`panel${asCard ? ' as-card' : ''}`}
      style={style}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="panel-head">
        <span className="port-glyph" style={{ background: color }} />
        <span className="panel-title">
          {iface.title} <em>@ {server.name}</em>
        </span>
        <button
          type="button"
          className="panel-net as-btn"
          style={{ color, borderColor: `${color}66` }}
          title={`open the ${net?.name} page`}
          onClick={() => go(netPath(iface.net))}
        >
          {net?.name}
        </button>
        <button type="button" className="panel-close" onClick={onClose}>×</button>
      </div>

      <div className="panel-ips">
        {iface.ips.map((r) => (
          <div key={r.ip} className="panel-row">
            <span className="ip">{r.ip}</span>
            <span className="tag">{r.tag}</span>
          </div>
        ))}
      </div>

      <div className="panel-stats">
        <span><em>rx</em> {iface.rx}</span>
        <span><em>tx</em> {iface.tx} MB/s</span>
        <span><em>ports</em> {iface.ports}</span>
      </div>

      {iface.sectionTitle && (
        <>
          <div className="panel-sect">{iface.sectionTitle}</div>
          {(iface.section ?? []).map((r) => (
            <div key={r.l} className={`panel-row tone-${r.tone || 'dim'}`}>
              <span className="l">{r.l}</span>
              <span className="r">{r.r}</span>
            </div>
          ))}
        </>
      )}

      {iface.extra && <div className="panel-extra">{iface.extra}</div>}
      {iface.note && <div className="panel-note">{iface.note}</div>}

      <button
        type="button"
        className="panel-openlink"
        onClick={() => go(serverPath(server.id))}
      >
        open server page →
      </button>
    </div>
  );
}
