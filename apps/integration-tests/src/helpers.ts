import { execFile, execSync } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const COMPOSE_FILE = resolve(REPO_ROOT, 'docker-compose.integration.yml');

const HUB_HTTP = 'http://127.0.0.1:3000';
const HUB_WS = 'ws://127.0.0.1:3001';
const MOCK_CONTROL = 'http://127.0.0.1:8766';

/**
 * Whether to actually run the docker-driven integration suite.
 *
 * The compose-driven tests require a working Docker daemon and a few minutes
 * to build images on first run. Default behavior is **skip** — the operator
 * opts in by setting `INTEGRATION_DOCKER=1`, which keeps `pnpm test` fast and
 * non-flaky in environments without Docker (CI sandboxes, freshly-cloned
 * machines without the daemon running).
 *
 * The suite ALSO checks that `docker compose version` returns 0 and that
 * `docker info` confirms the daemon is alive, so a misconfigured opt-in
 * fails fast with a useful message rather than during composeUp.
 */
export function dockerAvailable(): boolean {
  if (process.env.INTEGRATION_DOCKER !== '1') return false;
  try {
    execSync('docker compose version', { stdio: 'ignore' });
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function composeUp(): Promise<void> {
  const skipBuild = process.env.SKIP_DOCKER_BUILD === '1';
  // `up -d` plus `--wait` blocks until services are healthy (per healthchecks
  // declared in the compose file).
  await runQuiet(['compose', '-f', COMPOSE_FILE, 'up', '-d', '--wait', ...(skipBuild ? [] : ['--build'])]);
}

export async function composeDown(): Promise<void> {
  await runQuiet(['compose', '-f', COMPOSE_FILE, 'down', '-v', '--timeout', '5']);
}

export async function waitFor<T>(
  fn: () => Promise<T | null>,
  deadlineMs = 10_000,
  intervalMs = 100,
): Promise<T> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const value = await fn();
    if (value !== null) return value;
    if (Date.now() - start > deadlineMs) {
      throw new Error(`waitFor timed out after ${deadlineMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export interface HubStatus {
  mode: string;
  catalog: Array<{
    uri: string;
    kind: 'book';
    venue: string;
    symbol: string;
    description: string;
  }>;
  active: Array<{
    uri: string;
    consumerCount: number;
    stale: boolean;
    sequence: number | null;
    lastTimestamp: string | null;
  }>;
  consumers: { ws: number; mcp: number; totalSubscriptions: number };
  upstream: {
    coinbase?: {
      status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting' | 'idle';
      subscribedChannels: string[];
      reconnectAttempts: number;
      lifecycle: 'demand_driven' | 'eager';
    };
  };
}

export async function fetchStatus(): Promise<HubStatus> {
  const res = await fetch(`${HUB_HTTP}/status`);
  if (!res.ok) throw new Error(`/status returned ${res.status}`);
  return (await res.json()) as HubStatus;
}

export async function injectMockGap(): Promise<void> {
  const res = await fetch(`${MOCK_CONTROL}/control/inject-gap`, { method: 'POST' });
  if (!res.ok) throw new Error(`/control/inject-gap returned ${res.status}`);
}

export async function disconnectMockClients(): Promise<void> {
  const res = await fetch(`${MOCK_CONTROL}/control/disconnect`, { method: 'POST' });
  if (!res.ok) throw new Error(`/control/disconnect returned ${res.status}`);
}

// Native WebSocket comes from the test runner (Node 20+).
declare const WebSocket: typeof globalThis.WebSocket;

export interface WsClient {
  ws: WebSocket;
  send(obj: unknown): void;
  recv<T = unknown>(timeoutMs?: number): Promise<T>;
  close(): void;
}

export function wsConnect(url: string = `${HUB_WS}/`): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const buffered: unknown[] = [];
    const waiters: Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];
    let opened = false;

    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(String(e.data));
      const w = waiters.shift();
      if (w) { clearTimeout(w.timer); w.resolve(msg); } else { buffered.push(msg); }
    });
    ws.addEventListener('error', () => {
      while (waiters.length) {
        const w = waiters.shift()!;
        clearTimeout(w.timer);
        w.reject(new Error('ws error'));
      }
      if (!opened) reject(new Error('ws connect failed'));
    });
    ws.addEventListener('open', () => {
      opened = true;
      resolve({
        ws,
        send: (obj) => ws.send(JSON.stringify(obj)),
        close: () => ws.close(),
        recv: <T,>(timeoutMs = 3000) => {
          if (buffered.length) return Promise.resolve(buffered.shift() as T);
          return new Promise<T>((res, rej) => {
            const timer = setTimeout(() => rej(new Error(`recv timeout after ${timeoutMs}ms`)), timeoutMs);
            waiters.push({ resolve: (v) => res(v as T), reject: rej, timer });
          });
        },
      });
    });
  });
}

export async function recvUntil<T>(
  c: WsClient,
  pred: (msg: unknown) => msg is T,
  max = 50,
  perRecvTimeoutMs = 3000,
): Promise<T> {
  for (let i = 0; i < max; i++) {
    const m = await c.recv(perRecvTimeoutMs);
    if (pred(m)) return m;
  }
  throw new Error(`recvUntil exhausted after ${max} messages`);
}

function runQuiet(args: string[]): Promise<void> {
  // Use execFile (buffered) instead of spawn — Vitest workers' stdio handling
  // doesn't always cooperate with long-running spawned children that 'inherit'
  // (deadlock on full output buffers). execFile with maxBuffer ensures the
  // child's output is fully consumed before resolution.
  return new Promise((res, rej) => {
    const child = execFile(
      'docker',
      args,
      { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) {
          const trail = String(stderr ?? '').split('\n').slice(-20).join('\n');
          rej(new Error(`docker ${args.join(' ')} failed: ${err.message}\n${trail}`));
        } else {
          res();
        }
      },
    );
    child.on('error', rej);
  });
}
