// ---------------------------------------------------------------------------
// agent routes — everything an agent talks to, plus the operator's view
//
// agent-facing (bearer token, see agents.auth.ts)
//   POST /api/agents/register                enrol with a join token
//   GET  /api/agents/:agentId/config         what to collect, how often
//   POST /api/agents/:agentId/heartbeat      "still here"
//   POST /api/agents/:agentId/inventory      facts snapshot
//   POST /api/agents/:agentId/health         metric samples
//   POST /api/agents/:agentId/events         discrete events
//   POST /api/agents/:agentId/batch          several of the above at once
//
// operator-facing
//   GET    /api/agents                       list, with derived status
//   GET    /api/agents/:agentId              one agent
//   DELETE /api/agents/:agentId              revoke its token
//
// Two rules hold for every ingest route:
//   • the payload's `hostId` is never trusted over the token's host — the
//     service compares them and refuses a mismatch
//   • an ack is cheap and always returned, so a retrying agent stays harmless
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Config } from '../../config.ts';
import type { Logger } from '../../core/logger.ts';
import { handler, looseValidator, validateBody } from '../../core/http.ts';
import { forbidden, notFound, notImplemented } from '../../core/errors.ts';
import { asAgentId } from '../../domain/common.ts';
import type {
  AgentBatch, AgentEvent, AgentHeartbeat, AgentRegistration, HealthReport,
} from '../../domain/index.ts';
import type { Store } from '../../store/index.ts';
import type { HealthService } from '../health/health.service.ts';
import type { InventoryService } from '../inventory/inventory.service.ts';
import { asInventoryReport } from '../inventory/inventory.schema.ts';
import { principalOf, requireAgent, requireOperator } from './agents.auth.ts';
import type { AgentsService } from './agents.service.ts';

/**
 * Validators are the loose kind for now — they assert "this is an object" and
 * hand the body on. Replace them one by one with real schemas; the call sites
 * never change. The inventory report already has one: `inventory.schema.ts`.
 */
const asRegistration = looseValidator<AgentRegistration>('registration');
const asHeartbeat = looseValidator<AgentHeartbeat>('heartbeat');
const asHealthReport = looseValidator<HealthReport>('health report');
const asBatch = looseValidator<AgentBatch>('batch');
const asEvents = (input: unknown): AgentEvent[] => (Array.isArray(input)
  ? (input as AgentEvent[])
  : [looseValidator<AgentEvent>('event')(input)]);

export function agentRoutes(
  config: Config,
  store: Store,
  agents: AgentsService,
  health: HealthService,
  inventory: InventoryService,
  log: Logger,
): Router {
  const router = Router();
  const agentAuth = requireAgent(config, store, log);
  const operatorAuth = requireOperator(config, log);

  // ---- enrolment ---------------------------------------------------------
  // no token yet — this is where an agent gets one, in exchange for the join
  // token that came with the install command
  router.post('/agents/register', handler(async (req, res) => {
    const result = await agents.register(validateBody(req, asRegistration));
    res.status(201).json(result);
  }));

  // ---- reporting ---------------------------------------------------------
  router.get('/agents/:agentId/config', agentAuth, handler(async (req, res) => {
    res.json(await agents.configFor(asAgentId(req.params.agentId)));
  }));

  router.post('/agents/:agentId/heartbeat', agentAuth, handler(async (req, res) => {
    const ack = await agents.heartbeat(principalOf(req), validateBody(req, asHeartbeat));
    res.json(ack);
  }));

  router.post('/agents/:agentId/inventory', agentAuth, handler(async (req, res) => {
    const report = validateBody(req, asInventoryReport);
    // the token decides the host, never the payload (rule at the top of this
    // file): a report about any other host is refused, whatever it claims
    if (report.hostId !== principalOf(req).hostId) {
      throw forbidden('report hostId does not match the host this token owns');
    }
    await inventory.applyReport(report);
    res.status(202).json({ accepted: true, hostId: report.hostId });
  }));

  router.post('/agents/:agentId/health', agentAuth, handler(async (req, res) => {
    const ack = await health.ingest(principalOf(req), validateBody(req, asHealthReport));
    res.status(202).json(ack);
  }));

  router.post('/agents/:agentId/events', agentAuth, handler(async (req, res) => {
    const ack = await health.ingestEvents(principalOf(req), asEvents(req.body));
    res.status(202).json(ack);
  }));

  /**
   * One request that carries several reports, for an agent that was offline.
   *
   * TODO(implement): walk `batch.items` in order and dispatch each to the
   * service that owns it (inventory / health / events / heartbeat). Stop at the
   * first rejection and report how far it got, so the agent can resume instead
   * of starting over.
   */
  router.post('/agents/:agentId/batch', agentAuth, handler(async (req, res) => {
    const batch = validateBody(req, asBatch);
    log.debug('batch received', { items: batch.items?.length ?? 0 });
    throw notImplemented(
      'batched ingest',
      'server/src/modules/agents/agents.routes.ts → POST /agents/:agentId/batch',
    );
  }));

  // ---- operator ----------------------------------------------------------
  router.get('/agents', operatorAuth, handler(async (_req, res) => {
    res.json({ agents: await agents.list() });
  }));

  router.get('/agents/:agentId', operatorAuth, handler(async (req, res) => {
    const agent = await agents.get(asAgentId(req.params.agentId));
    if (!agent) throw notFound(`agent ${req.params.agentId}`);
    res.json(agent);
  }));

  router.delete('/agents/:agentId', operatorAuth, handler(async (req, res) => {
    await agents.revoke(asAgentId(req.params.agentId));
    res.status(204).end();
  }));

  return router;
}
