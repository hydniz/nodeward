import React, {
  useRef, useState, useEffect, useMemo, useCallback,
} from 'react';
import { cloudPath, edgeGeometry, dashDuration } from './layout.js';
import InterfacePanel from './InterfacePanel.jsx';
import NetworkPanel from './NetworkPanel.jsx';
import P2PPanel from './P2PPanel.jsx';
import BundlePanel from './BundlePanel.jsx';
import { serverPath, servicePath, netPath, useOpen } from '../nav.js';
import { primaryNode } from '../services.js';

const UP = '#3ecf9a';
const WARN = '#e6b450';
const DOWN = '#e0564a';

const PANEL_MAX = 340;
const HEADER_H = 52; // must match HEADER_H in shared/autoLayout.js

const statusColor = (s) => (s === 'up' ? UP : s === 'warning' ? WARN : DOWN);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

export default function GraphCanvas({
  topology, servers, filter, selectedId, panel, onPanel,
  onSelectServer, onSelectNode,
}) {
  const { world, networks, edges } = topology;
  const p2p = topology.p2p ?? [];
  const bundles = topology.bundles ?? [];
  const labels = topology.labels ?? [];
  const wrapRef = useRef(null);
  const open = useOpen();
  const [view, setView] = useState(null);
  const [hover, setHover] = useState(null);
  const [hoverChip, setHoverChip] = useState(null);
  const interacted = useRef(false);
  const drag = useRef(null);
  const moved = useRef(false);
  const pointers = useRef(new Map());
  const pinch = useRef(null);

  const netsById = useMemo(
    () => Object.fromEntries(networks.map((n) => [n.id, n])), [networks],
  );
  const serversById = useMemo(
    () => Object.fromEntries(servers.map((s) => [s.id, s])), [servers],
  );
  const clouds = useMemo(() => networks.filter((n) => !n.virtual), [networks]);
  const cloudD = useMemo(
    () => Object.fromEntries(clouds.map((n) => [n.id, cloudPath(n)])), [clouds],
  );

  // ---- paths -------------------------------------------------------------
  // the backend ships every endpoint, bend and label box (see LAYOUT.md), so
  // there is nothing to compute here but the svg path strings
  const geo = useMemo(() => {
    const path = (o) => edgeGeometry(o.from, o.to, { bend: o.bend, ctrl: o.ctrl }).d;
    const drawable = edges.filter((e) => e.from && e.to);
    return {
      hostEdges: drawable.filter((e) => !e.ring).map((e) => ({ e, d: path(e) })),
      nodeEdges: drawable.filter((e) => e.ring).map((e) => ({ e, d: path(e) })),
      trunks: bundles.map((b) => ({ b, d: path(b) })),
      links: p2p.filter((L) => L.from && L.to).map((L) => ({
        L, d: path(L), mid: edgeGeometry(L.from, L.to, { bend: L.bend }).at(0.5),
      })),
    };
  }, [edges, bundles, p2p]);

  const portsByServer = useMemo(() => {
    const out = {};
    (topology.ports ?? []).forEach((p) => {
      (out[p.server] ??= []).push(p);
    });
    return out;
  }, [topology.ports]);

  // ---- viewport: fit / zoom / pan -----------------------------------------
  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const k = Math.min(el.clientWidth / world.w, el.clientHeight / world.h) * 0.99;
    setView({
      k,
      x: (el.clientWidth - world.w * k) / 2,
      y: (el.clientHeight - world.h * k) / 2,
    });
  }, [world]);

  useEffect(() => {
    fit();
    const ro = new ResizeObserver(() => {
      if (!interacted.current) fit();
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [fit]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      interacted.current = true;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // ctrlKey = touchpad pinch (small deltas) → stronger factor
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.008 : 0.0016));
      setView((v) => {
        if (!v) return v;
        const k = Math.min(3, Math.max(0.3, v.k * factor));
        const wx = (mx - v.x) / v.k;
        const wy = (my - v.y) / v.k;
        return { k, x: mx - wx * k, y: my - wy * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (factor) => {
    interacted.current = true;
    const el = wrapRef.current;
    setView((v) => {
      if (!v) return v;
      const k = Math.min(3, Math.max(0.3, v.k * factor));
      const cx = el.clientWidth / 2;
      const cy = el.clientHeight / 2;
      const wx = (cx - v.x) / v.k;
      const wy = (cy - v.y) / v.k;
      return { k, x: cx - wx * k, y: cy - wy * k };
    });
  };

  // one pointer pans, two pointers pinch — the same code path for mouse,
  // touchpad and touch screens
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
      drag.current = null;
      moved.current = true; // a pinch is never a click
      return;
    }
    drag.current = { sx: e.clientX, sy: e.clientY };
    moved.current = false;
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = wrapRef.current.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - rect.left;
      const my = (a.y + b.y) / 2 - rect.top;
      const factor = dist / (pinch.current.dist || dist);
      pinch.current.dist = dist;
      interacted.current = true;
      setView((v) => {
        if (!v) return v;
        const k = Math.min(3, Math.max(0.3, v.k * factor));
        const wx = (mx - v.x) / v.k;
        const wy = (my - v.y) / v.k;
        return { k, x: mx - wx * k, y: my - wy * k };
      });
      return;
    }

    if (!drag.current) return;
    const dx = e.clientX - drag.current.sx;
    const dy = e.clientY - drag.current.sy;
    if (!moved.current && Math.hypot(dx, dy) > 4) {
      moved.current = true;
      // capture only once an actual drag starts — capturing on pointerdown
      // would retarget click events away from graph elements
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (moved.current) {
      interacted.current = true;
      drag.current = { sx: e.clientX, sy: e.clientY };
      setView((v) => v && { ...v, x: v.x + dx, y: v.y + dy });
    }
  };

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    drag.current = null;
  };

  // ---- interaction helpers -------------------------------------------------
  // panels are anchored to the clicked element in world coordinates, so the
  // card visibly belongs to its element and follows pan/zoom.
  // ctrl/cmd on any element skips the overview and opens its page (nav.js).
  const openPanel = (e, spec, anchor, color) => {
    e.stopPropagation();
    if (moved.current) return;
    const target = spec.kind === 'net' || spec.kind === 'bundle' || spec.kind === 'p2p'
      ? netPath(spec.netId ?? bundles.find((b) => b.id === spec.bundleId)?.net
        ?? p2p.find((L) => L.id === spec.linkId)?.net)
      : serverPath(spec.serverId);
    if (open(e, target)) return;
    onPanel({ ...spec, anchor, color });
  };

  const clickServer = (e, serverId) => {
    e.stopPropagation();
    if (moved.current) return;
    if (open(e, serverPath(serverId))) return;
    onSelectServer(serverId);
  };

  const clickNode = (e, serverId, chipId) => {
    e.stopPropagation();
    if (moved.current) return;
    if (open(e, servicePath(serverId, primaryNode(serversById[serverId], chipId)))) return;
    onSelectNode(serverId, chipId);
  };

  // ---- dimming (filter chips + selected server) ----------------------------
  const dimSets = useMemo(() => {
    if (filter === 'all') return null;
    if (filter === 'docker') {
      return {
        servers: new Set(
          servers.filter((s) => s.chips.some((c) => c.id === 'dkr')).map((s) => s.id),
        ),
        nets: new Set(),
        edges: new Set(),
      };
    }
    const fe = edges.filter((e) => e.net === filter);
    const sv = new Set(fe.map((e) => e.server));
    const ids = new Set(fe.map((e) => e.id));
    bundles.forEach((b) => b.net === filter && ids.add(b.id));
    p2p.forEach((L) => {
      if (L.net === filter) {
        ids.add(L.id);
        sv.add(L.a.server);
        sv.add(L.b.server);
      }
    });
    return { servers: sv, nets: new Set([filter]), edges: ids };
  }, [filter, servers, edges, bundles, p2p]);

  const dimOf = (kind, id) => {
    if (selectedId) return kind === 'server' && id === selectedId ? 1 : 0.16;
    if (!dimSets) return 1;
    if (kind === 'server') return dimSets.servers.has(id) ? 1 : 0.25;
    if (kind === 'net') return dimSets.nets.has(id) ? 1 : 0.14;
    return dimSets.edges.has(id) ? 1 : 0.08;
  };

  // edge belonging to the open panel stays emphasized
  const activeEdgeId = useMemo(() => {
    if (!panel) return null;
    if (panel.kind === 'p2p') return panel.linkId;
    if (panel.kind === 'bundle') return panel.bundleId;
    if (panel.kind !== 'iface') return null;
    const e = edges.find(
      (x) => x.server === panel.serverId && x.iface === panel.ifaceId,
    );
    if (e) return e.id;
    const L = p2p.find(
      (x) => (x.a.server === panel.serverId && x.a.iface === panel.ifaceId)
        || (x.b.server === panel.serverId && x.b.iface === panel.ifaceId),
    );
    return L?.id ?? null;
  }, [panel, edges, p2p]);

  const renderEdge = (key, d, color, {
    traffic, down, hoverId, groupId, click, anchor, width = 1.4, dashed = true,
  }) => {
    const dur = down ? 0 : dashDuration(traffic);
    const lit = hover === hoverId || hover === groupId
      || activeEdgeId === hoverId || activeEdgeId === groupId;
    return (
      <g key={key} opacity={dimOf('edge', hoverId)} className="edge">
        <path
          d={d}
          className={`edge-line${down ? ' is-down' : ''}${dashed ? '' : ' is-solid'}`}
          stroke={color}
          strokeWidth={lit ? width + 0.9 : width}
          style={{
            opacity: lit ? 1 : undefined,
            animationDuration: dur ? `${dur}s` : undefined,
          }}
        />
        <path
          d={d}
          className="edge-hit"
          onClick={(ev) => openPanel(ev, click, anchor, color)}
          onMouseEnter={() => setHover(hoverId)}
          onMouseLeave={() => setHover(null)}
        />
      </g>
    );
  };

  // ---- panel placement + connector ----------------------------------------
  const panelServer = panel?.serverId ? serversById[panel.serverId] : null;
  const panelIface = panelServer?.interfaces.find((i) => i.id === panel.ifaceId);
  const panelLink = panel?.linkId ? p2p.find((L) => L.id === panel.linkId) : null;
  const panelBundle = panel?.bundleId ? bundles.find((b) => b.id === panel.bundleId) : null;

  let anchorPt = null;
  let panelStyle = null;
  let connector = null;
  if (panel?.anchor && view && wrapRef.current) {
    const bw = wrapRef.current.clientWidth;
    const bh = wrapRef.current.clientHeight;
    // on a phone the card takes the width it can get
    const PANEL_W = Math.min(PANEL_MAX, bw - 20);
    anchorPt = [
      panel.anchor[0] * view.k + view.x,
      panel.anchor[1] * view.k + view.y,
    ];
    let left = anchorPt[0] + 24;
    if (left + PANEL_W > bw - 10) left = anchorPt[0] - 24 - PANEL_W;
    left = clamp(left, 10, Math.max(10, bw - PANEL_W - 10));
    const top = clamp(anchorPt[1] - 48, 10, Math.max(10, bh - 380));
    panelStyle = { left, top, width: PANEL_W };
    const ex = anchorPt[0] < left ? left : anchorPt[0] > left + PANEL_W ? left + PANEL_W : anchorPt[0];
    const ey = anchorPt[0] >= left && anchorPt[0] <= left + PANEL_W
      ? top + (anchorPt[1] < top ? 0 : 0.1)
      : clamp(anchorPt[1], top + 24, top + 120);
    connector = { x1: anchorPt[0], y1: anchorPt[1], x2: ex, y2: ey };
  }

  // ---- render --------------------------------------------------------------
  return (
    <div
      className="graph-wrap"
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      onClick={() => {
        if (!moved.current) onPanel(null);
      }}
    >
      {view && (
        <svg className="graph-svg">
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>

            {/* host-level edges, trunks and p2p links (under clouds/boxes) */}
            <g>
              {geo.hostEdges.map(({ e, d }) => renderEdge(e.id, d,
                e.state === 'down' ? DOWN : netsById[e.net]?.color, {
                  traffic: e.traffic,
                  down: e.state === 'down',
                  hoverId: e.id,
                  groupId: e.bundle,
                  click: { kind: 'iface', serverId: e.server, ifaceId: e.iface },
                  anchor: e.from,
                }))}
              {geo.trunks.map(({ b, d }) => (
                <g key={b.id}>
                  {renderEdge(b.id, d, b.down ? DOWN : b.color, {
                    traffic: b.traffic,
                    down: b.down,
                    hoverId: b.id,
                    click: { kind: 'bundle', bundleId: b.id },
                    anchor: b.from,
                    width: 2.1,
                  })}
                  <circle
                    className="trunk-hub"
                    cx={b.from[0]} cy={b.from[1]} r="3.4"
                    fill={b.down ? DOWN : b.color}
                    opacity={dimOf('edge', b.id)}
                    onClick={(ev) => openPanel(ev, { kind: 'bundle', bundleId: b.id },
                      b.from, b.color)}
                    onMouseEnter={() => setHover(b.id)}
                    onMouseLeave={() => setHover(null)}
                  />
                </g>
              ))}
              {geo.links.map(({ L, d, mid }) => renderEdge(L.id, d, L.color, {
                traffic: L.traffic,
                down: false,
                hoverId: L.id,
                click: { kind: 'p2p', linkId: L.id },
                anchor: mid,
                width: 1.7,
              }))}
            </g>

            {/* network clouds */}
            <g>
              {clouds.map((n) => (
                <g
                  key={n.id}
                  className="cloud"
                  opacity={dimOf('net', n.id)}
                  onClick={(e) => openPanel(e, { kind: 'net', netId: n.id }, [n.x, n.y], n.color)}
                >
                  <path
                    d={cloudD[n.id]}
                    fill={n.color}
                    fillOpacity="0.05"
                    stroke={n.color}
                    strokeOpacity="0.5"
                    strokeWidth="1.2"
                    strokeDasharray="5 5"
                  />
                  <text x={n.x} y={n.y - 2} className="cloud-name" fill={n.color}>
                    {n.name}
                  </text>
                  <text x={n.x} y={n.y + 16} className="cloud-sub">
                    {n.sub}
                  </text>
                </g>
              ))}
            </g>

            {/* server boxes: protected header, service zone, ports */}
            <g>
              {servers.map((s) => {
                const down = s.status === 'down';
                const sel = selectedId === s.id;
                const nameW = s.name.length * 9.2;
                const hy = s.headerY ?? s.y;
                const zoneTop = s.zone?.side === 'top';
                return (
                  <g
                    key={s.id}
                    className={`server${down ? ' is-down' : ''}${
                      hoverChip?.startsWith(`${s.id}/`) ? ' chip-focus' : ''}`}
                    opacity={sel ? 1 : dimOf('server', s.id)}
                    onClick={(e) => clickServer(e, s.id)}
                  >
                    {sel && (
                      <rect
                        x={s.x - 4} y={s.y - 4} width={s.w + 8} height={s.h + 8}
                        rx="12" fill="none" stroke={UP} strokeOpacity="0.35"
                      />
                    )}
                    <rect
                      className="server-box"
                      x={s.x} y={s.y} width={s.w} height={s.h} rx="9"
                      stroke={sel ? UP : down ? 'rgba(224,86,74,.55)' : undefined}
                      strokeDasharray={down ? '5 4' : undefined}
                    />
                    {s.chips.length > 0 && (
                      <line
                        className="zone-rule"
                        x1={s.x + 1} x2={s.x + s.w - 1}
                        y1={zoneTop ? hy : hy + HEADER_H}
                        y2={zoneTop ? hy : hy + HEADER_H}
                      />
                    )}
                    <circle
                      cx={s.x + 17} cy={hy + 21} r="4"
                      fill={statusColor(s.status)} className="server-dot"
                    />
                    <text className="server-name" x={s.x + 29} y={hy + 26}>
                      {s.name}
                    </text>
                    {s.mgmt && (
                      <text className="server-mgmt" x={s.x + 29} y={hy + 44}>
                        {s.mgmt}
                      </text>
                    )}
                    {s.tag && (
                      <text className="server-tag" x={s.x + 35 + nameW} y={hy + 25}>
                        {s.tag}
                      </text>
                    )}
                    {s.status === 'warning' && (
                      <g>
                        <rect
                          x={s.x + 33 + nameW} y={hy + 13} width="15" height="15"
                          rx="3" fill="rgba(230,180,80,.13)"
                          stroke="rgba(230,180,80,.55)" strokeWidth="1"
                        />
                        <text
                          x={s.x + 40.5 + nameW} y={hy + 25}
                          className="warn-glyph"
                        >
                          !
                        </text>
                      </g>
                    )}
                    {down && (
                      <g>
                        <rect
                          x={s.x + 35 + nameW} y={hy + 13} width="46" height="15"
                          rx="3" fill="rgba(224,86,74,.12)"
                          stroke="rgba(224,86,74,.5)" strokeWidth="1"
                        />
                        <text x={s.x + 58 + nameW} y={hy + 24.5} className="down-glyph">
                          DOWN
                        </text>
                      </g>
                    )}

                    {(portsByServer[s.id] || []).map((pt) => (
                      <g key={pt.key}>
                        <rect
                          className="port"
                          x={pt.at[0] - 4} y={pt.at[1] - 4}
                          width="8" height="8" rx="1"
                          fill={pt.down ? DOWN : pt.color}
                          onClick={(ev) => openPanel(ev, {
                            kind: 'iface', serverId: s.id, ifaceId: pt.iface,
                          }, pt.at, pt.color)}
                        />
                        <rect
                          className="anchor-hit"
                          x={pt.at[0] - 11} y={pt.at[1] - 11} width="22" height="22"
                          onClick={(ev) => openPanel(ev, {
                            kind: 'iface', serverId: s.id, ifaceId: pt.iface,
                          }, pt.at, pt.color)}
                        />
                      </g>
                    ))}
                  </g>
                );
              })}
            </g>

            {/* service-level edges — above the boxes, so a link visibly
                starts at the chip that owns it (sidecar / cni) */}
            <g>
              {geo.nodeEdges.map(({ e, d }) => renderEdge(e.id, d,
                netsById[e.net]?.color, {
                  traffic: e.traffic,
                  down: e.state === 'down',
                  hoverId: e.id,
                  groupId: e.bundle,
                  click: { kind: 'iface', serverId: e.server, ifaceId: e.iface },
                  anchor: e.from,
                }))}
            </g>

            {/* service chips — above the service edges, so a stub that
                passes a neighbouring chip runs behind it instead of over it.
                hovering a chip highlights the *chip*: a click here selects the
                service, not its host */}
            <g>
              {servers.map((s) => (
                <g
                  key={s.id}
                  opacity={selectedId === s.id ? 1 : dimOf('server', s.id)}
                >
                  {s.chips.map((c) => {
                    const lit = hoverChip === `${s.id}/${c.id}`;
                    return (
                      <g
                        key={c.id}
                        className={`chip${lit ? ' is-hover' : ''}`}
                        onClick={(e) => clickNode(e, s.id, c.id)}
                        onMouseEnter={() => setHoverChip(`${s.id}/${c.id}`)}
                        onMouseLeave={() => setHoverChip(null)}
                      >
                        {c.ring && (
                          <circle
                            className="chip-ring"
                            cx={c.cx} cy={c.cy} r={c.r + 4} fill="none"
                            stroke={c.ring}
                            strokeOpacity={lit ? 0.95 : 0.5}
                            strokeWidth={lit ? 1.6 : 1.2}
                          />
                        )}
                        {lit && (
                          <circle
                            className="chip-halo"
                            cx={c.cx} cy={c.cy} r={c.r + (c.ring ? 9 : 6)}
                            fill="none"
                          />
                        )}
                        <circle cx={c.cx} cy={c.cy} r={c.r} className="node-chip" />
                        <text x={c.cx} y={c.cy + 3.8} className="chip-label">
                          {c.label}
                        </text>
                      </g>
                    );
                  })}
                </g>
              ))}
            </g>

            {/* ip labels — drawn last so they are never hidden */}
            <g>
              {labels.map((lb) => {
                const stack = lb.rows.length > 1;
                const top = lb.y - lb.h / 2;
                const left = lb.x - lb.w / 2;
                const opacity = Math.max(...lb.edgeIds.map((id) => dimOf('edge', id)));
                return (
                  <g key={lb.id} className="edge-label" opacity={opacity}>
                    <rect x={left} y={top} width={lb.w} height={lb.h} rx="3" />
                    {lb.rows.map((r, i) => {
                      const ry = top + (stack ? 4 : 0) + i * 19;
                      const color = r.down ? DOWN : r.color;
                      return (
                        <g
                          key={r.edgeId}
                          onClick={(ev) => openPanel(ev, r.click, lb.anchor, color)}
                          onMouseEnter={() => setHover(r.edgeId)}
                          onMouseLeave={() => setHover(null)}
                        >
                          <rect
                            className="label-hit"
                            x={left} y={ry} width={lb.w} height="19"
                          />
                          {stack ? (
                            <>
                              <text className="label-tag" x={left + 11} y={ry + 13.6}>
                                {r.tag}
                              </text>
                              <text
                                x={left + 11 + lb.tagW + 8} y={ry + 13.6}
                                fill={color}
                              >
                                {r.text}
                              </text>
                            </>
                          ) : (
                            <text x={lb.x} y={ry + 13.6} fill={color} textAnchor="middle">
                              {r.text}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
      )}

      {/* connector from the clicked element to its info card */}
      {panel && connector && (
        <svg className="panel-link">
          <line
            x1={connector.x1} y1={connector.y1}
            x2={connector.x2} y2={connector.y2}
            stroke={panel.color ?? '#7f8b99'}
          />
          <circle
            cx={connector.x1} cy={connector.y1} r="5"
            fill="none" stroke={panel.color ?? '#7f8b99'} strokeWidth="1.5"
          />
          <circle
            cx={connector.x1} cy={connector.y1} r="1.8"
            fill={panel.color ?? '#7f8b99'}
          />
        </svg>
      )}

      {/* overlays */}
      <div
        className="graph-legend"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span><i className="lg-port" /> port = host interface</span>
        <span><i className="lg-ring" /> ring = service interface</span>
        <span><i className="lg-hub" /> hub = links bundled into one trunk</span>
        <span>cloud = network (star) · direct line = p2p vpn ·
          dash speed = traffic · click anything → overview card ·
          <b>ctrl+click → its page</b></span>
      </div>

      <div
        className="graph-zoom"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="zoom-hint">scroll = zoom · drag = pan</span>
        <div className="zoom-box">
          <button type="button" onClick={() => zoomBy(1 / 1.25)}>−</button>
          <span>{view ? Math.round(view.k * 100) : 100}%</span>
          <button type="button" onClick={() => zoomBy(1.25)}>+</button>
        </div>
        <button
          type="button"
          className="zoom-box zoom-fit"
          onClick={() => { interacted.current = false; fit(); }}
        >
          ⛶ fit
        </button>
      </div>

      {/* floating panels */}
      {panel?.kind === 'iface' && panelServer && panelIface && panelStyle && (
        <InterfacePanel
          server={panelServer}
          iface={panelIface}
          net={netsById[panelIface.net]}
          style={panelStyle}
          onClose={() => onPanel(null)}
        />
      )}
      {panel?.kind === 'net' && netsById[panel.netId] && panelStyle && (
        <NetworkPanel
          net={netsById[panel.netId]}
          edges={edges}
          serversById={serversById}
          style={panelStyle}
          onClose={() => onPanel(null)}
        />
      )}
      {panel?.kind === 'p2p' && panelLink && panelStyle && (
        <P2PPanel
          link={panelLink}
          serversById={serversById}
          style={panelStyle}
          onClose={() => onPanel(null)}
        />
      )}
      {panel?.kind === 'bundle' && panelBundle && panelStyle && (
        <BundlePanel
          bundle={panelBundle}
          net={netsById[panelBundle.net]}
          server={serversById[panelBundle.server]}
          edges={edges}
          style={panelStyle}
          onClose={() => onPanel(null)}
          onOpenIface={(serverId, ifaceId, at, color) => onPanel({
            kind: 'iface', serverId, ifaceId, anchor: at, color,
          })}
        />
      )}
    </div>
  );
}
