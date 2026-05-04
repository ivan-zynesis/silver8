import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('env loader', () => {
  it('applies defaults when nothing is set', () => {
    const env = loadEnv({});
    expect(env.MODE).toBe('monolith');
    expect(env.HTTP_PORT).toBe(3000);
    expect(env.MCP_TRANSPORT).toBe('http');
    expect(env.GATEWAY_QUEUE_DEPTH).toBe(1000);
    expect(env.DRAIN_DEADLINE_MS).toBe(30000);
  });

  it('coerces numeric strings', () => {
    const env = loadEnv({ HTTP_PORT: '8080', GATEWAY_QUEUE_DEPTH: '500' });
    expect(env.HTTP_PORT).toBe(8080);
    expect(env.GATEWAY_QUEUE_DEPTH).toBe(500);
  });

  it('rejects invalid MODE', () => {
    expect(() => loadEnv({ MODE: 'standby' })).toThrow(/Invalid environment/);
  });

  it('rejects non-positive HTTP_PORT', () => {
    expect(() => loadEnv({ HTTP_PORT: '0' })).toThrow(/Invalid environment/);
  });

  it('parses LOG_PRETTY as boolean', () => {
    expect(loadEnv({ LOG_PRETTY: '1' }).LOG_PRETTY).toBe(true);
    expect(loadEnv({ LOG_PRETTY: 'true' }).LOG_PRETTY).toBe(true);
    expect(loadEnv({ LOG_PRETTY: '0' }).LOG_PRETTY).toBe(false);
    expect(loadEnv({}).LOG_PRETTY).toBe(false);
  });
});
