import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger.ts';

describe('logger', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeward-logger-'));
    // keep test output clean; the file sink is what the assertions read
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const readLines = () => {
    const [file] = fs.readdirSync(dir);
    expect(file).toMatch(/^nodeward-\d{4}-\d{2}-\d{2}\.log$/);
    return fs.readFileSync(path.join(dir, file!), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l));
  };

  it('persists json lines with the calling file and line', () => {
    const log = createLogger({ level: 'debug', json: false, dir });
    log.info('hello', { answer: 42 });

    const [line] = readLines();
    expect(line).toMatchObject({ level: 'info', msg: 'hello', answer: 42 });
    expect(line.src).toMatch(/^src\/core\/logger\.test\.ts:\d+$/);
  });

  it('drops records below the configured level', () => {
    const log = createLogger({ level: 'warn', json: true, dir });
    log.debug('nope');
    log.info('nope');
    log.warn('kept');

    const lines = readLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe('kept');
  });

  it('carries child context into the file', () => {
    const log = createLogger({ level: 'info', json: true, dir });
    log.child({ module: 'health' }).error('boom');

    const [line] = readLines();
    expect(line).toMatchObject({ level: 'error', msg: 'boom', module: 'health' });
  });

  it('writes no file when dir is unset', () => {
    const log = createLogger({ level: 'debug', json: false });
    log.info('console only');
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });
});
