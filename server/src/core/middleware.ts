// ---------------------------------------------------------------------------
// the middleware chain
//
// Order in `app.ts`:
//   requestId → requestLog → json body → routes → notFound → errorHandler
//
// Nothing here knows about the domain; keep it that way.
// ---------------------------------------------------------------------------

import type {
  ErrorRequestHandler, NextFunction, Request, RequestHandler, Response,
} from 'express';
import { randomUUID } from 'node:crypto';
import type { Logger } from './logger.ts';
import { isApiError, notFound, toProblem } from './errors.ts';

/** what the middlewares hang onto the request. */
export interface RequestContext {
  id: string;
  startedAt: number;
  log: Logger;
}

// express has no typed locals, so the context lives in a symbol-keyed field
const CTX = Symbol('nodeward.ctx');

export function contextOf(req: Request): RequestContext | undefined {
  return (req as Request & { [CTX]?: RequestContext })[CTX];
}

export function requestId(log: Logger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // trust an upstream id when there is one, so traces survive a proxy
    const incoming = req.header('x-request-id');
    const id = incoming && incoming.length <= 200 ? incoming : randomUUID();
    const ctx: RequestContext = { id, startedAt: Date.now(), log: log.child({ req: id }) };
    (req as Request & { [CTX]?: RequestContext })[CTX] = ctx;
    res.setHeader('x-request-id', id);
    next();
  };
}

export function requestLog(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = contextOf(req);
    if (!ctx) return next();
    res.on('finish', () => {
      const ms = Date.now() - ctx.startedAt;
      const fields = {
        method: req.method, path: req.originalUrl, status: res.statusCode, ms,
      };
      // 4xx/5xx are the interesting ones; successful polls stay at debug
      if (res.statusCode >= 500) ctx.log.error('request failed', fields);
      else if (res.statusCode >= 400) ctx.log.warn('request rejected', fields);
      else ctx.log.debug('request', fields);
    });
    return next();
  };
}

export function notFoundHandler(): RequestHandler {
  return (req: Request) => {
    throw notFound(`route ${req.method} ${req.path}`);
  };
}

export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const ctx = contextOf(req);
    const { status, body } = toProblem(err, ctx?.id);
    // an unexpected error is a bug: keep the stack, but never ship it
    if (!isApiError(err)) {
      (ctx?.log ?? log).error('unhandled error', {
        path: req.originalUrl,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
    return res.status(status).json(body);
  };
}
