import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/harness.ts';

describe('app assembly', () => {
  it('answers the liveness probe without touching the store', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('reports the store on the readiness probe', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, store: 'memory' });
  });

  it('does not leak x-powered-by', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get('/healthz');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('answers unknown /api paths with a json 404, not the spa', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });
});
