import React from 'react';
import {
  Tile, TileRow, Sect, DetailHead, KeyRow, Note,
} from './ui.jsx';
import {
  serverPath, servicePath, netPath, zonePath, mapPath, isDirect, useGo,
} from '../nav.js';

const UP = '#3ecf9a';
const WARN = '#e6b450';
const DOWN = '#e0564a';

// ---------------------------------------------------------------------------
// expanded service view — same shape as the host, network and zone detail:
// head → tiles → sections, everything linking on to the thing it names.
// ---------------------------------------------------------------------------
export default function ServiceDetail({
  service, nets, siblings, onOpenHost, onOpenIface, onClose,
}) {
  const go = useGo();
  const { server, chip } = service;
  const state = service.down ? DOWN : service.warn ? WARN : UP;

  return (
    <section className="detailcard">
      <DetailHead
        glyph="○"
        color={state}
        title={service.name}
        chips={[
          `on ${server.name}`,
          service.kind,
          service.down ? 'host down' : 'running',
        ]}
        right={(
          <span className="dh-mgmt mono">
            {service.ip ?? 'via host'}
          </span>
        )}
      />
      <button
        type="button"
        className="detail-close"
        onClick={onClose}
        title="back to all services"
      >
        ×
      </button>

      <TileRow>
        <Tile label="host" value={server.name} hint={server.host} />
        <Tile label="runtime" value={service.runtime} hint={service.res} />
        <Tile
          label="own identity"
          value={service.ip ? 'yes' : 'no'}
          hint={service.ip ?? `shares ${server.name}'s interfaces`}
        />
        <Tile
          label="exposure"
          value={service.exposure.text}
          tone={service.exposure.cls === 'proxied' ? WARN : undefined}
          hint={`${service.records.length} dns records`}
        />
        <Tile
          label="traffic"
          value={service.ifaces.length ? `▲${service.tx.toFixed(1)} ▼${service.rx.toFixed(1)}` : '—'}
          hint={service.ifaces.length ? 'MB/s on own interfaces' : 'no own interface'}
        />
      </TileRow>

      <Sect>what it is</Sect>
      <Note>{service.desc}</Note>
      {service.down && (
        <div className="modal-down">
          {server.name} is unreachable — this service has not been seen since
          {' '}{server.downFor} ago
        </div>
      )}

      {siblings.length > 0 && (
        <>
          <Sect>same stack · {chip?.label ?? '—'}</Sect>
          {siblings.map((s) => (
            <KeyRow
              key={s.id}
              l={s.name}
              owner={s.desc}
              r={s.ip ?? 'via host'}
              tone={s.down ? 'down' : 'dim'}
              title="open this service"
              onClick={() => go(servicePath(s.server.id, s.nodeId))}
            />
          ))}
        </>
      )}

      <Sect>interfaces · {service.ifaces.length}</Sect>
      {service.ifaces.length === 0 ? (
        <>
          <Note>
            no own network identity — traffic flows through {server.name}&apos;s
            host interfaces
          </Note>
          {server.interfaces.filter((i) => !i.node).map((i) => (
            <KeyRow
              key={i.id}
              l={i.title}
              owner={nets?.[i.net]?.name}
              r={i.ips[0]?.ip}
              title="open this network"
              onClick={() => go(netPath(i.net))}
              mono
            />
          ))}
        </>
      ) : (
        <div className="table-scroll">
          <table className="dtable">
            <thead>
              <tr>
                <th>iface</th>
                <th>network</th>
                <th>address</th>
                <th className="mob-hide">ports / details</th>
                <th className="num">▲ tx</th>
                <th className="num">▼ rx</th>
              </tr>
            </thead>
            <tbody>
              {service.ifaces.map((i) => (
                <tr
                  key={i.id}
                  onClick={(e) => {
                    if (isDirect(e)) {
                      go(netPath(i.net));
                      return;
                    }
                    onOpenIface?.(server.id, i.id);
                  }}
                >
                  <td>
                    <span className="t-name">
                      <span className="msq" style={{ background: nets?.[i.net]?.color ?? '#7f8b99' }} />
                      {i.title}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="nbadge"
                      onClick={(e) => {
                        e.stopPropagation();
                        go(netPath(i.net));
                      }}
                    >
                      {nets?.[i.net]?.name ?? i.net}
                    </button>
                  </td>
                  <td className="mono">{i.ips[0]?.ip}</td>
                  <td className="t-dim mob-hide">{i.ports}</td>
                  <td className="num tx">{service.down ? '—' : i.tx}</td>
                  <td className="num rx">{service.down ? '—' : i.rx}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {service.records.length > 0 && (
        <>
          <Sect>dns records pointing here · {service.records.length}</Sect>
          {service.records.map((r) => (
            <KeyRow
              key={r.id}
              l={r.fqdn}
              owner={r.type}
              r={r.proxied ? '◆ cf proxied' : r.type === 'magicdns' ? 'magicdns' : 'direct'}
              tone={r.proxied ? 'warn' : r.state === 'down' ? 'down' : 'dim'}
              mono
              title="open this zone"
              onClick={() => go(zonePath(r.zone))}
            />
          ))}
        </>
      )}

      <Sect>host</Sect>
      <KeyRow
        l={server.name}
        owner={server.host}
        r={server.status === 'down' ? `down ${server.downFor}` : `up ${server.uptime}`}
        tone={server.status === 'down' ? 'down' : 'accent'}
        title="host overview · ctrl+click opens its page"
        onClick={(e) => (isDirect(e) ? go(serverPath(server.id)) : onOpenHost?.(server.id))}
      />
      <div className="badges badges-row">
        {server.netBadges.map((b) => (
          <button
            key={b.label}
            type="button"
            className={`nbadge${b.net === 'tailnet' ? ' accent' : ''}`}
            onClick={() => go(netPath(b.net))}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="modal-actions">
        <button type="button" className="btn" disabled={service.down}>logs</button>
        <button type="button" className="btn" disabled={service.down}>restart</button>
        <span className="modal-links">
          <button
            type="button"
            className="modal-link as-btn"
            onClick={() => go(serverPath(server.id, service.nodeId))}
          >
            open host page →
          </button>
          <button
            type="button"
            className="modal-link as-btn"
            onClick={() => go(mapPath(server.id))}
          >
            show on map →
          </button>
        </span>
      </div>
    </section>
  );
}
