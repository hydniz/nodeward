import React from 'react';
import { serverPath, netPath, useGo } from '../nav.js';

// point-to-point vpn link panel: both endpoints, per-side traffic and
// everything routed over the tunnel
export default function P2PPanel({ link, serversById, style, onClose }) {
  const go = useGo();
  const sa = serversById[link.a.server];
  const sb = serversById[link.b.server];
  const ia = sa?.interfaces.find((i) => i.id === link.a.iface);
  const ib = sb?.interfaces.find((i) => i.id === link.b.iface);
  if (!sa || !sb || !ia || !ib) return null;
  const routed = ib.section?.length ? ib : ia;

  return (
    <div
      className="panel"
      style={style}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="panel-head">
        <span className="port-glyph" style={{ background: link.color }} />
        <span className="panel-title">
          {link.title} <em>{sa.name} ⇄ {sb.name}</em>
        </span>
        <span
          className="panel-net"
          style={{ color: link.color, borderColor: `${link.color}66` }}
        >
          p2p vpn
        </span>
        <button type="button" className="panel-close" onClick={onClose}>×</button>
      </div>

      {[[sa, ia], [sb, ib]].map(([s, i]) => (
        <button
          key={s.id}
          type="button"
          className="panel-row as-btn"
          title="open this host's page"
          onClick={() => go(serverPath(s.id))}
        >
          <span className="member">{s.name}</span>
          <span className="member-ip">
            {i.ips[0]?.ip}
            <span className="member-traffic"> ▲{i.tx} ▼{i.rx}</span>
          </span>
        </button>
      ))}

      <div className="panel-stats">
        <span><em>link</em> {ia.ports}</span>
      </div>

      {routed.sectionTitle && (
        <>
          <div className="panel-sect">{routed.sectionTitle}</div>
          {(routed.section ?? []).map((r) => (
            <div key={r.l} className={`panel-row tone-${r.tone || 'dim'}`}>
              <span className="l">{r.l}</span>
              <span className="r">{r.r}</span>
            </div>
          ))}
        </>
      )}

      {ia.note && <div className="panel-note">{ia.note}</div>}

      <button
        type="button"
        className="panel-openlink"
        onClick={() => go(netPath(link.net))}
      >
        open network page →
      </button>
    </div>
  );
}
