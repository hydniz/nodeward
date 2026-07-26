// ---------------------------------------------------------------------------
// nodeward auto-layout engine
//
// Builds the whole topology graph from pure facts (who is a member of which
// network) — no hand-placed coordinates. It runs in the backend and emits
// finished geometry (every endpoint, every bend, every label box), so every
// user sees exactly the same graph and the client only has to draw it.
// The rules are documented in LAYOUT.md; rule numbers below (R0–R9) refer
// to that document.
//
// R0  deterministic: same input → same layout, all tie-breaks by id
// R1  horizontal bands: providers → public servers → shared networks
//     → private servers → local networks
// R2  star centering: every element gravitates to the barycenter of its
//     neighbors; networks end up in the middle of their members
// R3  spacing: fixed gutters and band gaps, no overlaps, margins define
//     the world size
// R4  sizes derive from content (labels, chip grid, member count)
// R5  interfaces sit on the box side facing their network; chips with
//     links are ordered towards their exit side
// R6  edges are straight unless they would cross a foreign box/cloud —
//     then the smallest clearing bow is chosen
// R7  ip labels sit at their interface, are never covered and never cover
//     a server box
// R8  the header of a box (name + address) is a protected zone: the service
//     chips move to the side their links leave through, so no line and no
//     label ever crosses the host name
// R9  trunking: many links from one host into one network leave the box as
//     short stubs, join a collector and travel on as a single trunk
// ---------------------------------------------------------------------------

import {
  anchorPoint, cloudAngle, cloudEntry, edgeGeometry,
} from './graphGeometry.js';

// ---- R3: spacing constants -------------------------------------------------
const MARGIN = 56; // world margin around everything
const GUTTER_X = 96; // min horizontal gap between siblings in a band
const BAND_GAP = [92, 116, 116, 92]; // vertical gap below band 0,1,2,3

// ---- R4/R8: box metrics (must match the renderer's font metrics) -----------
const HEADER_H = 52; // protected zone: status dot + name row + address row
const BOX_SLACK = 14;
const BOX_MIN_W = 150;
const CHIP_R = 17;
const CHIP_PAD = 21; // box border → chip
const CHIP_PITCH = 62; // chip center → chip center
const CHIP_ROW_H = 48;
const CHIP_COLS = 4; // chips per row before a second row opens

// ---- R9: trunking ----------------------------------------------------------
const TRUNK_MIN = 3; // links from one host into one network before bundling
const TRUNK_OFF = 34; // distance of the collector from the box border

// ---- R5: cloud docking -----------------------------------------------------
const ENTRY_GAP = 0.34; // min angular distance between two cloud entries

// ---- R7: label metrics -----------------------------------------------------
const LROW_H = 19;
const L_IP_CHAR = 7.4; // ip glyph width @ 12.5px mono
const L_TAG_CHAR = 6.6; // tag glyph width @ 11px mono
const L_OFF = 10; // gap between an interface and its label box

const seedOf = (id) => [...id].reduce((a, c) => a + c.charCodeAt(0), 7) % 97;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

// ---- R4: sizes derive from content ----------------------------------------
// chips are laid out as a grid: one row while they fit, a second row after
// that — a host with ten services stays a readable box instead of a ribbon
function chipGrid(count) {
  if (!count) return { rows: 0, cols: 0 };
  const rows = Math.ceil(count / CHIP_COLS);
  return { rows, cols: Math.ceil(count / rows) };
}

function serverSize(s, grid) {
  const nameW = 29 + s.name.length * 9.2
    + (s.tag ? 6 + s.tag.length * 6.6 : 0)
    + (s.status !== 'up' ? 60 : 0) + 16;
  const mgmtW = 29 + (s.mgmt?.length ?? 0) * 6.9 + 14;
  const chipsW = grid.cols
    ? CHIP_PAD * 2 + CHIP_R * 2 + (grid.cols - 1) * CHIP_PITCH
    : 0;
  return {
    w: Math.ceil(Math.max(BOX_MIN_W, nameW, mgmtW, chipsW)),
    h: HEADER_H + (grid.rows ? grid.rows * CHIP_ROW_H + BOX_SLACK : 22),
  };
}

function cloudSize(n, members) {
  const nameW = n.name.length * 10.2;
  const subW = (n.sub?.length ?? 0) * 6.9;
  return {
    w: Math.ceil(Math.max(nameW, subW) + 60),
    h: Math.round(Math.min(102, 60 + members * 7)),
  };
}

