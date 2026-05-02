export * from './types.js';
export * from './uri.js';
export * from './messages.js';
export * from './bus.js';
export * from './store.js';
export * from './registry.js';
export * from './errors.js';
export * from './readiness.js';

/**
 * Injection tokens for NestJS. Components depend on these symbols, never on
 * concrete implementations — that's the literal demonstration of DEC-004.
 */
export const BUS = Symbol.for('silver8.Bus');
export const ORDER_BOOK_STORE = Symbol.for('silver8.OrderBookStore');
export const REGISTRY = Symbol.for('silver8.Registry');
export const LOGGER = Symbol.for('silver8.Logger');
