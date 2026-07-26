import React from 'react';
import {
  serverPath, servicePath, netPath, zonePath, useGo,
} from '../nav.js';

const UP = '#3ecf9a';
const DOWN = '#e0564a';

// mini overview of a single dns record: where it points, who answers it,
// what terminates the tls — plus the way to each of those pages
export default function RecordModal({
  record, zone, net, server, node, onClose, context = 'domains',
}) {
  const go = useGo();
  const leave = (path) => { onClose?.(); go(path); };
  const cert = record.cert;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-crumb">
          <span className="crumb-dim">{context}</span>
          <span className="crumb-sep">›</span>
          <button
            type="button"
            className="crumb-link"
            onClick={() => leave(zonePath(zone.id))}
          >
            {zone.name}
          </button>
          <span className="crumb-sep">›</span>
          <span className="crumb-here">{record.name === '@' ? '@' : record.name}</span>
          <span className="crumb-note">{zone.dns}</span>
        </div>

        <header className="modal-head">
          <span className={`rtype ${record.type.toLowerCase()}`}>{record.type}</span>
          <h2>{record.fqdn}</h2>
          <span className={`mchip${record.down ? ' down' : ''}`}>
            {record.exposure.text}
          </span>
          {cert && (
            <span className={`mchip${cert.days < 14 ? ' down' : cert.days < 30 ? ' warn' : ' up'}`}>
              tls {cert.days < 0 ? 'expired' : `${cert.days}d`}
            </span>
          )}
          <button type="button" className="panel-close" onClick={onClose}>×</button>
        </header>

        <div className="msect no-line">answer</div>
        <div className="mrow rec-answer">
          <span className="msq" style={{ background: net?.color ?? '#7f8b99' }} />
          <span className="mname iface">{record.type}</span>
          <span className="mdesc ip">{record.value}</span>
          <span className="mres">ttl {record.ttl ?? '—'}</span>
        </div>
        {record.via && (
          <div className="mnote">path: {record.via}</div>
        )}

        {server && (
          <>
            <div className="msect">terminates at</div>
            <button
              type="button"
              className="mrow as-link"
              title={node ? "open this service's page" : "open this host's page"}
              onClick={() => leave(node
                ? servicePath(server.id, node.id)
                : serverPath(server.id))}
            >
              <span
                className="dot sm"
                style={{ background: record.down ? DOWN : UP }}
              />
              <span className="mname">{server.name}</span>
              <span className="mdesc">
                {node
                  ? (node.desc.startsWith(node.label) ? node.desc : `${node.label} · ${node.desc}`)
                  : server.host}
              </span>
              <span className="mres">{record.iface?.title ?? ''}</span>
            </button>
            {net && (
              <button
                type="button"
                className="mrow as-link"
                onClick={() => leave(netPath(net.id))}
              >
                <span className="msq" style={{ background: net.color }} />
                <span className="mname iface">{net.name}</span>
                <span className="mdesc">{net.kind}</span>
                <span className="mres">{net.cidr ?? net.sub}</span>
              </button>
            )}
          </>
        )}

        {cert && (
          <>
            <div className="msect">certificate</div>
            <div className="mrow">
              <span className="msq" style={{ background: cert.days < 14 ? DOWN : UP }} />
              <span className="mname iface">tls</span>
              <span className="mdesc">{cert.issuer}</span>
              <span className="mres">
                {cert.days < 0 ? 'expired' : `${cert.days}d left`} · {cert.expires}
              </span>
            </div>
          </>
        )}

        {record.note && <div className="mnote">{record.note}</div>}

        <div className="modal-actions">
          <button type="button" className="btn">dig</button>
          <button type="button" className="btn">check tls</button>
          <span className="modal-links">
            {server && node && (
              <button
                type="button"
                className="modal-link as-btn"
                onClick={() => leave(servicePath(server.id, node.id))}
              >
                open service page →
              </button>
            )}
            {server && (
              <button
                type="button"
                className="modal-link as-btn"
                onClick={() => leave(serverPath(server.id, node?.id))}
              >
                open server page →
              </button>
            )}
            <button
              type="button"
              className="modal-link as-btn"
              onClick={() => leave(zonePath(zone.id))}
            >
              open zone page →
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
