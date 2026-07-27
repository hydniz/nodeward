// ---------------------------------------------------------------------------
// validation of what agents post to the enrolment and liveness endpoints
//
// Same strategy as `inventory.schema.ts`: every accepted object is REBUILT
// field by field from the raw body (allowlist). Unknown fields are dropped,
// every accepted field is type- and length-checked, ids must be canonical.
// The two bodies here are small, so the file keeps only the primitives it
// actually needs instead of sharing them across module boundaries.
// ---------------------------------------------------------------------------

import { badRequest } from '../../core/errors.ts';
import { expectObject } from '../../core/http.ts';
import type { Validator } from '../../core/http.ts';
import { asHostId } from '../../domain/common.ts';
import type { AgentHeartbeat, AgentRegistration } from '../../domain/index.ts';

type Obj = Record<string, unknown>;

/** same canonical host id rule the inventory ingest enforces: lowercase,
 *  alphanumeric plus `_ -`, no dot (a dotted host id would break service keys). */
const HOST_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** how far in the future a timestamp may lie before it counts as bogus. */
const MAX_SKEW_MS = 5 * 60 * 1000;

/** hard cap on free-form labels, so a hostile enrolment cannot bloat the store. */
const MAX_LABELS = 32;

/** the one way this file refuses input: a 400 naming the offending path. */
function fail(path: string, why: string): never {
  throw badRequest(`${path} ${why}`);
}

/** ascii control characters are the raw material of log/terminal escape
 *  tricks, so no string field accepts them. */
function hasControlChars(v: string): boolean {
  for (let i = 0; i < v.length; i += 1) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** required string: non-empty, at most `max` chars, no control characters. */
function reqStr(o: Obj, key: string, path: string, max: number): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) fail(`${path}.${key}`, 'must be a non-empty string');
  if (v.length > max) fail(`${path}.${key}`, `must be at most ${max} characters`);
  if (hasControlChars(v)) fail(`${path}.${key}`, 'must not contain control characters');
  return v;
}

/** like `reqStr`, but the field may be absent — never present-and-wrong. */
function optStr(o: Obj, key: string, path: string, max: number): string | undefined {
  return o[key] === undefined ? undefined : reqStr(o, key, path, max);
}

/** required canonical host id (see `HOST_ID` above). */
function reqHostId(o: Obj, key: string, path: string): string {
  const v = reqStr(o, key, path, 63);
  if (!HOST_ID.test(v)) fail(`${path}.${key}`, 'must be a canonical host id (lowercase, alphanumeric plus _ -, no dot)');
  return v;
}

/** required iso-8601 timestamp that does not lie in the future. */
function reqTimestamp(o: Obj, key: string, path: string): string {
  const v = reqStr(o, key, path, 50);
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) fail(`${path}.${key}`, 'must be an iso-8601 timestamp');
  if (ms > Date.now() + MAX_SKEW_MS) fail(`${path}.${key}`, 'must not lie in the future');
  return v;
}

/** optional non-negative finite number (`uptimeSeconds`). */
function optNum(o: Obj, key: string, path: string): number | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    fail(`${path}.${key}`, 'must be a non-negative finite number');
  }
  return v;
}

/** optional `{ key: value }` string map (`site=dorm`, `role=nas`). */
function optLabels(o: Obj, key: string, path: string): Record<string, string> | undefined {
  if (o[key] === undefined) return undefined;
  const raw = expectObject(o[key], `${path}.${key}`);
  const entries = Object.entries(raw);
  if (entries.length > MAX_LABELS) fail(`${path}.${key}`, `must not exceed ${MAX_LABELS} entries`);
  const labels: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (k.length === 0 || k.length > 50 || hasControlChars(k)) {
      fail(`${path}.${key}`, 'keys must be non-empty strings of at most 50 characters');
    }
    if (typeof v !== 'string' || v.length === 0 || v.length > 100 || hasControlChars(v)) {
      fail(`${path}.${key}.${k}`, 'must be a non-empty string of at most 100 characters');
    }
    labels[k] = v;
  }
  return labels;
}

// ---- the bodies -----------------------------------------------------------

/**
 * What `POST /api/agents/register` runs the body through.
 *
 * How it works, in order:
 *
 *   1. `joinToken` — shape only (non-empty, capped, no control characters).
 *      Whether it is *right* is the service's decision, and happens in
 *      constant time there (`agents.service.ts → register`) — a validator
 *      that answered "wrong token" with a 400 would leak the distinction
 *      between malformed and mismatched.
 *   2. `hostId` — canonical and dotless, because every piece of inventory
 *      will hang off it and service keys split at the first dot
 *   3. `name` / `version` — display strings, capped
 *   4. `platform` / `labels` — optional; labels are capped in count and size
 *      so a hostile enrolment cannot bloat the operator ui
 *
 * Unknown fields are dropped (the return object is built, not spread), and
 * absent optional fields stay absent — never present-and-undefined.
 */
export const asRegistration: Validator<AgentRegistration> = (input) => {
  const o = expectObject(input, 'registration');
  const path = 'registration';
  const platform = optStr(o, 'platform', path, 50);
  const labels = optLabels(o, 'labels', path);
  return {
    joinToken: reqStr(o, 'joinToken', path, 500),
    hostId: asHostId(reqHostId(o, 'hostId', path)),
    name: reqStr(o, 'name', path, 100),
    version: reqStr(o, 'version', path, 50),
    ...(platform !== undefined ? { platform } : {}),
    ...(labels !== undefined ? { labels } : {}),
  };
};

/**
 * What `POST /api/agents/:agentId/heartbeat` runs the body through.
 *
 * `hostId` is validated for shape here and compared against the token's host
 * in the service (protocol invariant 1 — the token decides the host, never
 * the payload). `at` must parse and not lie in the future; `version` and
 * `uptimeSeconds` are optional display data.
 */
export const asHeartbeat: Validator<AgentHeartbeat> = (input) => {
  const o = expectObject(input, 'heartbeat');
  const path = 'heartbeat';
  const version = optStr(o, 'version', path, 50);
  const uptimeSeconds = optNum(o, 'uptimeSeconds', path);
  return {
    hostId: asHostId(reqHostId(o, 'hostId', path)),
    at: reqTimestamp(o, 'at', path),
    ...(version !== undefined ? { version } : {}),
    ...(uptimeSeconds !== undefined ? { uptimeSeconds } : {}),
  };
};
