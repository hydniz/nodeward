// ---------------------------------------------------------------------------
// a logger, no dependency
//
// Text lines while developing (readable next to vite's output), one json object
// per line in production (greppable, shippable). Swap the sink for pino or
// whatever else by replacing `write` — every module only ever sees `Logger`.
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = {
  debug: 10, info: 20, warn: 30, error: 40,
};

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** a logger that carries context along, e.g. `log.child({ module: 'health' })`. */
  child(context: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  /** json lines instead of text. */
  json: boolean;
}

function format(
  opts: LoggerOptions,
  level: LogLevel,
  msg: string,
  fields: Record<string, unknown>,
): string {
  const at = new Date().toISOString();
  if (opts.json) return JSON.stringify({ at, level, msg, ...fields });
  const rest = Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  return `${at} ${level.padEnd(5)} ${msg}${rest ? ` ${rest}` : ''}`;
}

export function createLogger(opts: LoggerOptions, context: Record<string, unknown> = {}): Logger {
  const write = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < ORDER[opts.level]) return;
    const line = format(opts, level, msg, { ...context, ...fields });
    if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (extra) => createLogger(opts, { ...context, ...extra }),
  };
}
