# nodeward — graph layout rules

The topology graph lays itself out from **pure facts** (which interface of
which server/service is a member of which network). Nobody places anything
by hand. The engine lives in [`shared/autoLayout.js`](shared/autoLayout.js),
runs **in the backend**, and the api serves the finished geometry — so every
user sees exactly the same graph.

Rule numbers (R0…R7) are referenced from the code.

---

## R0 — Determinism

Same input ⇒ same layout, on every machine, for every user.

- No randomness anywhere in the pipeline. Cloud lobes look organic but are
  seeded from a stable hash of the network id.
- Every tie (equal barycenters, equal positions) is broken by sorting on the
  element id.
- The layout is computed once in the backend and served via `/api/topology`
  and `/api/servers`. Clients only render; zooming and panning never
  re-layout (see R7).

*Why:* screenshots, dashboards on the wall and two admins on a call must all
look at the identical picture.

## R1 — Bands: public on top, private at the bottom

The graph is organized in five horizontal bands, read top → bottom like the
path a packet takes from the internet into the home:

| band | contents | classification rule |
|------|----------|---------------------|
| 0 | internet providers (clouds) | network `role: 'provider'` |
| 1 | public servers | server has an uplink to a provider |
| 2 | shared networks (mesh vpn, overlays) | every non-provider, non-lan network |
| 3 | private / edge servers | server has **no** provider uplink (behind NAT) |
| 4 | local networks | network `role: 'lan'` |

*Why:* every edge spans at most two neighboring bands, so lines stay short
and mostly vertical; "how far from the internet is this?" is visible at a
glance. Shared networks sit **between** the public and private servers they
connect — the tailnet naturally becomes the center of the picture.

## R2 — Star centering (barycenter)

Horizontally, every element gravitates to the **mean x of its neighbors**
(network ↔ member servers, p2p partners ↔ each other):

- Networks end up in the middle of their members ⇒ each cloud is visibly
  the center of its star topology.
- Servers slide between the networks they touch; p2p partners align above
  each other, which keeps the direct line short.
- The relaxation runs a fixed number of alternating top-down/bottom-up
  sweeps; inside each band the *order* follows the barycenters (classic
  Sugiyama-style crossing reduction).

*Why:* barycenter ordering is the standard way to minimize edge crossings
in layered graphs — and crossings are the main enemy of Übersichtlichkeit.

## R3 — Spacing: fixed gutters, no overlaps

- min. horizontal gap between siblings in a band: **84 px**
- vertical gaps between bands: **112 / 132 / 132 / 112 px**
  (the wider middle gaps leave room for the ip labels of R7)
- world margin: **70 px**; the world size is derived from the content —
  never the other way around.
- After each barycenter sweep, overlaps are resolved by pushing elements
  apart while preserving their order (forward pass), then pulling them back
  toward their desired spot where space allows (backward pass).

*Why:* whitespace is a feature. Nothing may ever overlap; the picture may
grow instead.

## R4 — Sizes derive from content

- **Server box**: width = the widest of name row (incl. status/warn chip),
  mgmt address, chips row — plus padding. Uniform height.
- **Cloud**: width from the longer of name/subnet line + lobe padding;
  height grows with member count (a 6-member tailnet is visibly bigger than
  a 1-member provider), capped so no cloud dominates.

*Why:* text must never overflow its shape, and visual weight should encode
importance (hub networks look like hubs).

## R5 — Interfaces sit where their traffic goes

- A **port** (server interface) sits on the box side *facing* its network:
  dominant direction decides, with a bias to top/bottom because bands stack
  vertically.
- Multiple ports on one side are spread evenly and **ordered by target x**,
  so edges leaving one box never cross each other at the box.
- **Service chips** with their own link (sidecar, cni) are ordered inside
  the box toward their exit side — the chip with a link to the right sits
  rightmost. Node-level edges start **at the chip** and are drawn above the
  box: ownership is visible.
- P2P links attach to the two facing sides of their boxes.

*Why:* a line should exit a box in the direction it travels; assignments
(which ip → which interface → which service) must be readable without
tracing lines.

## R6 — Edges: straight, unless something is in the way

- Default is a straight line (visually: the shortest, calmest connection).
- If the straight segment would cut through a *foreign* box or cloud, the
  smallest clearing bow wins: candidate bends ±26 / ±46 / ±70 / ±100 px are
  tested in order, first collision-free one is used.
- Endpoints are exempt from the test (an edge may of course touch its own
  server and target cloud), as is the segment start inside the source box
  for node-level links.

*Why:* curves are visual noise — they are a last resort, and when needed
they stay as flat as possible.

## R7 — Labels: at the interface, never hidden

- Every ip label sits **directly at its interface**: as a tag above/below/
  beside the port (matching the port's box side), or at the exact point
  where a node-level link exits the box.
- Labels are rendered as the topmost layer with an opaque background — they
  can never be hidden by lines or boxes.
- Collisions between neighboring labels are resolved deterministically:
  the pair is separated along whichever axis needs the smaller move,
  in up to three passes.
- Zoom/pan transform the finished picture; they never trigger re-layout.

*Why:* the whole point of the label is assignment ("which ip is this
interface?") — so it must stick to the interface, and readability beats
millimeter-precision placement.

---

## Adding to the model

Agents (later) only need to deliver facts; the rules do the rest:

- new provider → new cloud in band 0, its servers get pulled underneath it
- new NAT-only server → appears in band 3 between the networks it joins
- new mesh/overlay network → band 2, centered over its members
- new p2p tunnel → direct line, partners align vertically
- new sidecar/cni service → chip moves toward its exit side, link starts
  at the chip

If a future case looks wrong, fix the **rule**, not the instance.