// ---- R1: band classification ----------------------------------------------
// 0 providers · 1 public servers · 2 shared networks · 3 private servers
// 4 local networks
function bandOfNet(n) {
  if (n.role === 'provider') return 0;
  if (n.role === 'lan') return 4;
  return 2;
}

// R5: which side of a box faces a target — bands stack vertically, so
// top/bottom is strongly preferred over left/right
function sideOf(s, to) {
  const dx = to[0] - (s.x + s.w / 2);
  const dy = to[1] - (s.y + s.h / 2);
  if (Math.abs(dy) * 1.5 >= Math.abs(dx)) return dy < 0 ? 'top' : 'bottom';
  return dx < 0 ? 'left' : 'right';
}

// spread values apart by a minimum gap while keeping their order and their
// common center — used for cloud entry angles (R5) and nothing else
function spreadAngles(items, gap) {
  if (items.length < 2) return;
  items.sort((a, b) => a.want - b.want || a.id.localeCompare(b.id));
  let cursor = -Infinity;
  items.forEach((it) => {
    it.pos = Math.max(it.want, cursor);
    cursor = it.pos + gap;
  });
  const drift = items.reduce((a, it) => a + (it.pos - it.want), 0) / items.length;
  items.forEach((it) => { it.pos -= drift; });
}

