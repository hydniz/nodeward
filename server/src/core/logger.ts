// ---------------------------------------------------------------------------
// a logger, no dependency
//
// Text lines while developing (readable next to vite's output), one json object
// per line in production (greppable, shippable). When `dir` is set, every line
// additionally lands in a daily file (`nodeward-YYYY-MM-DD.log`, always json) —
// production always sets it, development only on request. Every record carries
// `src`, the `file:line` that emitted it, so a grep over the files leads
// straight back to the code. Swap the sink for pino or whatever else by
// replacing `write` — every module only ever sees `Logger`.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  /** json lines on the console instead of text. Files are always json. */
  json: boolean;
  /** directory for persistent daily log files; unset → console only. */
  dir?: string;
}

// paths in `src` are reported relative to the server package
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const loggerFile = fileURLToPath(import.meta.url);

/**
 * `file:line` of the code that called the logger — the first stack frame
 * outside this file. Type stripping keeps line numbers, so the position is the
 * one in the .ts source.
 */
function callSite(): string | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;
  for (const frame of stack.split('\n').slice(1)) {
    const m = frame.match(/\(?((?:file:\/\/)?[^()\s]+):(\d+):\d+\)?$/);
    if (!m) continue;
    const file = m[1]!.startsWith('file://') ? fileURLToPath(m[1]!) : m[1]!;
    if (file === loggerFile || file.startsWith('node:')) continue;
    return `${path.relative(packageRoot, file)}:${m[2]}`;
  }
  return undefined;
}

interface LogRecord {
  at: string;
  level: LogLevel;
  src?: string;
  msg: string;
  fields: Record<string, unknown>;
}

function formatText({ at, level, src, msg, fields }: LogRecord): string {
  const rest = Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  return `${at} ${level.padEnd(5)} ${msg}${rest ? ` ${rest}` : ''}${src ? ` (${src})` : ''}`;
}

function formatJson({ at, level, src, msg, fields }: LogRecord): string {
  return JSON.stringify({ at, level, src, msg, ...fields });
}

/**
 * Appends json lines to one file per day in `dir`. Writes are synchronous, so
 * a crash right after a log call cannot lose the line and no flush is needed
 * on shutdown — the exit closes the descriptor.
 */
function createFileSink(dir: string): (line: string) => void {
  fs.mkdirSync(dir, { recursive: true });
  let fd = -1;
  let day = '';
  return (line) => {
    const today = new Date().toISOString().slice(0, 10);
    if (fd < 0 || today !== day) {
      if (fd >= 0) fs.closeSync(fd);
      day = today;
      fd = fs.openSync(path.join(dir, `nodeward-${day}.log`), 'a');
    }
    fs.writeSync(fd, `${line}\n`);
  };
}

export function createLogger(opts: LoggerOptions): Logger {
  const toFile = opts.dir ? createFileSink(opts.dir) : undefined;

  const write = (level: LogLevel, msg: string, fields: Record<string, unknown>) => {
    if (ORDER[level] < ORDER[opts.level]) return;
    const record: LogRecord = {
      at: new Date().toISOString(), level, src: callSite(), msg, fields,
    };
    const line = opts.json ? formatJson(record) : formatText(record);
    if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
    toFile?.(opts.json ? line : formatJson(record));
  };

  // children share the file sink; only the bound context differs
  const make = (context: Record<string, unknown>): Logger => ({
    debug: (m, f) => write('debug', m, { ...context, ...f }),
    info: (m, f) => write('info', m, { ...context, ...f }),
    warn: (m, f) => write('warn', m, { ...context, ...f }),
    error: (m, f) => write('error', m, { ...context, ...f }),
    child: (extra) => make({ ...context, ...extra }),
  });
  return make({});
}
