/**
 * Readiness reporting contract. Components signal their readiness state via this
 * interface; the hub's aggregator uses it to gate /readyz. The contract lives in
 * @silver8/core so any component (ingestion, gateway, mcp) can depend on it
 * without depending on apps/hub.
 */
export interface ReadinessReporter {
  /** Register a component (defaults to not-ready). Idempotent. */
  declare(component: string): void;
  /** Update a component's ready state. */
  set(component: string, ready: boolean): void;
}

export const READINESS_REPORTER = Symbol.for('silver8.ReadinessReporter');
