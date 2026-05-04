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
    // No explicit `include`: vitest's default (`**/*.{test,spec}.?(c|m)[jt]s?(x)`)
    // works correctly regardless of CWD. From the repo root it picks up tests in
    // every package; turbo runs `vitest run` from each package's directory and
    // the default pattern then matches only that package's files. The repo-wide
    // workspace aliases above still apply because vitest walks up to find the
    // nearest config.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