export default function autoLayout({ networks, servers, edges, p2p = [] }) {
  const virtual = networks.filter((n) => n.virtual);
  const nets = networks.filter((n) => !n.virtual);

  const providerIds = new Set(nets.filter((n) => n.role === 'provider').map((n) => n.id));
  const memberCount = {};
  edges.forEach((e) => {
    memberCount[e.net] = (memberCount[e.net] ?? 0) + 1;
  });

  // ---- R1: bands ----------------------------------------------------------
  const netBand = {};
  nets.forEach((n) => { netBand[n.id] = bandOfNet(n); });
  const serverBand = {};
  servers.forEach((s) => {
    serverBand[s.id] = edges.some((e) => e.server === s.id && providerIds.has(e.net)) ? 1 : 3;
  });

  // ---- R8: the service zone sits on the side its links leave through -----
  // a chip whose link points across the header would drag its line (and its
  // ip label) straight over the host name — so the chips move instead
  const zones = {};
  servers.forEach((s) => {
    let up = 0;
    let down = 0;
    edges.forEach((e) => {
      if (e.server !== s.id || !e.ring || netBand[e.net] == null) return;
      if (netBand[e.net] < serverBand[s.id]) up += 1;
      else down += 1;
    });
    zones[s.id] = { side: up > down ? 'top' : 'bottom', ...chipGrid(s.chips.length) };
  });

  // ---- nodes of the layout graph ------------------------------------------
  const nodes = new Map(); // id → {id, kind, band, w, h, x(left), cy}
  nets.forEach((n) => {
    const { w, h } = cloudSize(n, memberCount[n.id] ?? 1);
    nodes.set(n.id, { id: n.id, kind: 'net', ref: n, band: netBand[n.id], w, h });
  });
  servers.forEach((s) => {
    const { w, h } = serverSize(s, zones[s.id]);
    nodes.set(s.id, { id: s.id, kind: 'server', ref: s, band: serverBand[s.id], w, h });
  });

  // R2: neighbor lists (memberships + p2p partners)
  const neighbors = new Map([...nodes.keys()].map((id) => [id, []]));
  edges.forEach((e) => {
    if (nodes.has(e.server) && nodes.has(e.net)) {
      neighbors.get(e.server).push(e.net);
      neighbors.get(e.net).push(e.server);
    }
  });
  p2p.forEach((L) => {
    if (nodes.has(L.a.server) && nodes.has(L.b.server)) {
      neighbors.get(L.a.server).push(L.b.server);
      neighbors.get(L.b.server).push(L.a.server);
    }
  });

  const bands = [[], [], [], [], []];
  [...nodes.values()]
    .sort((a, b) => a.id.localeCompare(b.id)) // R0: stable initial order
    .forEach((n) => bands[n.band].push(n));

  // ---- R2/R3: iterative barycenter placement ------------------------------
  // initial spread, then rounds of "move to the mean of your neighbors,
  // then push apart to keep the gutter" until the layout settles
  bands.forEach((band) => {
    let cursor = 0;
    band.forEach((n) => {
      n.x = cursor;
      cursor += n.w + GUTTER_X;
    });
  });

  const center = (n) => n.x + n.w / 2;
  const placeBand = (band) => {
    band.forEach((n) => {
      const ns = neighbors.get(n.id);
      if (ns.length) {
        n.desired = ns.reduce((a, id) => a + center(nodes.get(id)), 0) / ns.length;
      } else {
        n.desired = center(n);
      }
    });
    band.sort((a, b) => a.desired - b.desired || a.id.localeCompare(b.id));
    // forward pass: honour desired positions left to right
    let cursor = -1e9;
    band.forEach((n) => {
      n.x = Math.max(n.desired - n.w / 2, cursor);
      cursor = n.x + n.w + GUTTER_X;
    });
    // backward pass: pull back towards desired where space allows
    for (let i = band.length - 1; i >= 0; i--) {
      const limit = i < band.length - 1 ? band[i + 1].x - GUTTER_X - band[i].w : 1e9;
      band[i].x = Math.min(Math.max(band[i].desired - band[i].w / 2, band[i].x), limit);
    }
  };

  for (let round = 0; round < 10; round++) {
    for (let b = 0; b < 5; b++) placeBand(bands[b]);
    for (let b = 4; b >= 0; b--) placeBand(bands[b]);
  }

  // normalize to the margin, compute world size
  const all = [...nodes.values()];
  const minX = Math.min(...all.map((n) => n.x));
  all.forEach((n) => { n.x += MARGIN - minX; });
  const worldW = Math.max(...all.map((n) => n.x + n.w)) + MARGIN;

  // ---- R1/R3: vertical band positions -------------------------------------
  const bandH = bands.map((band) => Math.max(0, ...band.map((n) => n.h)));
  let y = MARGIN;
  const bandY = [];
  for (let b = 0; b < 5; b++) {
    bandY[b] = y;
    if (bandH[b] > 0) y += bandH[b] + (BAND_GAP[b] ?? 0);
  }
  const worldH = y + MARGIN; // y ends at the bottom of the last band
  all.forEach((n) => {
    n.cy = bandY[n.band] + bandH[n.band] / 2;
  });

  // ---- write geometry back into decorated copies --------------------------
  const outNets = nets.map((n) => {
    const node = nodes.get(n.id);
    return {
      ...n,
      x: node.x + node.w / 2, y: node.cy, w: node.w, h: node.h,
      seed: seedOf(n.id),
    };
  });
  const outServers = servers.map((s) => {
    const node = nodes.get(s.id);
    return { ...s, x: node.x, y: node.cy - node.h / 2, w: node.w, h: node.h };
  });
  const serversById = Object.fromEntries(outServers.map((s) => [s.id, s]));
  const netsById = Object.fromEntries(outNets.map((n) => [n.id, n]));
  const outEdges = edges.map((e) => ({ ...e }));
  const outP2p = p2p.map((L) => ({ ...L, a: { ...L.a }, b: { ...L.b } }));

  // ---- R5/R8: chip grid — linked services sit in the outer row, ordered
  // towards their exit side; the header keeps the opposite side to itself ---
  outServers.forEach((s) => {
    const zone = zones[s.id];
    const targetX = {};
    outEdges.forEach((e) => {
      if (e.server === s.id && e.ring && netsById[e.net]) {
        targetX[e.node] = netsById[e.net].x;
      }
    });
    const linked = s.chips
      .filter((c) => targetX[c.id] != null)
      .sort((a, b) => targetX[a.id] - targetX[b.id] || a.id.localeCompare(b.id));
    const plain = s.chips.filter((c) => targetX[c.id] == null);
    const rowSeq = [...Array(zone.rows).keys()];
    if (zone.side === 'bottom') rowSeq.reverse(); // outer row first
    const zoneY0 = zone.side === 'top' ? s.y + BOX_SLACK : s.y + HEADER_H;

    s.chips = [...linked, ...plain].map((c, i) => ({
      ...c,
      cx: s.x + CHIP_PAD + CHIP_R + (i % zone.cols) * CHIP_PITCH,
      cy: zoneY0 + rowSeq[Math.floor(i / zone.cols)] * CHIP_ROW_H + CHIP_ROW_H / 2,
      r: CHIP_R,
    }));
    s.zone = { side: zone.side, rows: zone.rows, cols: zone.cols };
    s.headerY = zone.side === 'top' ? zoneY0 + zone.rows * CHIP_ROW_H : s.y;
  });
  const chipOf = (sid, cid) => serversById[sid]?.chips.find((c) => c.id === cid);

  // ---- R9: trunking — bundle the links of one host into one network -------
  // three tailscale identities on a NAS are three lines through the same
  // gap; as a bundle they are three short stubs and one trunk
  const groups = new Map();
  outEdges.forEach((e) => {
    if (!serversById[e.server] || !netsById[e.net]) return;
    const key = `${e.server}|${e.net}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });
  const bundles = [];
  [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0])) // R0
    .forEach(([key, list]) => {
      if (list.length < TRUNK_MIN) return;
      const [sid, nid] = key.split('|');
      const s = serversById[sid];
      const n = netsById[nid];
      // the collector sits on the side facing the cloud — but if services
      // feed the trunk, it stays on their zone's side whenever that points
      // the right way, so no stub has to cut across the chip row (R8)
      const towards = n.y < s.y + s.h / 2 ? 'top' : 'bottom';
      const fromChips = list.some((e) => e.ring);
      const side = fromChips && s.zone.side === towards
        ? s.zone.side
        : sideOf(s, [n.x, n.y]);
      const alongX = side === 'top' || side === 'bottom';
      const from = alongX
        ? [clamp(n.x, s.x + 26, s.x + s.w - 26),
          side === 'top' ? s.y - TRUNK_OFF : s.y + s.h + TRUNK_OFF]
        : [side === 'left' ? s.x - TRUNK_OFF : s.x + s.w + TRUNK_OFF,
          clamp(n.y, s.y + 20, s.y + s.h - 20)];
      const id = `trunk-${sid}-${nid}`;
      list.forEach((e) => { e.bundle = id; });
      bundles.push({
        id,
        server: sid,
        net: nid,
        color: n.color,
        side,
        from,
        members: list.map((e) => e.id),
        traffic: Math.round(list.reduce((a, e) => a + (e.traffic ?? 0), 0) * 10) / 10,
        down: list.every((e) => e.state === 'down'),
      });
    });
  const bundleById = Object.fromEntries(bundles.map((b) => [b.id, b]));
  // where a link aims when it leaves the box: its collector, or the cloud
  const aimOf = (e) => (e.bundle
    ? bundleById[e.bundle].from
    : [netsById[e.net].x, netsById[e.net].y]);

  // ---- R5: ports on the side facing the target ----------------------------
  const requests = {}; // serverId → [{target, assign(side, at)}]
  outEdges.forEach((e) => {
    if (e.ring || !netsById[e.net] || !serversById[e.server]) return;
    (requests[e.server] ??= []).push({
      target: aimOf(e),
      assign: (side, at) => { e.anchor = { side, at }; },
    });
  });
  outP2p.forEach((L) => {
    const sa = serversById[L.a.server];
    const sb = serversById[L.b.server];
    if (!sa || !sb) return;
    (requests[L.a.server] ??= []).push({
      target: [sb.x + sb.w / 2, sb.y + sb.h / 2],
      assign: (side, at) => { L.a.anchor = { side, at }; },
    });
    (requests[L.b.server] ??= []).push({
      target: [sa.x + sa.w / 2, sa.y + sa.h / 2],
      assign: (side, at) => { L.b.anchor = { side, at }; },
    });
  });

  Object.entries(requests).forEach(([sid, reqs]) => {
    const s = serversById[sid];
    const yes = { top: [], bottom: [], left: [], right: [] };
    reqs.forEach((r) => yes[sideOf(s, r.target)].push(r));
    Object.entries(yes).forEach(([side, list]) => {
      // spread ports evenly, ordered towards their targets → no crossings
      list.sort((a, b) => (side === 'top' || side === 'bottom'
        ? a.target[0] - b.target[0]
        : a.target[1] - b.target[1]));
      list.forEach((r, i) => r.assign(side, (i + 1) / (list.length + 1)));
    });
  });

  // ---- R8: where a service link leaves the box ----------------------------
  // straight out of the chip ring towards its exit side; if that side is the
  // header's, it leaves through the nearer vertical border instead
  function ringSource(s, chip, side) {
    const crossesHeader = (side === 'top' && s.zone.side === 'bottom')
      || (side === 'bottom' && s.zone.side === 'top');
    if (crossesHeader) {
      const left = chip.cx - s.x <= s.x + s.w - chip.cx;
      return { p: [left ? s.x - 5 : s.x + s.w + 5, chip.cy], side: left ? 'left' : 'right' };
    }
    const d = CHIP_R + 6;
    switch (side) {
      case 'top': return { p: [chip.cx, chip.cy - d], side };
      case 'bottom': return { p: [chip.cx, chip.cy + d], side };
      case 'left': return { p: [chip.cx - d, chip.cy], side };
      default: return { p: [chip.cx + d, chip.cy], side };
    }
  }

  outEdges.forEach((e) => {
    const s = serversById[e.server];
    const n = netsById[e.net];
    if (!s || !n) return;
    if (e.ring) {
      const chip = chipOf(s.id, e.node);
      if (!chip) return;
      const src = ringSource(s, chip, sideOf(s, aimOf(e)));
      e.from = src.p;
      e.exitSide = src.side;
    } else {
      e.from = anchorPoint(s, e.anchor);
      e.exitSide = e.anchor.side;
    }
  });
  outP2p.forEach((L) => {
    const sa = serversById[L.a.server];
    const sb = serversById[L.b.server];
    if (!sa || !sb || !L.a.anchor || !L.b.anchor) return;
    L.from = anchorPoint(sa, L.a.anchor);
    L.to = anchorPoint(sb, L.b.anchor);
  });

  // ---- R5: every connector gets its own entry on the cloud ---------------
  // without this, five links from below all dock in the same spot and become
  // one indistinguishable brush stroke
  outNets.forEach((n) => {
    const items = [];
    outEdges.forEach((e) => {
      if (e.net !== n.id || e.bundle || !e.from) return;
      items.push({ id: e.id, want: cloudAngle(n, e.from), apply: (p) => { e.to = p; } });
    });
    bundles.forEach((b) => {
      if (b.net !== n.id) return;
      items.push({ id: b.id, want: cloudAngle(n, b.from), apply: (p) => { b.to = p; } });
    });
    spreadAngles(items, ENTRY_GAP);
    items.forEach((it) => it.apply(cloudEntry(n, it.pos ?? it.want)));
  });
  // a bundled link ends at its collector
  outEdges.forEach((e) => {
    if (e.bundle) e.to = bundleById[e.bundle].from;
  });

  // ---- R6: straight edges, bow only around obstacles ----------------------
  const obstacles = [
    ...outServers.map((s) => ({ id: s.id, x: s.x - 10, y: s.y - 10, w: s.w + 20, h: s.h + 20 })),
    ...outNets.map((n) => ({
      id: n.id, x: n.x - n.w / 2 - 8, y: n.y - n.h / 2 - 8, w: n.w + 16, h: n.h + 16,
    })),
  ];
  const clear = (at, skip) => {
    for (let t = 0.08; t <= 0.92; t += 0.04) {
      const p = at(t);
      for (const ob of obstacles) {
        if (skip.has(ob.id)) continue;
        if (p[0] > ob.x && p[0] < ob.x + ob.w && p[1] > ob.y && p[1] < ob.y + ob.h) {
          return false;
        }
      }
    }
    return true;
  };
  const chooseBend = (p0, p1, skip) => {
    for (const bend of [0, 26, -26, 46, -46, 70, -70, 100, -100]) {
      if (clear(edgeGeometry(p0, p1, { bend }).at, skip)) return bend;
    }
    return 0;
  };

  outEdges.forEach((e) => {
    const s = serversById[e.server];
    const n = netsById[e.net];
    if (!s || !n || !e.from || !e.to) return;
    if (e.bundle) {
      // stub: leave the border first, then curve into the collector — so a
      // stub never runs across a neighboring chip
      const b = bundleById[e.bundle];
      e.ctrl = b.side === 'top' || b.side === 'bottom'
        ? [e.from[0], e.to[1]]
        : [e.to[0], e.from[1]];
      e.kind = 'stub';
      return;
    }
    e.kind = 'link';
    if (e.exitSide === 'left' || e.exitSide === 'right') {
      const away = e.exitSide === 'left' ? -40 : 40;
      e.ctrl = [e.from[0] + away, (e.from[1] + e.to[1]) / 2];
      return;
    }
    e.bend = chooseBend(e.from, e.to, new Set([s.id, n.id]));
  });
  bundles.forEach((b) => {
    b.bend = chooseBend(b.from, b.to, new Set([b.server, b.net]));
  });
  outP2p.forEach((L) => {
    if (!L.from || !L.to) return;
    L.bend = chooseBend(L.from, L.to, new Set([L.a.server, L.b.server]));
  });

  // ---- ports (the little squares on the border) ---------------------------
  const ports = [];
  outEdges.forEach((e) => {
    if (e.ring || !e.from) return;
    ports.push({
      key: e.id, server: e.server, iface: e.iface, at: e.from,
      color: netsById[e.net]?.color, down: e.state === 'down', edgeId: e.id,
    });
  });
  outP2p.forEach((L) => {
    if (!L.from || !L.to) return;
    ports.push({
      key: `${L.id}-a`, server: L.a.server, iface: L.a.iface, at: L.from,
      color: L.color, down: false, edgeId: L.id,
    });
    ports.push({
      key: `${L.id}-b`, server: L.b.server, iface: L.b.iface, at: L.to,
      color: L.color, down: false, edgeId: L.id,
    });
  });

  // ---- R7: label boxes ---------------------------------------------------
  // one box per interface (or one stacked box per bundle), placed at the
  // interface, pushed out of every server box, then de-collided
  const labels = [];
  const rowWidth = (r) => (r.tag ? r.tag.length * L_TAG_CHAR + 8 : 0) + r.text.length * L_IP_CHAR;
  const labelSize = (rows) => ({
    tagW: Math.ceil(Math.max(0, ...rows.map((r) => (r.tag ? r.tag.length * L_TAG_CHAR : 0)))),
    w: Math.ceil(Math.max(...rows.map(rowWidth)) + (rows.length > 1 ? 22 : 14)),
    h: rows.length * LROW_H + (rows.length > 1 ? 8 : 0),
  });
  const addLabel = (id, rows, center, side, anchor) => {
    if (!rows.length) return;
    labels.push({
      id,
      rows,
      ...labelSize(rows),
      side,
      anchor,
      x: center[0],
      y: center[1],
      edgeIds: [...new Set(rows.map((r) => r.edgeId))],
    });
  };
  // the label box sits next to its interface, on the outside of the border
  const outward = (at, side, size) => {
    switch (side) {
      case 'bottom': return [at[0], at[1] + size.h / 2 + L_OFF];
      case 'left': return [at[0] - size.w / 2 - L_OFF, at[1]];
      case 'right': return [at[0] + size.w / 2 + L_OFF, at[1]];
      default: return [at[0], at[1] - size.h / 2 - L_OFF];
    }
  };

  // walk a path until it leaves the box — that is where a service link
  // becomes visible and where its ip belongs
  const boxExit = (s, at) => {
    for (let t = 0; t <= 1; t += 0.02) {
      const p = at(t);
      if (p[0] < s.x || p[0] > s.x + s.w || p[1] < s.y || p[1] > s.y + s.h) {
        return {
          p,
          side: p[1] <= s.y ? 'top'
            : p[1] >= s.y + s.h ? 'bottom'
              : p[0] <= s.x ? 'left' : 'right',
        };
      }
    }
    return { p: at(1), side: 'top' };
  };

  const ifaceClick = (e) => ({ kind: 'iface', serverId: e.server, ifaceId: e.iface });
  const shortOwner = (e) => {
    if (!e.node) return e.iface;
    const s = serversById[e.server];
    return s?.chips.find((c) => c.id === e.node)?.label ?? e.node;
  };

  outEdges.forEach((e) => {
    if (!e.label || e.bundle || !e.from || !e.to) return;
    const s = serversById[e.server];
    const n = netsById[e.net];
    const row = {
      text: e.label, tag: null, color: n.color, down: e.state === 'down',
      edgeId: e.id, click: ifaceClick(e),
    };
    const size = labelSize([row]);
    if (e.ring) {
      const exit = boxExit(s, edgeGeometry(e.from, e.to, { bend: e.bend, ctrl: e.ctrl }).at);
      addLabel(e.id, [row], outward(exit.p, exit.side, size), exit.side, e.from);
    } else {
      addLabel(e.id, [row], outward(e.from, e.exitSide, size), e.exitSide, e.from);
    }
  });

  // one stacked box per bundle: every ip of the host in this network, tagged
  // with the service that owns it — set beside the trunk, not across it
  bundles.forEach((b) => {
    const s = serversById[b.server];
    const n = netsById[b.net];
    const rows = b.members
      .map((mid) => outEdges.find((e) => e.id === mid))
      .filter((e) => e?.label)
      .sort((a, c) => a.from[0] - c.from[0] || a.id.localeCompare(c.id))
      .map((e) => ({
        text: e.label, tag: shortOwner(e), color: n.color,
        down: e.state === 'down', edgeId: e.id, click: ifaceClick(e),
      }));
    if (!rows.length) return;
    const size = labelSize(rows);
    const along = b.side === 'top' || b.side === 'bottom';
    // set beside the trunk, on the side the cloud is *not* on, and growing
    // away from the box — so the stack covers neither the trunk nor the host
    const dir = along ? (b.from[0] <= n.x ? -1 : 1) : (b.from[1] <= n.y ? -1 : 1);
    const center = along
      ? [b.from[0] + dir * (size.w / 2 + 12),
        b.side === 'top'
          ? b.from[1] + 10 - size.h / 2
          : b.from[1] - 10 + size.h / 2]
      : [b.side === 'left'
        ? b.from[0] + 10 - size.w / 2
        : b.from[0] - 10 + size.w / 2,
      b.from[1] + dir * (size.h / 2 + 12)];
    const side = along
      ? (dir > 0 ? 'right' : 'left')
      : (dir > 0 ? 'bottom' : 'top');
    addLabel(b.id, rows, center, side, b.from);
  });

  outP2p.forEach((L) => {
    if (!L.from || !L.to) return;
    const mid = edgeGeometry(L.from, L.to, { bend: L.bend }).at(0.5);
    (L.labels ?? []).forEach((lb, i) => {
      const atB = lb.end === 'b';
      addLabel(
        `${L.id}-l${i}`,
        [{
          text: lb.text, tag: null, color: L.color, down: false,
          edgeId: L.id, click: { kind: 'p2p', linkId: L.id },
        }],
        atB ? L.to : L.from,
        (atB ? L.b : L.a).anchor?.side ?? 'top',
        mid,
      );
    });
  });

  // R7: a label may never cover a box — it is pushed out on the side its
  // own interface sits on, so it still reads as belonging to it
  const keepOut = [
    ...outServers.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })),
    // the name of a cloud is text as well and must stay readable
    ...outNets.map((n) => {
      const w = Math.min(n.w, 190);
      return { x: n.x - w / 2, y: n.y - 22, w, h: 44 };
    }),
  ];
  const clampOut = () => {
    labels.forEach((L) => {
      keepOut.forEach((ob) => {
        const hitX = Math.abs(L.x - (ob.x + ob.w / 2)) < L.w / 2 + ob.w / 2 + 3;
        const hitY = Math.abs(L.y - (ob.y + ob.h / 2)) < L.h / 2 + ob.h / 2 + 3;
        if (!hitX || !hitY) return;
        if (L.side === 'bottom') L.y = Math.max(L.y, ob.y + ob.h + L.h / 2 + 5);
        else if (L.side === 'left') L.x = Math.min(L.x, ob.x - L.w / 2 - 5);
        else if (L.side === 'right') L.x = Math.max(L.x, ob.x + ob.w + L.w / 2 + 5);
        else L.y = Math.min(L.y, ob.y - L.h / 2 - 5);
      });
    });
  };
  clampOut();
  for (let pass = 0; pass < 3; pass++) {
    // separate colliding labels along whichever axis needs the smaller move
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i];
        const b = labels[j];
        const needX = (a.w + b.w) / 2 + 8 - Math.abs(a.x - b.x);
        const needY = (a.h + b.h) / 2 + 7 - Math.abs(a.y - b.y);
        if (needX <= 0 || needY <= 0) continue;
        if (needX <= needY) {
          const dir = a.x <= b.x ? 1 : -1;
          a.x -= (dir * needX) / 2;
          b.x += (dir * needX) / 2;
        } else {
          const [up, low] = a.y <= b.y ? [a, b] : [b, a];
          if (up.side === 'bottom') low.y += needY;
          else if (low.side === 'top') up.y -= needY;
          else {
            up.y -= needY / 2;
            low.y += needY / 2;
          }
        }
      }
    }
    clampOut(); // boxes always win
  }

  return {
    world: { w: worldW, h: worldH },
    networks: [...outNets, ...virtual],
    servers: outServers,
    edges: outEdges,
    bundles,
    p2p: outP2p,
    ports,
    labels,
  };
}
