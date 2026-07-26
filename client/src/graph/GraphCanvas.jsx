import React, {
  useRef, useState, useEffect, useMemo, useCallback,
} from 'react';
import {
  cloudPath, anchorPoint, cloudAnchor, edgeGeometry, chipCenters, dashDuration,
} from './layout.js';
import InterfacePanel from './InterfacePanel.jsx';
import NetworkPanel from './NetworkPanel.jsx';
import P2PPanel from './P2PPanel.jsx';

const UP = '#3ecf9a';
const WARN = '#e6b450';
const DOWN = '#e0564a';

const PANEL_W = 340;

const statusColor = (s) => (s === 'up' ? UP : s === 'warning' ? WARN : DOWN);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

export default function GraphCanvas({
  topology, servers, filter, selectedId, panel, onPanel,
  onSelectServer, onSelectNode,
}) {
  const { world, networks, edges } = topology;
  const p2p = topology.p2p ?? [];
  const wrapRef = useRef(null);
  const [view, setView] = useState(null);
  const [hover, setHover] = useState(null);
  const interacted = useRef(false);
  const drag = useRef(null);
  const moved = useRef(false);

  const netsById = useMemo(
    () => Object.fromEntries(networks.map((n) => [n.id, n])), [networks],
  );
  const serversById = useMemo(
    () => Object.fromEntries(servers.map((s) => [s.id, s])), [servers],
  );
  const chipsById = useMemo(
    () => Object.fromEntries(servers.map((s) => [s.id, chipCenters(s)])), [servers],
  );
  const clouds = useMemo(() => networks.filter((n) => !n.virtual), [networks]);
  const cloudD = useMemo(
    () => Object.fromEntries(clouds.map((n) => [n.id, cloudPath(n)])), [clouds],
  );

  // ---- resolved geometry ---------------------------------------------------
  // server-level edges attach to border ports; node-level edges start at the
  // service chip's ring (drawn above the box); p2p links join two ports.
  const geo = useMemo(() => {
    const serverEdges = [];
    const nodeEdges = [];
    const ports = {};
    edges.forEach((e) => {
      const s = serversById[e.server];
      const n = netsById[e.net];
      if (!s || !n) return;
      if (e.ring) {
        const chip = chipsById[s.id]?.[e.node];
        if (!chip) return;
        const dx = n.x - chip.cx;
        const dy = n.y - chip.cy;
        const l = Math.hypot(dx, dy) || 1;
        const p0 = [
          chip.cx + (dx / l) * (chip.r + 6),
          chip.cy + (dy / l) * (chip.r + 6),
        ];
        const g = edgeGeometry(p0, cloudAnchor(n, p0, e.toNudge), {
          bend: e.bend, ctrl: e.ctrl,
        });
        nodeEdges.push({ e, n, s, p0, d: g.d, at: g.at });
      } else {
        const p0 = anchorPoint(s, e.anchor);
        const g = edgeGeometry(p0, cloudAnchor(n, p0, e.toNudge), {
          bend: e.bend, ctrl: e.ctrl,
        });
        serverEdges.push({ e, n, p0, d: g.d, at: g.at });
        (ports[s.id] ??= []).push({
          key: e.id, iface: e.iface, p0,
          color: e.state === 'down' ? DOWN : n.color,
        });
      }
    });
    const p2pGeo = p2p.map((L) => {
      const sa = serversById[L.a.server];
      const sb = serversById[L.b.server];
      if (!sa || !sb) return null;
      const p0 = anchorPoint(sa, L.a.anchor);
      const p1 = anchorPoint(sb, L.b.anchor);
      const g = edgeGeometry(p0, p1, { bend: L.bend });
      (ports[sa.id] ??= []).push({
        key: `${L.id}-a`, iface: L.a.iface, p0, color: L.color,
      });
      (ports[sb.id] ??= []).push({
        key: `${L.id}-b`, iface: L.b.iface, p0: p1, color: L.color,
      });
      return { L, d: g.d, at: g.at, p0, p1, mid: g.at(0.5) };
    }).filter(Boolean);
    return { serverEdges, nodeEdges, p2pGeo, ports };
  }, [edges, p2p, serversById, netsById, chipsById]);

  // ip labels sit right at the interface they belong to: as a tag next to
  // the port (offset away from the box side), or — for node-level links —
  // at the point where the link exits the server box
  const labels = useMemo(() => {
    const tagOffset = (side, w) => {
      switch (side) {
        case 'bottom': return [0, 19];
        case 'left': return [-(w / 2 + 12), 0];
        case 'right': return [w / 2 + 12, 0];
        default: return [0, -19]; // top
      }
    };
    // walk along a node-level path until it leaves the server box
    const boxExit = (s, at) => {
      for (let t = 0; t <= 1; t += 0.02) {
        const p = at(t);
        if (p[0] < s.x || p[0] > s.x + s.w || p[1] < s.y || p[1] > s.y + s.h) {
          const side = p[1] <= s.y ? 'top'
            : p[1] >= s.y + s.h ? 'bottom'
              : p[0] <= s.x ? 'left' : 'right';
          return { p, side };
        }
      }
      return { p: at(1), side: 'top' };
    };
    const out = [];
    const push = (key, edgeId, text, color, base, side, off, click, anchor) => {
      const w = text.length * 7.4 + 14;
      const tag = tagOffset(side, w);
      out.push({
        key, edgeId, text, color, w, side,
        x: base[0] + tag[0] + (off?.[0] || 0),
        y: base[1] + tag[1] + (off?.[1] || 0),
        click, anchor,
      });
    };
    geo.serverEdges.forEach(({ e, n, p0 }) => {
      if (!e.label) return;
      push(e.id, e.id, e.label, e.state === 'down' ? DOWN : n.color,
        p0, e.anchor.side, e.labelOff,
        { kind: 'iface', serverId: e.server, ifaceId: e.iface }, p0);
    });
    geo.nodeEdges.forEach(({ e, n, s, p0, at }) => {
      if (!e.label) return;
      const exit = boxExit(s, at);
      push(e.id, e.id, e.label, n.color, exit.p, exit.side, e.labelOff,
        { kind: 'iface', serverId: e.server, ifaceId: e.iface }, p0);
    });
    geo.p2pGeo.forEach(({ L, p0, p1, mid }) => {
      (L.labels ?? []).forEach((lb, i) => {
        const atB = lb.end === 'b';
        push(`${L.id}-l${i}`, L.id, lb.text, L.color,
          atB ? p1 : p0, (atB ? L.b : L.a).anchor?.side ?? 'top', lb.off,
          { kind: 'p2p', linkId: L.id }, mid);
      });
    });
    // R7: resolve label collisions with minimal deterministic nudges —
    // separate along whichever axis needs the smaller move, but never push
    // a label back across its own interface into the box
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          const a = out[i];
          const b = out[j];
          const needX = (a.w + b.w) / 2 + 8 - Math.abs(a.x - b.x);
          const needY = 19 + 7 - Math.abs(a.y - b.y);
          if (needX <= 0 || needY <= 0) continue;
          if (needX <= needY) {
            const dir = a.x <= b.x ? 1 : -1;
            a.x -= (dir * needX) / 2;
            b.x += (dir * needX) / 2;
          } else {
            const [up, down] = a.y <= b.y ? [a, b] : [b, a];
            if (up.side === 'bottom') down.y += needY; // up would enter its box
            else if (down.side === 'top') up.y -= needY;
            else {
              up.y -= needY / 2;
              down.y += needY / 2;
            }
          }
        }
      }
    }
    return out;
  }, [geo]);

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

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    drag.current = { sx: e.clientX, sy: e.clientY };
    moved.current = false;
  };
  const onPointerMove = (e) => {
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
  const onPointerUp = () => {
    drag.current = null;
  };

  // ---- interaction helpers -------------------------------------------------
  // panels are anchored to the clicked element in world coordinates, so the
  // card visibly belongs to its element and follows pan/zoom
  const openPanel = (e, spec, anchor, color) => {
    e.stopPropagation();
    if (moved.current) return;
    onPanel({ ...spec, anchor, color });
  };

  const clickServer = (e, serverId) => {
    e.stopPropagation();
    if (moved.current) return;
    onSelectServer(serverId);
  };

  const clickNode = (e, serverId, chipId) => {
    e.stopPropagation();
    if (moved.current) return;
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
    p2p.forEach((L) => {
      if (L.net === filter) {
        ids.add(L.id);
        sv.add(L.a.server);
        sv.add(L.b.server);
      }
    });
    return { servers: sv, nets: new Set([filter]), edges: ids };
  }, [filter, servers, edges, p2p]);

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

  const renderEdge = (key, d, color, { traffic, down, hoverId, click, anchor, width = 1.4 }) => {
    const dur = down ? 0 : dashDuration(traffic);
    const lit = hover === hoverId || activeEdgeId === hoverId;
    return (
      <g key={key} opacity={dimOf('edge', hoverId)} className="edge">
        <path
          d={d}
          className={`edge-line${down ? ' is-down' : ''}`}
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

  let anchorPt = null;
  let panelStyle = null;
  let connector = null;
  if (panel?.anchor && view && wrapRef.current) {
    const bw = wrapRef.current.clientWidth;
    const bh = wrapRef.current.clientHeight;
    anchorPt = [
      panel.anchor[0] * view.k + view.x,
      panel.anchor[1] * view.k + view.y,
    ];
    let left = anchorPt[0] + 24;
    if (left + PANEL_W > bw - 10) left = anchorPt[0] - 24 - PANEL_W;
    left = clamp(left, 10, bw - PANEL_W - 10);
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
      onClick={() => {
        if (!moved.current) onPanel(null);
      }}
    >
      {view && (
        <svg className="graph-svg">
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>

            {/* server-level edges + p2p links (under clouds and boxes) */}
            <g>
              {geo.serverEdges.map(({ e, n, p0, d }) => renderEdge(e.id, d,
                e.state === 'down' ? DOWN : n.color, {
                  traffic: e.traffic,
                  down: e.state === 'down',
                  hoverId: e.id,
                  click: { kind: 'iface', serverId: e.server, ifaceId: e.iface },
                  anchor: p0,
                }))}
              {geo.p2pGeo.map(({ L, d, mid }) => renderEdge(L.id, d, L.color, {
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

            {/* server boxes with name, mgmt address, chips and ports */}
            <g>
              {servers.map((s) => {
                const chips = chipsById[s.id];
                const down = s.status === 'down';
                const sel = selectedId === s.id;
                const nameW = s.name.length * 9.2;
                return (
                  <g
                    key={s.id}
                    className={`server${down ? ' is-down' : ''}`}
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
                    <circle
                      cx={s.x + 17} cy={s.y + 21} r="4"
                      fill={statusColor(s.status)} className="server-dot"
                    />
                    <text className="server-name" x={s.x + 29} y={s.y + 26}>
                      {s.name}
                    </text>
                    {s.mgmt && (
                      <text className="server-mgmt" x={s.x + 29} y={s.y + 44}>
                        {s.mgmt}
                      </text>
                    )}
                    {s.tag && (
                      <text className="server-tag" x={s.x + 35 + nameW} y={s.y + 25}>
                        {s.tag}
                      </text>
                    )}
                    {s.status === 'warning' && (
                      <g>
                        <rect
                          x={s.x + 33 + nameW} y={s.y + 13} width="15" height="15"
                          rx="3" fill="rgba(230,180,80,.13)"
                          stroke="rgba(230,180,80,.55)" strokeWidth="1"
                        />
                        <text
                          x={s.x + 40.5 + nameW} y={s.y + 25}
                          className="warn-glyph"
                        >
                          !
                        </text>
                      </g>
                    )}
                    {down && (
                      <g>
                        <rect
                          x={s.x + 35 + nameW} y={s.y + 13} width="46" height="15"
                          rx="3" fill="rgba(224,86,74,.12)"
                          stroke="rgba(224,86,74,.5)" strokeWidth="1"
                        />
                        <text x={s.x + 58 + nameW} y={s.y + 24.5} className="down-glyph">
                          DOWN
                        </text>
                      </g>
                    )}

                    {s.chips.map((c) => {
                      const p = chips[c.id];
                      return (
                        <g key={c.id} onClick={(e) => clickNode(e, s.id, c.id)}>
                          {c.ring && (
                            <circle
                              cx={p.cx} cy={p.cy} r={p.r + 4} fill="none"
                              stroke={c.ring} strokeOpacity="0.5" strokeWidth="1.2"
                            />
                          )}
                          <circle cx={p.cx} cy={p.cy} r={p.r} className="node-chip" />
                          <text x={p.cx} y={p.cy + 3.8} className="chip-label">
                            {c.label}
                          </text>
                        </g>
                      );
                    })}

                    {(geo.ports[s.id] || []).map((pt) => (
                      <g key={pt.key}>
                        <rect
                          className="port"
                          x={pt.p0[0] - 4} y={pt.p0[1] - 4}
                          width="8" height="8" rx="1" fill={pt.color}
                          onClick={(ev) => openPanel(ev, {
                            kind: 'iface', serverId: s.id, ifaceId: pt.iface,
                          }, pt.p0, pt.color)}
                        />
                        <rect
                          className="anchor-hit"
                          x={pt.p0[0] - 11} y={pt.p0[1] - 11} width="22" height="22"
                          onClick={(ev) => openPanel(ev, {
                            kind: 'iface', serverId: s.id, ifaceId: pt.iface,
                          }, pt.p0, pt.color)}
                        />
                      </g>
                    ))}
                  </g>
                );
              })}
            </g>

            {/* node-level edges — drawn above boxes so the link visibly
                starts at the service chip (sidecar / cni) */}
            <g>
              {geo.nodeEdges.map(({ e, n, p0, d }) => renderEdge(e.id, d, n.color, {
                traffic: e.traffic,
                down: false,
                hoverId: e.id,
                click: { kind: 'iface', serverId: e.server, ifaceId: e.iface },
                anchor: p0,
              }))}
            </g>

            {/* ip labels — drawn last so they are never hidden */}
            <g>
              {labels.map((lb) => {
                const { w } = lb;
                return (
                  <g
                    key={lb.key}
                    className="edge-label"
                    opacity={dimOf('edge', lb.edgeId)}
                    onClick={(ev) => openPanel(ev, lb.click, lb.anchor, lb.color)}
                    onMouseEnter={() => setHover(lb.edgeId)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <rect x={lb.x - w / 2} y={lb.y - 9.5} width={w} height="19" rx="3" />
                    <text x={lb.x} y={lb.y + 4.2} fill={lb.color}>
                      {lb.text}
                    </text>
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
        <span><i className="lg-port" /> port = server-interface</span>
        <span><i className="lg-ring" /> ring = service-interface</span>
        <span>cloud = network (star) · direct line = p2p vpn ·
          dash speed = traffic · click: server/service → modal ·
          interface/link → panel</span>
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
    </div>
  );
}
