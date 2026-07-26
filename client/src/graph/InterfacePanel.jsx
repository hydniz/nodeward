import React from 'react';

export default function InterfacePanel({ server, iface, net, style, onClose }) {
  const color = net?.color ?? '#7f8b99';
  return (
    <div
      className="panel"
      style={style}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="panel-head">
        <span className="port-glyph" style={{ background: color }} />
        <span className="panel-title">
          {iface.title} <em>@ {server.name}</em>
        </span>
        <span
          className="panel-net"
          style={{ color, borderColor: `${color}66` }}
        >
          {net?.name}
        </span>
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
    </div>
  );
}
