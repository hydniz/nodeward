// ---------------------------------------------------------------------------
// route helpers
//
// Three things every module needs and nobody should re-invent:
//   `handler`  — async routes whose rejections reach the error middleware
//   `stub`     — a route that exists, is documented, and answers 501
//   `validate` — the seam where request bodies get checked
// ---------------------------------------------------------------------------

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { badRequest, notImplemented } from './errors.ts';

/**
 * Express 4 does not await handlers, so a rejected promise would be an
 * unhandled rejection instead of a 500. Wrap every async route in this.
 */
export function handler<T>(
  fn: (req: Request, res: Response) => Promise<T>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * A route that is part of the api surface but has no logic yet.
 *
 * Keeping it mounted (instead of leaving it out) is deliberate: the endpoint
 * shows up in the route table, agents can be pointed at it, and the 501 body
 * names the file to implement. `what` becomes the message, `where` the hint.
 */
export function stub(what: string, where: string): RequestHandler {
  return () => {
    throw notImplemented(what, where);
  };
}

/**
 * The validation seam.
 *
 * A `Validator<T>` takes the raw body and either returns a typed value or
 * throws. Today the shipped validators only check that something is an object —
 * swap in zod/valibot/typebox by replacing the functions in
 * `modules/**\/*.schema.ts`; nothing else has to change.
 */
export type Validator<T> = (input: unknown) => T;

export function validateBody<T>(req: Request, validator: Validator<T>): T {
  return validator(req.body);
}

/** minimal guard so a validator can start from a known-object shape. */
export function expectObject(input: unknown, what: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest(`${what} must be a json object`);
  }
  return input as Record<string, unknown>;
}

export function expectString(
  obj: Record<string, unknown>,
  key: string,
  what: string,
): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw badRequest(`${what}.${key} must be a non-empty string`);
  }
  return v;
}

/**
 * A validator that only asserts "this is an object" and hands the body over
 * untyped-but-cast. Every ingest route uses one of these until the real schemas
 * land — the cast is the honest marker of an unchecked boundary.
 */
export function looseValidator<T>(what: string): Validator<T> {
  return (input: unknown) => expectObject(input, what) as unknown as T;
}

/** `?window=1h` style query numbers, with a default and a hard cap. */
export function numberParam(
  raw: unknown,
  fallback: number,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw badRequest(`not a number: ${raw}`);
  return Math.min(max, Math.max(min, n));
}
