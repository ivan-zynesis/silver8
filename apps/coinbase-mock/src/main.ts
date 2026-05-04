import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadFixture } from './fixture.js';
import { MockServer } from './server.js';

const ENV = z.object({
  MOCK_WS_PORT: z.coerce.number().int().positive().default(8765),
  MOCK_CONTROL_PORT: z.coerce.number().int().positive().default(8766),
  /** Absolute or package-relative path to a JSONL fixture. */
  MOCK_FIXTURE: z.string().default('fixtures/btc-usd-baseline.jsonl'),
  MOCK_LOOP: z
    .union([z.string(), z.boolean()])
    .transform((v) => v === true || v === 'true' || v === '1')
    .default(true),
  MOCK_RATE_HZ: z.coerce.number().nonnegative().default(10),
});

/**
 * Resolve a relative fixture path the same way regardless of where the binary
 * is invoked from: try cwd first (developer convenience), then the package's
 * own directory (the shipped fixture lives there).
 */
function resolveFixturePath(specified: string): string {
  if (isAbsolute(specified)) return specified;
  const fromCwd = resolve(process.cwd(), specified);
  if (existsSync(fromCwd)) return fromCwd;
  // dist/main.js lives in apps/coinbase-mock/dist; fixtures/ is one up.
  const here = dirname(fileURLToPath(import.meta.url));
  const fromPkg = resolve(here, '..', specified);
  if (existsSync(fromPkg)) return fromPkg;
  // src/main.ts (when running via tsx): package root is the parent of src/.
  const fromSrc = resolve(here, '..', '..', specified);
  if (existsSync(fromSrc)) return fromSrc;
  // Fall back to cwd-resolved path; loadFixture will throw a clear error.
  return fromCwd;
}

async function main(): Promise<void> {
  const env = ENV.parse(process.env);
  const fixturePath = resolveFixturePath(env.MOCK_FIXTURE);
  const fixture = loadFixture(fixturePath);

  const server = new MockServer({
    fixture,
    wsPort: env.MOCK_WS_PORT,
    controlPort: env.MOCK_CONTROL_PORT,
    loop: env.MOCK_LOOP,
    rateHz: env.MOCK_RATE_HZ,
  });

  await server.start();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    msg: 'coinbase-mock ready',
    wsPort: env.MOCK_WS_PORT,
    controlPort: env.MOCK_CONTROL_PORT,
    fixture: fixturePath,
    envelopes: fixture.length,
    rateHz: env.MOCK_RATE_HZ,
    loop: env.MOCK_LOOP,
  }));

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('coinbase-mock fatal:', err);
  process.exit(1);
});
