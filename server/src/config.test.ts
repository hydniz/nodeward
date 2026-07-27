// ---------------------------------------------------------------------------
// the spec for the config safety rails
//
// `loadConfig` is a pure function of an env object, so these tests feed it
// alternative worlds directly. The interesting cases are the ones where the
// server must refuse to boot: production with a development shortcut, or with
// credentials too weak to matter.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const production = (env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production', ...env,
});

describe('config safety rails', () => {
  it('refuses the shared AGENT_TOKEN in production', () => {
    expect(() => loadConfig(production({ AGENT_TOKEN: 'shortcut' })))
      .toThrow(/AGENT_TOKEN.*development shortcut/);
  });

  it('refuses a weak AGENT_JOIN_TOKEN in production', () => {
    expect(() => loadConfig(production({ AGENT_JOIN_TOKEN: 'letmein' })))
      .toThrow(/at least 16 characters/);
  });

  it('accepts a strong join token in production', () => {
    const config = loadConfig(production({ AGENT_JOIN_TOKEN: 'a'.repeat(24), AUTH_DISABLED: 'true' }));
    expect(config.agents.joinToken).toHaveLength(24);
  });

  it('allows the shortcuts while developing', () => {
    const config = loadConfig({ NODE_ENV: 'development', AGENT_TOKEN: 'x', AGENT_JOIN_TOKEN: 'y' });
    expect(config.agents.sharedToken).toBe('x');
    expect(config.agents.joinToken).toBe('y');
  });

  it('refuses postgres without a connection string', () => {
    expect(() => loadConfig({ STORE_DRIVER: 'postgres' })).toThrow(/DATABASE_URL/);
  });

  it('production without a login must be an explicit decision', () => {
    expect(() => loadConfig(production())).toThrow(/ADMIN_PASSWORD/);
    expect(loadConfig(production({ ADMIN_PASSWORD: 'long-enough-pw' })).auth.adminPassword).toBeDefined();
    expect(loadConfig(production({ AUTH_DISABLED: 'true' })).auth.disabled).toBe(true);
  });

  it('refuses a weak admin password everywhere', () => {
    expect(() => loadConfig({ ADMIN_PASSWORD: 'short' })).toThrow(/at least 8/);
  });

  it('defaults the store to sqlite in production, memory in development', () => {
    expect(loadConfig(production({ AUTH_DISABLED: 'true' })).store.driver).toBe('sqlite');
    expect(loadConfig({}).store.driver).toBe('memory');
  });

  it('does not trust proxy headers unless told to', () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(loadConfig({ TRUST_PROXY: 'loopback' }).trustProxy).toBe('loopback');
  });
});
