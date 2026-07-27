// ---------------------------------------------------------------------------
// errors that know their http status
//
// Everything a route can fail with is an `ApiError`. The error middleware turns
// it into the one json shape the api ever returns for failures:
//
//   { "error": { "code": "not_implemented", "message": "…", "details": {…} } }
//
// Anything that is *not* an ApiError is a bug: it is logged with its stack and
// answered with a bare 500, never with internals.
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'unprocessable'
  | 'too_many_requests'
  | 'internal'
  | 'not_implemented'
  | 'unavailable';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  unprocessable: 422,
  too_many_requests: 429,
  internal: 500,
  not_implemented: 501,
  unavailable: 503,
};

export class ApiError extends Error {
  readonly code: ErrorCode;

  readonly status: number;

  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

export const badRequest = (message: string, details?: Record<string, unknown>) => new ApiError('bad_request', message, details);
export const unauthorized = (message = 'authentication required') => new ApiError('unauthorized', message);
export const forbidden = (message = 'not allowed') => new ApiError('forbidden', message);
export const notFound = (what: string) => new ApiError('not_found', `${what} not found`);
export const conflict = (message: string, details?: Record<string, unknown>) => new ApiError('conflict', message, details);
export const unprocessable = (message: string, details?: Record<string, unknown>) => new ApiError('unprocessable', message, details);
export const tooManyRequests = (message = 'too many requests') => new ApiError('too_many_requests', message);
export const unavailable = (message: string) => new ApiError('unavailable', message);

/**
 * The placeholder every unimplemented seam throws.
 *
 * `where` is the file (and ideally the function) that has to be written, so the
 * 501 body tells whoever hits it exactly where to go — including the frontend
 * developer poking at the api.
 */
export const notImplemented = (what: string, where: string) => new ApiError(
  'not_implemented',
  `${what} is not implemented yet`,
  { implementIn: where },
);

/** the wire shape of a failure. */
export interface ProblemBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
}

export function toProblem(e: unknown, requestId?: string): { status: number; body: ProblemBody } {
  if (isApiError(e)) {
    return {
      status: e.status,
      body: {
        error: {
          code: e.code,
          message: e.message,
          ...(e.details ? { details: e.details } : {}),
          ...(requestId ? { requestId } : {}),
        },
      },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: 'internal',
        message: 'internal error',
        ...(requestId ? { requestId } : {}),
      },
    },
  };
}
