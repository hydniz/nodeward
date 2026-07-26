// ---------------------------------------------------------------------------
// health routes — the read side (the ui, and anyone who wants to look themselves)
//
//   GET /api/health/series?host=ug1              the catalogue: what is measured
//   GET /api/health/hosts/:hostId/latest         newest snapshot
//   GET /api/health/hosts/:hostId/series         window of samples (json)
//        ?metrics=cpu,ram&from=…&to=…&step=60
//   GET /api/health/hosts/:hostId/export.csv     the same window as csv
//
// The csv route is deliberately here and not only in grafana: "let me look at
// the numbers myself" is answered by a download, and the format is one every
// spreadsheet and pandas reads. Its plumbing is complete — it starts working the
// moment `series()` does.
//
// For ad-hoc questions beyond this, the data is plain sql in postgres; see
// `server/docs/explore.md` (grafana, metabase, psql).
//
// The *write* side lives with the agents (`agents.routes.ts`), because it is
// authenticated as an agent and scoped to the host that agent owns.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { handler, numberParam } from '../../core/http.ts';
import { notFound } from '../../core/errors.ts';
import { asHostId } from '../../domain/common.ts';
import type {
  MetricName, MetricSeries, MetricTarget, SeriesQuery,
} from '../../domain/index.ts';
import type { HealthService } from './health.service.ts';

const HOUR = 3600;

/** `{kind:'interface', iface:'ts0'}` → `interface:ts0`, for flat output. */
const targetLabel = (t: MetricTarget): string => {
  if (t.kind === 'host') return 'host';
  return t.kind === 'service' ? `service:${t.node}` : `interface:${t.iface}`;
};

/**
 * One row per point: `at,host,target,metric,unit,value`.
 *
 * Long format on purpose — it survives an unknown number of series, sorts
 * usefully, and pivots in one step wherever it is opened.
 */
function toCsv(series: MetricSeries[]): string {
  const rows = ['at,host,target,metric,unit,value'];
  series.forEach((s) => {
    const prefix = `${s.hostId},${targetLabel(s.target)},${s.name},${s.unit ?? ''}`;
    s.points.forEach((p) => rows.push(`${p.at},${prefix},${p.value}`));
  });
  return `${rows.join('\n')}\n`;
}

/** the window and metrics a request asks for, with sane defaults. */
function queryFrom(req: { params: Record<string, string>; query: Record<string, unknown> }): SeriesQuery {
  const stepSeconds = numberParam(req.query.step, 60, { min: 1, max: 86400 });
  const metrics = typeof req.query.metrics === 'string'
    ? req.query.metrics.split(',').map((m) => m.trim()).filter(Boolean) as MetricName[]
    : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : new Date().toISOString();
  const from = typeof req.query.from === 'string'
    ? req.query.from
    // default window: the last hour, which is what the ui draws by default
    : new Date(Date.parse(to) - HOUR * 1000).toISOString();
  return {
    hostId: asHostId(req.params.hostId),
    ...(metrics ? { names: metrics } : {}),
    from,
    to,
    stepSeconds,
  };
}

export function healthRoutes(health: HealthService): Router {
  const router = Router();

  // the catalogue — everything that is or was measured. This is what a metric
  // picker is built from, and the honest answer to "what do you even have?"
  router.get('/health/series', handler(async (req, res) => {
    const host = typeof req.query.host === 'string' ? asHostId(req.query.host) : undefined;
    res.json({ series: await health.catalogue(host) });
  }));

  router.get('/health/hosts/:hostId/latest', handler(async (req, res) => {
    const snapshot = await health.latest(asHostId(req.params.hostId));
    if (!snapshot) throw notFound(`health for host ${req.params.hostId}`);
    res.json(snapshot);
  }));

  router.get('/health/hosts/:hostId/series', handler(async (req, res) => {
    res.json({ series: await health.series(queryFrom(req)) });
  }));

  router.get('/health/hosts/:hostId/export.csv', handler(async (req, res) => {
    const query = queryFrom(req);
    const series = await health.series(query);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader(
      'content-disposition',
      `attachment; filename="${query.hostId}-${query.from}-${query.to}.csv"`,
    );
    res.send(toCsv(series));
  }));

  return router;
}
