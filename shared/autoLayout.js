// ---------------------------------------------------------------------------
// nodeward auto-layout engine
//
// Builds the whole topology graph from pure facts (who is a member of which
// network) — no hand-placed coordinates. It runs in the backend: the api
// serves the computed geometry, so every user sees exactly the same graph.
// The rules are documented in LAYOUT.md; rule numbers below (R0–R7) refer
// to that document.
//
// R0  deterministic: same input → same layout, all tie-breaks by id
// R1  horizontal bands: providers → public servers → shared networks
//     → private servers → local networks
// R2  star centering: every element gravitates to the barycenter of its
//     neighbors; networks end up in the middle of their members
// R3  spacing: fixed gutters and band gaps, no overlaps, margins define
//     the world size
// R4  sizes derive from content (labels, chips, member count)
// R5  interfaces sit on the box side facing their network; chips with
//     links are ordered towards their exit side
// R6  edges are straight unless they would cross a foreign box/cloud —
//     then the smallest clearing bow is chosen
// R7  (in GraphCanvas) ip labels sit at the interface; collisions are
//     resolved by minimal deterministic nudges
// ---------------------------------------------------------------------------

import { anchorPoint, cloudAnchor, edgeGeometry, chipCenters } from './graphGeometry.js';

// ---- R3: spacing constants -------------------------------------------------
const MARGIN = 56; // world margin around everything
const GUTTER_X = 96; // min horizontal gap between siblings in a band
const BAND_GAP = [92, 116, 116, 92]; // vertical gap below band 0,1,2,3

// ---- R4: sizing constants (must match the renderer's font metrics) ---------
const SERVER_H = 114;
const CHIP_START = 38;
const CHIP_GAP = 62;
const CHIP_R = 17;

const seedOf = (id) => [...id].reduce((a, c) => a + c.charCodeAt(0), 7) % 97;

// ---- R4: sizes derive from content ----------------------------------------
function serverSize(s) {
  const nameW = 29 + s.name.length * 9.2
    + (s.tag ? 6 + s.tag.length * 6.6 : 0)
    + (s.status !== 'up' ? 60 : 0) + 16;
  const mgmtW = 29 + (s.mgmt?.length ?? 0) * 6.9 + 14;
  const chipsW = CHIP_START + (s.chips.length - 1) * CHIP_GAP + CHIP_R + 21 + 14;
  return { w: Math.ceil(Math.max(150, nameW, mgmtW, chipsW)), h: SERVER_H };
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

export default function autoLayout({ networks, servers, edges, p2p = [] }) {
  const virtual = networks.filter((n) => n.virtual);
  const nets = networks.filter((n) => !n.virtual);

  const providerIds = new Set(nets.filter((n) => n.role === 'provider').map((n) => n.id));
  const memberCount = {};
  edges.forEach((e) => {
    memberCount[e.net] = (memberCount[e.net] ?? 0) + 1;
  });

  // ---- nodes of the layout graph ------------------------------------------
  const nodes = new Map(); // id → {id, kind, band, w, h, x(left), cy, neighbors[]}
  nets.forEach((n) => {
    const { w, h } = cloudSize(n, memberCount[n.id] ?? 1);
    nodes.set(n.id, { id: n.id, kind: 'net', ref: n, band: bandOfNet(n), w, h });
  });
  servers.forEach((s) => {
    const { w, h } = serverSize(s);
    const band = edges.some((e) => e.server === s.id && providerIds.has(e.net)) ? 1 : 3;
    nodes.set(s.id, { id: s.id, kind: 'server', ref: s, band, w, h });
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

  // ---- R5: chip order — linked chips move towards their exit side ---------
  outServers.forEach((s) => {
    const targetX = {};
    edges.forEach((e) => {
      if (e.server === s.id && e.ring && netsById[e.net]) {
        targetX[e.node] = netsById[e.net].x;
      }
    });
    s.chips = [...s.chips].sort((a, b) => {
      const ax = targetX[a.id] ?? -1e9;
      const bx = targetX[b.id] ?? -1e9;
      return ax - bx || 0; // unlinked chips stay left, in original order
    });
  });

  // ---- R5: ports on the side facing the network ---------------------------
  const sideOf = (s, to) => {
    const dx = to[0] - (s.x + s.w / 2);
    const dy = to[1] - (s.y + s.h / 2);
    // bands stack vertically, so strongly prefer top/bottom attachment;
    // left/right only for clearly horizontal targets
    if (Math.abs(dy) * 1.5 >= Math.abs(dx)) return dy < 0 ? 'top' : 'bottom';
    return dx < 0 ? 'left' : 'right';
  };

  const requests = {}; // serverId → [{target, assign(side, at)}]
  const outEdges = edges.map((e) => ({ ...e }));
  const outP2p = p2p.map((L) => ({ ...L, a: { ...L.a }, b: { ...L.b } }));

  outEdges.forEach((e) => {
    if (e.ring || !netsById[e.net] || !serversById[e.server]) return;
    const n = netsById[e.net];
    (requests[e.server] ??= []).push({
      target: [n.x, n.y],
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

  const chipsCache = Object.fromEntries(outServers.map((s) => [s.id, chipCenters(s)]));
  outEdges.forEach((e) => {
    const s = serversById[e.server];
    const n = netsById[e.net];
    if (!s || !n) return;
    let p0;
    if (e.ring) {
      const chip = chipsCache[s.id][e.node];
      if (!chip) return;
      const dx = n.x - chip.cx;
      const dy = n.y - chip.cy;
      const l = Math.hypot(dx, dy) || 1;
      p0 = [chip.cx + (dx / l) * (chip.r + 6), chip.cy + (dy / l) * (chip.r + 6)];
    } else {
      p0 = anchorPoint(s, e.anchor);
    }
    e.bend = chooseBend(p0, cloudAnchor(n, p0), new Set([s.id, n.id]));
  });
  outP2p.forEach((L) => {
    const sa = serversById[L.a.server];
    const sb = serversById[L.b.server];
    if (!sa || !sb || !L.a.anchor || !L.b.anchor) return;
    L.bend = chooseBend(
      anchorPoint(sa, L.a.anchor),
      anchorPoint(sb, L.b.anchor),
      new Set([sa.id, sb.id]),
    );
  });

  return {
    world: { w: worldW, h: worldH },
    networks: [...outNets, ...virtual],
    servers: outServers,
    edges: outEdges,
    p2p: outP2p,
  };
}
