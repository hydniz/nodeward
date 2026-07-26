// ---------------------------------------------------------------------------
// geometry helpers for the topology graph — shared between the server-side
// auto-layout engine and the client renderer, so both always agree
// ---------------------------------------------------------------------------

// deterministic pseudo-random from a seed (for cloud lobe jitter)
function mulberry(seed) {
  let a = seed * 1000 + 13;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// small cloud outline: few points around an ellipse, big quadratic lobes
// bulging outward (stronger on top, flatter on the bottom) → reads as a cloud
export function cloudPath(net) {
  const rnd = mulberry(net.seed ?? 1);
  const rx = net.w / 2;
  const ry = net.h / 2;
  const n = Math.max(6, Math.round((rx + ry) / 24));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.3;
    const wob = 0.78 + rnd() * 0.08;
    pts.push([net.x + rx * wob * Math.cos(a), net.y + ry * wob * Math.sin(a)]);
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    // push the control point outward from the cloud center; lobes on the
    // upper half puff up more, the underside stays flatter
    const dx = mx - net.x;
    const dy = my - net.y;
    const len = Math.hypot(dx, dy) || 1;
    const top = my < net.y;
    const bump = Math.min(rx, ry) * (top ? 0.62 : 0.4) + rnd() * 6;
    const cx = net.x + (dx / len) * (len + bump);
    const cy = net.y + (dy / len) * (len + bump);
    d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
  }
  return d + ' Z';
}

// point on a server box border: side + fraction along that side
export function anchorPoint(server, anchor) {
  const { x, y, w, h } = server;
  const t = anchor.at ?? 0.5;
  switch (anchor.side) {
    case 'top': return [x + w * t, y];
    case 'bottom': return [x + w * t, y + h];
    case 'left': return [x, y + h * t];
    case 'right': return [x + w, y + h * t];
    default: return [x + w / 2, y + h / 2];
  }
}

// the cloud outline is treated as an ellipse for docking. `cloudAngle` gives
// the parametric angle under which a point sees the cloud, `cloudEntry` the
// matching point on the outline — so entries can be spread apart in angle
// space while every single entry still sits exactly where its line hits.
const cloudRadii = (net) => [net.w / 2 - 4, net.h / 2 - 3];

export function cloudAngle(net, from) {
  const [rx, ry] = cloudRadii(net);
  return Math.atan2((from[1] - net.y) / ry, (from[0] - net.x) / rx);
}

export function cloudEntry(net, angle) {
  const [rx, ry] = cloudRadii(net);
  return [net.x + rx * Math.cos(angle), net.y + ry * Math.sin(angle)];
}

// quadratic path p0 → p1 with an optional perpendicular bow or explicit ctrl
export function edgeGeometry(p0, p1, { bend = 0, ctrl = null } = {}) {
  let c;
  if (ctrl) {
    c = ctrl;
  } else if (bend) {
    const mx = (p0[0] + p1[0]) / 2;
    const my = (p0[1] + p1[1]) / 2;
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const len = Math.hypot(dx, dy) || 1;
    c = [mx + (-dy / len) * bend, my + (dx / len) * bend];
  } else {
    c = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  }
  const d = `M ${p0[0]} ${p0[1]} Q ${c[0]} ${c[1]} ${p1[0]} ${p1[1]}`;
  const at = (t) => {
    const u = 1 - t;
    return [
      u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
      u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1],
    ];
  };
  return { d, at };
}

// dash animation speed from traffic (MB/s): more traffic → faster
export function dashDuration(traffic) {
  if (!traffic) return 0;
  return Math.max(0.55, Math.min(9, 22 / (2 + traffic * 2.4)));
}
