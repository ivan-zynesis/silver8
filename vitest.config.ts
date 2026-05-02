import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const r = (p: string) => resolve(__dirname, p);

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages to their TS source so tests run without a build step.
      '@silver8/core': r('packages/core/src/index.ts'),
      '@silver8/core-memory': r('packages/core-memory/src/index.ts'),
      '@silver8/observability': r('packages/observability/src/index.ts'),
      '@silver8/ingestion': r('packages/ingestion/src/index.ts'),
      '@silver8/gateway-ws': r('packages/gateway-ws/src/index.ts'),
      '@silver8/mcp-server': r('packages/mcp-server/src/index.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
