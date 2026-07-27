# nodeward

**nodeward.dev** — see your whole server infrastructure at a glance.

Dark, mono-styled dashboard that renders your hosts, logical networks
(tailnet, wireguard, k3s overlay, home lan, wan) and the links between them
as an interactive topology graph.

Currently a **prototype with a working inventory ingest**: the backend serves
a demo dataset through the same api the agents use, and an agent can already
post its facts snapshot (`POST /api/agents/:id/inventory`) to appear in the
graph. The rest of the agent api (`/api/agents/**`) is a documented skeleton —
routes, types, storage seams — with the logic left to be written; see
[server/README.md](server/README.md).

## Stack

- `server/` — **TypeScript + express**, modular: `core` (plumbing) · `domain`
  (the shared contract) · `store` (repositories behind interfaces) · `modules`
  (inventory · topology · summary · health · agents · alerts). Node runs the
  sources directly, there is no build step. Read endpoints serve the demo
  fixture today; the agent ingest is scaffolded and documented but not
  implemented — see [server/README.md](server/README.md).
- `client/` — React 18 + Vite, hand-rolled SVG graph (no chart library);
  `components/ui.jsx` holds the page scaffolding all list pages share,
  `components/MorphLayout.jsx` the table ⇄ detail morph, `services.js` the
  service view-model derived from the host facts, `nav.js` the linking rules
- `shared/` — geometry helpers + the **auto-layout engine**: the graph lays
  itself out from pure facts following the rules in [LAYOUT.md](LAYOUT.md).
  Layout runs in the backend and ships finished geometry (endpoints, bends,
  label boxes), so every user sees the identical graph and the client only
  draws.

## Development

```sh
npm install        # installs both workspaces
npm run dev        # api on :4001 + vite dev server on :5173
```

Open http://localhost:5173 (vite proxies `/api` to the Express server).

## Production

```sh
npm run build      # builds client/dist
npm start          # express serves api + built frontend on :4001
```

## Navigation

One rule on every page and on the map:

- **a page opens its own kind directly.** A host row on *Servers* and a service
  row on *Services* need one click — no card in between.
- **everything else gives a mini overview first**: host box, service chip,
  interface, link, trunk, cloud, network member, dns record, ip label → a card
  with the facts that matter and no page change.
- every mini overview ends in **"open … page →"**, which lands on the full
  page with the detail **already expanded**.
- **ctrl / cmd + click** skips the mini overview and jumps straight there.
- deep links are the same urls, so they can be shared:
  `/servers?server=ug1`, `/services?service=ug1.wiki`,
  `/servers?server=ug1&node=wiki` (host page, that service highlighted),
  `/networks?net=tailnet`, `/domains?zone=jnsm.eu`, `/?focus=ug1`
  (host focused on the map — "show on map →" uses it).
- hovering a **service chip** highlights the chip, not its host: what lights up
  is what a click will select.

## On a phone

The same pages, re-stacked — nothing is desktop-only:

- sidebar becomes a top bar with a scrollable nav
- head, filters and tiles stack; tiles go two-up
- list pages drop to one column: the master rail turns into a horizontal tab
  strip, and an expanded detail takes the screen (✕ goes back)
- tables keep the columns that answer "which one is this and how is it doing";
  the rest stays reachable by scrolling the table sideways
- mini overviews arrive as bottom sheets
- the map pans with one finger and **pinches to zoom** with two

## Features

- **Overview** — full-mesh topology graph
  - fully automatic layout (bands, barycenter star centering, obstacle-free
    edges — see [LAYOUT.md](LAYOUT.md)); no hand-placed coordinates
  - networks drawn as clouds, each the center of a star topology
  - host boxes split into a **protected header** (name + address, never
    crossed by a line or label) and a **service zone** whose chip grid sits
    on the side its links leave through — grows to a second row instead of
    widening the box (R8)
  - ▪ port = host interface, ○ ring = service interface (k3s cni, ts sidecar)
  - **trunking**: three or more links from one host into one network leave as
    short stubs, meet in a hub and travel on as a single trunk, with one
    stacked ip list naming the owning service per row (R9) — the map stays
    countable when a NAS grows from three to ten services
  - every connector gets its own entry point on the cloud, so parallel links
    stay distinguishable
  - dashed links animated by traffic: more traffic → faster dashes
  - ip labels drawn on top, pushed out of boxes and cloud names
  - click a host/service → detail modal (also works for down hosts)
  - click an interface, link or label → info panel (ips, dns records,
    cf-proxied state, wireguard routed traffic, …); click a trunk → the
    bundled interfaces, each row opening its own interface
  - click a network cloud → membership panel
  - filter chips (Tailnet / k3s / wg0 / Docker) highlight subsets
  - zoom with touchpad pinch or scroll, drag to pan, fit button
- **Servers**, **Services**, **Networks** and **Domains** share one page
  skeleton — head → filter chips + meta → stat tiles → table/detail card, same
  chips, tables, section headings and key/value rows everywhere:
  - **Servers** — the host table is the default view (sortable, searchable,
    status + network filters, fleet tiles). Clicking a host **morphs** the page
    into the master/detail shape: the table is squeezed to the left and
    replaced by the host rail while the expanded host view is pushed in from
    the right (meters, services, interfaces, the dns records pointing at it,
    its networks — every row linking on). "‹ all hosts" morphs back.
  - **Services** — the same page for the 23 services across all hosts:
    runtime filters (docker / k3s / vm / native), table with host, stack,
    own address, exposure, dns count and traffic; the expanded view adds the
    stack siblings, own interfaces, dns records and the host it runs on.
  - **Networks** — master/detail per network (deep-linkable via
    `/networks?net=<id>`): grouped rail with live traffic, stat tiles, member
    table (interface, address, link details, traffic share), plus data-driven
    sections — bundled joins, dns records terminating in the network,
    magicdns names, traffic routed over p2p tunnels, interface facts, notes
  - **Domains** — master/detail per dns zone (`/domains?zone=<id>`), grouped
    into public / magicdns / internal: record table (name, type, target with
    proxy hops and ttl, terminating host + service + network, exposure,
    certificate age), zone facts (registrar, nameservers, dnssec, renewal),
    certificates sorted by expiry, and per-record notes. A record opens its
    own overview (answer, proxy path, terminating host/service, certificate)
    and links on to that host, its network or the zone.
- Other sections are placeholders for now.
