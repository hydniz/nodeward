// ---------------------------------------------------------------------------
// inventory routes — the read endpoints the frontend lives on
//
//   GET /api/servers            hosts: facts + latest health + box geometry
//   GET /api/servers/:hostId    one host, same shape
//   GET /api/services           every service across all hosts
//   GET /api/services/:id       one service (`<host>.<node>`, e.g. ug1.wiki)
//   GET /api/networks           the logical networks
//   GET /api/domains            dns zones + records
//
// The paths are fixed by the client (`client/src/api.js`); keep them stable.
//
// Why `/servers` carries geometry: the graph draws its host boxes from the same
// response the tables use, and the layout is computed on the server (LAYOUT.md
// R0). Facts and health come from the inventory module, the box comes from the
// topology module's cached layout — merged here, so the numbers are always as
// fresh as the last report while the geometry is only recomputed when the
// inventory actually changed.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { handler } from '../../core/http.ts';
import { notFound } from '../../core/errors.ts';
import { asHostId, asServiceId } from '../../domain/common.ts';
import type { HostApiView, HostBox } from '../../domain/topology.ts';
import type { HostId, HostView } from '../../domain/index.ts';
import type { TopologyService } from '../topology/topology.service.ts';
import type { InventoryService } from './inventory.service.ts';

const withBox = (host: HostView, boxes: Map<HostId, HostBox>): HostApiView => {
  const box = boxes.get(host.id);
  return box ? { ...host, ...box } : host;
};

export function inventoryRoutes(
  inventory: InventoryService,
  topology: TopologyService,
): Router {
  const router = Router();

  router.get('/servers', handler(async (_req, res) => {
    const [hosts, boxes] = await Promise.all([inventory.listHosts(), topology.hostBoxes()]);
    res.json({ servers: hosts.map((h) => withBox(h, boxes)) });
  }));

  router.get('/servers/:hostId', handler(async (req, res) => {
    const id = asHostId(req.params.hostId);
    const [host, boxes] = await Promise.all([inventory.getHost(id), topology.hostBoxes()]);
    if (!host) throw notFound(`host ${req.params.hostId}`);
    res.json(withBox(host, boxes));
  }));

  router.get('/services', handler(async (_req, res) => {
    const services = await inventory.listServices();
    res.json({ services });
  }));

  router.get('/services/:serviceId', handler(async (req, res) => {
    const service = await inventory.getService(asServiceId(req.params.serviceId));
    if (!service) throw notFound(`service ${req.params.serviceId}`);
    res.json(service);
  }));

  router.get('/networks', handler(async (_req, res) => {
    const networks = await inventory.listNetworks();
    res.json({ networks });
  }));

  router.get('/domains', handler(async (_req, res) => {
    res.json(await inventory.domains());
  }));

  return router;
}
