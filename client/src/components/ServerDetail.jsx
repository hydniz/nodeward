import React, { useEffect, useRef } from 'react';
import {
  Tile, TileRow, Sect, DetailHead, KeyRow, Note,
} from './ui.jsx';
import {
  netPath, zonePath, mapPath, isDirect, useGo,
} from '../nav.js';

const UP = '#3ecf9a';
const WARN = '#e6b450';
const DOWN = '#e0564a';

const statusColor = (s) => (s === 'up' ? UP : s === 'warning' ? WARN : DOWN);
const meterTone = (v) => (v >= 85 ? DOWN : v >= 70 ? WARN : UP);

// ---------------------------------------------------------------------------
// the expanded host view on the servers page — same shape as the network and
// zone detail cards: head → tiles → sections. Everything in here links on:
// a service opens its mini overview, an interface its network, a dns record
// its zone (ctrl skips the overview, see nav.js).
// ---------------------------------------------------------------------------
export default function ServerDetail({
  server, nets, records = [], highlightNode, onOpenNode, onOpenIface, onClose,
}) {
  const go = useGo();
  const nodeRef = useRef(null);
  const down = server.status === 'down';

  useEffect(() => {
    if (highlightNode && nodeRef.current) {
      nodeRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlightNode, server.id]);

  const mine = records.filter((r) => r.server === server.id);
  // a deep link names a single service; only if it names a whole stack (chip)
  // does the highlight cover every service in it
  const namesNode = server.nodes.some((n) => n.id === highlightNode);
  const ifaceRows = server.interfaces.map((i) => ({
    ...i,
    net: nets?.[i.net],
    owner: i.node ? server.nodes.find((n) => n.id === i.node)?.label ?? i.node : null,
  }));

  return (
    <section className="detailcard">
      <DetailHead
        glyph="▪"
        color={statusColor(server.status)}
        title={server.name}
        chips={[
          ...server.tags,
          server.status === 'warning' ? server.warn : null,
          down ? `down ${server.downFor}` : `up ${server.uptime}`,
        ]}
        right={(
          <span className="dh-mgmt mono">
            {server.mgmt}
            {server.mgmtVia && <span className="ts-chip">{server.mgmtVia}</span>}
          </span>
        )}
      />
      <button type="button" className="detail-close" onClick={onClose} title="back to the host table">×</button>

      {down ? (
        <div className="modal-down">
          unreachable · last seen {server.downFor} ago · icmp + ssh timeout —
          the values below are the last known state
        </div>
      ) : (
        <TileRow>
          <Tile label="cpu" value={`${server.cpu}%`} tone={meterTone(server.cpu)} bar={server.cpu} />
          <Tile label="ram" value={`${server.ram}%`} tone={meterTone(server.ram)} bar={server.ram} />
          <Tile label="disk" value={`${server.disk}%`} tone={meterTone(server.disk)} bar={server.disk} />
          <Tile label="uptime" value={server.uptime} hint={server.host} />
          <Tile label="services" value={server.nodes.length} hint={`${server.interfaces.length} interfaces`} />
        </TileRow>
      )}

      <Sect>services · {server.nodes.length}</Sect>
      <div className="table-scroll">
        <table className="dtable">
          <thead>
            <tr>
              <th>service</th>
              <th>what it is</th>
              <th className="mob-hide">runs on</th>
              <th className="mob-hide">own interface</th>
            </tr>
          </thead>
          <tbody>
            {server.nodes.map((n) => {
              const chip = server.chips.find((c) => (c.nodes ?? [c.id]).includes(n.id));
              const own = server.interfaces.find((i) => i.node === n.id);
              const hi = !!highlightNode && (namesNode
                ? n.id === highlightNode
                : chip?.id === highlightNode);
              return (
                <tr
                  key={n.id}
                  ref={hi ? nodeRef : null}
                  className={`${n.down || down ? 'is-down' : ''}${hi ? ' is-hi' : ''}`}
                  title="service overview · ctrl+click opens its page"
                  onClick={(e) => onOpenNode?.(server.id, chip?.id ?? n.id, n.id, e)}
                >
                  <td>
                    <span className="t-name">
                      <span
                        className="dot sm"
                        style={{ background: n.down || down ? DOWN : UP }}
                      />
                      {n.label}
                    </span>
                  </td>
                  <td className="t-dim">{n.desc}</td>
                  <td className="t-iface mob-hide">{chip?.kind ?? n.res}</td>
                  <td className="mob-hide">
                    {own ? (
                      <span className="t-node">{own.title} · {own.ips[0]?.ip}</span>
                    ) : (
                      <span className="nil">via host</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Sect>interfaces · {server.interfaces.length}</Sect>
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
            {ifaceRows.map((i) => (
              <tr
                key={i.id}
                className={i.modal?.down ? 'is-down' : ''}
                onClick={(e) => {
                  if (isDirect(e)) {
                    go(netPath(i.net?.id ?? ''));
                    return;
                  }
                  onOpenIface?.(server.id, i.id);
                }}
              >
                <td>
                  <span className="t-name">
                    <span className="msq" style={{ background: i.net?.color ?? '#7f8b99' }} />
                    {i.title}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="nbadge"
                    onClick={(e) => {
                      e.stopPropagation();
                      go(netPath(i.net?.id ?? ''));
                    }}
                  >
                    {i.net?.name ?? i.net}
                  </button>
                </td>
                <td className="mono">
                  {i.ips[0]?.ip}
                  {i.ips.length > 1 && <span className="rec-zone"> +{i.ips.length - 1}</span>}
                </td>
                <td className="t-dim mob-hide">{i.ports}</td>
                <td className="num tx">{i.modal?.down ? '—' : i.tx}</td>
                <td className="num rx">{i.modal?.down ? '—' : i.rx}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mine.length > 0 && (
        <>
          <Sect>dns records pointing here · {mine.length}</Sect>
          {mine.map((r) => (
            <KeyRow
              key={r.id}
              l={r.fqdn}
              owner={r.node ? `→ ${server.nodes.find((n) => n.id === r.node)?.label ?? r.node}` : null}
              r={r.proxied ? '◆ cf proxied' : r.type === 'magicdns' ? 'magicdns' : 'direct'}
              tone={r.proxied ? 'warn' : r.state === 'down' ? 'down' : 'dim'}
              mono
              title="open this zone"
              onClick={() => go(zonePath(r.zone))}
            />
          ))}
        </>
      )}

      <Sect>networks · {server.netBadges.length}</Sect>
      <div className="badges">
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

      {server.status === 'warning' && (
        <>
          <Sect>attention</Sect>
          <Note>{server.warn}</Note>
        </>
      )}

      <div className="modal-actions">
        <button type="button" className="btn" disabled={down}>ssh</button>
        <button type="button" className="btn" disabled={down}>console</button>
        <button type="button" className="btn">logs</button>
        <button type="button" className="btn warn" disabled={down}>shutdown</button>
        <button
          type="button"
          className="panel-openlink"
          onClick={() => go(mapPath(server.id))}
        >
          show on map →
        </button>
      </div>
    </section>
  );
}
