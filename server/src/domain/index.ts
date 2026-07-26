// ---------------------------------------------------------------------------
// the domain model, in one import
//
// `import type { HostView, HealthReport } from '../../domain/index.ts';`
//
// Types only — nothing in here runs, except the id helpers in `common.ts`.
// ---------------------------------------------------------------------------

export * from './common.ts';
export * from './inventory.ts';
export * from './health.ts';
export * from './agents.ts';
export * from './alerts.ts';
export * from './topology.ts';
