import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networks, servers, edges, p2p, summary } from './data.js';
import autoLayout from '../../shared/autoLayout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4001;

// the graph layout is computed once, server-side, from pure facts —
// deterministic rules (see LAYOUT.md), so every user sees the same graph.
// with live agent data this recomputes whenever the topology changes.
const laid = autoLayout({ networks, servers, edges, p2p });

// ---- api -------------------------------------------------------------------
app.get('/api/topology', (_req, res) => {
  res.json({
    world: laid.world,
    networks: laid.networks,
    edges: laid.edges,
    p2p: laid.p2p,
    updated: Date.now(),
  });
});

app.get('/api/servers', (_req, res) => {
  res.json({ servers: laid.servers });
});

app.get('/api/servers/:id', (req, res) => {
  const server = laid.servers.find((s) => s.id === req.params.id);
  if (!server) return res.status(404).json({ error: 'not found' });
  res.json(server);
});

app.get('/api/summary', (_req, res) => {
  res.json(summary());
});

// ---- static frontend (production build) ------------------------------------
const dist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(dist));
app.get(/^\/(?!api).*/, (_req, res, next) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => err && next());
});

app.listen(PORT, () => {
  console.log(`nodeward api listening on http://localhost:${PORT}`);
});
