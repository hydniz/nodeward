# nodeward

**nodeward.dev** — see your whole server infrastructure at a glance.

Dark, mono-styled dashboard that renders your hosts, logical networks
(tailnet, wireguard, k3s overlay, home lan, wan) and the links between them
as an interactive topology graph.

Currently a **static prototype**: the Express backend serves a fixed mock
dataset. Later, nodeward agents on each host will push live data through the
same API shapes for realtime graphs and analytics.

## Stack

- `server/` — Express (Node), REST API: `/api/topology`, `/api/servers`,
  `/api/servers/:id`, `/api/summary`
- `client/` — React 18 + Vite, hand-rolled SVG graph (no chart library)
- `shared/` — geometry helpers + the **auto-layout engine**: the graph lays
  itself out from pure facts following the rules in [LAYOUT.md](LAYOUT.md).
  Layout runs in the backend, so every user sees the identical graph.

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

## Features

- **Overview** — full-mesh topology graph
  - fully automatic layout (bands, barycenter star centering, obstacle-free
    edges — see [LAYOUT.md](LAYOUT.md)); no hand-placed coordinates
  - networks drawn as clouds, each the center of a star topology
  - server boxes with node chips; ▪ port = server-level interface,
    ○ ring = node-level interface (e.g. k3s cni, tailscale sidecar)
  - dashed links animated by traffic: more traffic → faster dashes
  - ip label on every link, drawn on top so nothing is hidden
  - click a server/node → detail modal (also works for down hosts)
  - click an interface, link or label → info panel (ips, dns records,
    cf-proxied state, wireguard routed traffic, …)
  - click a network cloud → membership panel
  - filter chips (Tailnet / k3s / wg0 / Docker) highlight subsets
  - zoom with touchpad pinch or scroll, drag to pan, fit button
- **Servers** — sortable/searchable host table with status filters and
  per-network badge filtering; row click opens the same server modal
- **Networks** — master/detail view of every network (deep-linkable via
  `/networks?net=<id>`): grouped list with live traffic, per-network stat
  tiles, member table (interface, address, link details, traffic share),
  plus data-driven sections — dns records terminating in the network,
  magicdns names, traffic routed over p2p tunnels, interface facts, notes.
  Reachable from the map via "open network page" in the cloud panel.
- Other sections are placeholders for now.
