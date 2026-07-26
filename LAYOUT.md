# nodeward — graph layout rules

The topology graph lays itself out from **pure facts** (which interface of
which server/service is a member of which network). Nobody places anything
by hand. The engine lives in [`shared/autoLayout.js`](shared/autoLayout.js),
runs **in the backend**, and the api serves the finished geometry — every
endpoint, every bend, every label box — so every user sees exactly the same
graph and the client only draws.

Rule numbers (R0…R9) are referenced from the code.

---

## R0 — Determinism

Same input ⇒ same layout, on every machine, for every user.

- No randomness anywhere in the pipeline. Cloud lobes look organic but are
  seeded from a stable hash of the network id.
- Every tie (equal barycenters, equal angles, equal positions) is broken by
  sorting on the element id.
- The layout is computed once in the backend and served via `/api/topology`
  and `/api/servers`. Clients only render; zooming and panning never
  re-layout.

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

- min. horizontal gap between siblings in a band: **96 px**
- vertical gaps between bands: **92 / 116 / 116 / 92 px**
  (the wider middle gaps leave room for the ip labels of R7)
- world margin: **56 px**; the world size is derived from the content —
  never the other way around.
- After each barycenter sweep, overlaps are resolved by pushing elements
  apart while preserving their order (forward pass), then pulling them back
  toward their desired spot where space allows (backward pass).

*Why:* whitespace is a feature. Nothing may ever overlap; the picture may
grow instead.

## R4 — Sizes derive from content

- **Server box**: width = the widest of name row (incl. status/warn chip),
  mgmt address and chip grid, plus padding. Height = header + chip rows.
- **Chip grid**: up to four services per row, then a second row opens and
  the rows are balanced (9 services ⇒ 3×3). Ten services make a box, not a
  ribbon.
- **Cloud**: width from the longer of name/subnet line + lobe padding;
  height grows with member count (a 9-member tailnet is visibly bigger than
  a 1-member provider), capped so no cloud dominates.

*Why:* text must never overflow its shape, visual weight should encode
importance (hub networks look like hubs), and a host that runs many services
must not become a 900 px wide strip.

## R5 — Interfaces sit where their traffic goes

- A **port** (host interface) sits on the box side *facing* its target:
  dominant direction decides, with a bias to top/bottom because bands stack
  vertically.
- Multiple ports on one side are spread evenly and **ordered by target x**,
  so edges leaving one box never cross each other at the box.
- **Service chips** with their own link are ordered inside the zone toward
  their exit side — the chip with a link to the right sits rightmost — and
  fill the row closest to the border they leave through. Service edges start
  **at the chip**: ownership is visible.
- On the cloud side, every incoming connector gets **its own entry point**:
  entries are spread apart in angle around the cloud outline (min. gap,
  ordered by where they come from, centered on their natural direction).
- P2P links attach to the two facing sides of their boxes.

*Why:* a line should exit a box in the direction it travels, and assignments
(which ip → which interface → which service) must be readable without
tracing lines. Without spread entries, five links arriving from below dock
in the same spot and become one indistinguishable brush stroke.

## R6 — Edges: straight, unless something is in the way

- Default is a straight line (visually: the shortest, calmest connection).
- If the straight segment would cut through a *foreign* box or cloud, the
  smallest clearing bow wins: candidate bends ±26 / ±46 / ±70 / ±100 px are
  tested in order, first collision-free one is used.
- Endpoints are exempt from the test (an edge may of course touch its own
  server and target cloud).

*Why:* curves are visual noise — they are a last resort, and when needed
they stay as flat as possible.

## R7 — Labels: at the interface, never hidden, never covering

Label boxes are computed by the engine, not the renderer.

- Every ip label sits **directly at its interface**: as a tag outside the
  border next to the port, or at the exact point where a service link leaves
  the box.
- Labels are rendered as the topmost layer with an opaque background — they
  can never be hidden by lines or boxes.
- A label may never cover a **server box** or the **name of a cloud**: it is
  pushed out on the side its own interface sits on, so it still reads as
  belonging to that interface. Boxes win, always.
- Collisions between neighboring labels are resolved deterministically:
  the pair is separated along whichever axis needs the smaller move, in up
  to three passes, each followed by the push-out above.

*Why:* the whole point of the label is assignment ("which ip is this
interface?") — so it must stick to the interface, and a host name that is
covered by an ip tag is worse than a label 20 px further out.

## R8 — The header of a box is a protected zone

A box has two zones: the **header** (status dot, host name, mgmt address)
and the **service zone** (the chip grid).

- The service zone sits on the side **its links leave through**: services
  that talk upwards (tailnet, k3s from an edge host) put the chips on top
  and the name below; services that talk downwards keep the chips at the
  bottom. A hairline separates the two.
- No line and no label may cross the header. Because the chips sit next to
  the border they exit through, the in-box part of a service link is a few
  pixels long and the host name stays clean.
- If a single service link points the *other* way (past the header), it
  leaves through the nearer vertical border instead of crossing it.
- Stubs from an inner chip row are drawn **behind** the chips of the outer
  row, so they never appear to start at the wrong service.

*Why:* the host name is the first thing you look for. Before this rule, the
third sidecar on a NAS dragged its line and its ip tag straight across
"ug1" — the picture was still correct and no longer readable.

## R9 — Trunking: many links into one network become one line

If one host has **three or more** links into the same network, they are not
drawn as three near-parallel lines:

- each link leaves the box as a short **stub** (port or chip → collector),
- the stubs meet in a **hub** dot just outside the border,
- from there a single, slightly thicker **trunk** carries them to the cloud,
  its dash speed driven by the summed traffic,
- the addresses are listed in one **stacked label**, one row per link,
  tagged with the service that owns it, set beside the trunk (never on it).

Clicking the trunk lists the bundled interfaces; clicking a row of the stack
opens that single interface.

*Why:* this is the rule that makes the picture survive growth. Seven
tailscale identities on one NAS are seven indistinguishable dashed lines
through the same gap — as a bundle they are seven short stubs, one countable
line and one readable list. Below the threshold nothing is bundled, because
two lines are easier to follow than a line plus an abstraction.

---

## Adding to the model

Agents (later) only need to deliver facts; the rules do the rest:

- new provider → new cloud in band 0, its servers get pulled underneath it
- new NAT-only server → appears in band 3 between the networks it joins
- new mesh/overlay network → band 2, centered over its members
- new p2p tunnel → direct line, partners align vertically
- new sidecar/cni service → the chip grid grows (a second row if needed),
  the chip moves toward its exit side, the link starts at the chip
- third service joining the same network from one host → the links collapse
  into a trunk automatically (R9)

If a future case looks wrong, fix the **rule**, not the instance.
