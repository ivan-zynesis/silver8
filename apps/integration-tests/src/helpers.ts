import { execFile, execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const COMPOSE_FILE = resolve(REPO_ROOT, 'docker-compose.integration.yml');

const HUB_HTTP = 'http://127.0.0.1:3000';
const HUB_WS = 'ws://127.0.0.1:3001';
const MOCK_CONTROL = 'http://127.0.0.1:8766';

// === Bringup mode resolution (DEC-034) ===========================================
//
// The integration suite supports two bringup modes:
//   - `docker`  — docker-compose stack (DEC-029); production-shape, slow.
//   - `process` — native Node child processes; CI-fast, no Docker dependency.
//
// Selection precedence:
//   1. `INTEGRATION_BRINGUP=docker|process` (explicit).
//   2. `INTEGRATION_DOCKER=1` legacy alias → `docker`.
//   3. `CI` env truthy → `process` (auto-default in CI environments).
//   4. Otherwise → unset, suite skips with a clear message.

export type BringupMode = 'docker' | 'process';

export function resolveBringup(): BringupMode | null {
  const explicit = process.env.INTEGRATION_BRINGUP;
  if (explicit === 'docker' || explicit === 'process') return explicit;
  if (process.env.INTEGRATION_DOCKER === '1') return 'docker';
  if (process.env.CI) return 'process';
  return null;
}

/**
 * True if the resolved bringup mode is usable on this machine.
 * For `docker`: also verifies `docker compose version` and `docker info` exit 0.
 * For `process`: verifies the required `dist/main.js` artifacts exist.
 */
export function bringupAvailable(): boolean {
  const mode = resolveBringup();
  if (!mode) return false;
  if (mode === 'docker') {
    try {
      execSync('docker compose version', { stdio: 'ignore' });
      execSync('docker info', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
  // process mode
  return existsSync(MOCK_DIST) && existsSync(HUB_DIST);
}

export async function stackUp(): Promise<void> {
  const mode = resolveBringup();
  if (mode === 'docker') return dockerComposeUp();
  if (mode === 'process') return processUp();
  throw new Error('no bringup mode resolved; this should be guarded by bringupAvailable()');
}

export async function stackDown(): Promise<void> {
  const mode = resolveBringup();
  if (mode === 'docker') return dockerComposeDown();
  if (mode === 'process') return processDown();
  // No mode resolved → nothing to tear down.
}

// === Docker bringup (DEC-029) ====================================================

async function dockerComposeUp(): Promise<void> {
  const skipBuild = process.env.SKIP_DOCKER_BUILD === '1';
  // `up -d` plus `--wait` blocks until services are healthy (per healthchecks
  // declared in the compose file).
  await runQuiet(['compose', '-f', COMPOSE_FILE, 'up', '-d', '--wait', ...(skipBuild ? [] : ['--build'])]);
}

async function dockerComposeDown(): Promise<void> {
  await runQuiet(['compose', '-f', COMPOSE_FILE, 'down', '-v', '--timeout', '5']);
}

// === Process bringup (DEC-034) ===================================================

const MOCK_DIST = resolve(REPO_ROOT, 'apps/coinbase-mock/dist/main.js');
const HUB_DIST = resolve(REPO_ROOT, 'apps/hub/dist/main.js');

interface ChildState {
  proc: ChildProcess;
  /** Last ~80 lines of combined stdio, kept for surface-on-failure. */
  tail: string[];
}

let mock: ChildState | null = null;
let hub: ChildState | null = null;

async function processUp(): Promise<void> {
  if (!existsSync(MOCK_DIST)) {
    throw new Error(
      `coinbase-mock not built (${MOCK_DIST}); run \`pnpm -r build\` first`,
    );
  }
  if (!existsSync(HUB_DIST)) {
    throw new Error(
      `hub not built (${HUB_DIST}); run \`pnpm -r build\` first`,
    );
  }

  // Start mock first; hub depends on it.
  mock = spawnChild(MOCK_DIST, {
    MOCK_WS_PORT: '8765',
    MOCK_CONTROL_PORT: '8766',
    MOCK_LOOP: 'true',
    MOCK_RATE_HZ: '20',
  });
  await waitForHttp200(`${MOCK_CONTROL}/control/state`, 'coinbase-mock', mock, 10_000);

  hub = spawnChild(HUB_DIST, {
    MODE: 'monolith',
    HTTP_PORT: '3000',
    WS_PORT: '3001',
    MCP_TRANSPORT: 'http',
    LOG_LEVEL: 'warn',
    INGESTION_LIFECYCLE: 'demand_driven',
    INGESTION_SOCKET_IDLE_MS: '2000',
    COINBASE_WS_URL: 'ws://127.0.0.1:8765',
    DRAIN_DEADLINE_MS: '5000',
  });
  await waitForHttp200(`${HUB_HTTP}/healthz`, 'hub', hub, 30_000);
}

async function processDown(): Promise<void> {
  await Promise.all([killChild(hub), killChild(mock)]);
  hub = null;
  mock = null;
}

function spawnChild(jsPath: string, env: Record<string, string>): ChildState {
  // `process.execPath` is the same Node binary the test runner is using —
  // avoids picking up a different node from PATH when nvm versions diverge.
  const proc = spawn(process.execPath, [jsPath], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tail: string[] = [];
  const onChunk = (chunk: Buffer) => {
    tail.push(chunk.toString('utf8'));
    if (tail.length > 80) tail.splice(0, tail.length - 80);
  };
  proc.stdout?.on('data', onChunk);
  proc.stderr?.on('data', onChunk);
  return { proc, tail };
}

function killChild(child: ChildState | null): Promise<void> {
  if (!child) return Promise.resolve();
  if (child.proc.exitCode !== null || child.proc.killed) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    child.proc.once('exit', done);
    try { child.proc.kill('SIGTERM'); } catch { done(); return; }
    setTimeout(() => {
      if (!settled) {
        try { child.proc.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }, 3_000);
  });
}

async function waitForHttp200(
  url: string,
  name: string,
  child: ChildState,
  deadlineMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (child.proc.exitCode !== null) {
      throw new Error(
        `${name} exited (${child.proc.exitCode}) before becoming healthy:\n` +
          tailOf(child),
      );
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${name} did not become healthy at ${url} within ${deadlineMs}ms\n${tailOf(child)}`);
}

function tailOf(child: ChildState): string {
  return child.tail.join('').split('\n').slice(-20).join('\n');
}

// === Common helpers ==============================================================

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

// `ws` package rather than the Node global WebSocket: GitHub Actions runners
// read .nvmrc which currently pins Node 20, and Node 20 does not have a stable
// global WebSocket (it shipped experimental in 21, stable in 22). The `ws`
// library implements the W3C WebSocket API so addEventListener / .data work
// the same way the global would.
import { WebSocket } from 'ws';

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

    ws.addEventListener('message', (e: { data: unknown }) => {
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

// === MCP HTTP helpers (DEC-035) ==================================================
//
// Stateful Streamable HTTP transport: POST initialize → server returns
// Mcp-Session-Id header. Subsequent POSTs echo that header. Server-initiated
// notifications (e.g. resources/updated) flow over a GET-opened SSE stream.

const MCP_URL = `${HUB_HTTP}/mcp`;

export interface McpInitResult {
  sessionId: string;
}

export async function mcpInitialize(): Promise<McpInitResult> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'silver8-integration-test', version: '0.0.0' },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`mcp initialize failed: ${res.status} ${await res.text()}`);
  }
  const sessionId = res.headers.get('mcp-session-id');
  if (!sessionId) {
    throw new Error('mcp initialize response missing Mcp-Session-Id header');
  }
  // Drain the body so the connection releases.
  await res.text().catch(() => undefined);
  return { sessionId };
}

export async function mcpPost(sessionId: string, payload: unknown): Promise<Response> {
  return fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'mcp-session-id': sessionId,
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(payload),
  });
}

export async function mcpDelete(sessionId: string): Promise<void> {
  await fetch(MCP_URL, {
    method: 'DELETE',
    headers: { 'mcp-session-id': sessionId },
  }).catch(() => undefined);
}

export interface SseMessage {
  event: string;
  data: string;
  parsed?: unknown;
}

export interface SseStream {
  next(predicate: (m: SseMessage) => boolean, timeoutMs?: number): Promise<SseMessage>;
  close(): void;
}

export async function mcpOpenSseStream(sessionId: string): Promise<SseStream> {
  const ctrl = new AbortController();
  const res = await fetch(MCP_URL, {
    method: 'GET',
    headers: {
      'mcp-session-id': sessionId,
      accept: 'text/event-stream',
    },
    signal: ctrl.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`mcp GET (SSE) failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const buffer: SseMessage[] = [];
  const waiters: Array<{
    resolve: (m: SseMessage) => void;
    reject: (e: Error) => void;
    predicate: (m: SseMessage) => boolean;
    timer: NodeJS.Timeout;
  }> = [];
  let acc = '';

  const dispatch = (msg: SseMessage) => {
    for (let i = 0; i < waiters.length; i++) {
      if (waiters[i].predicate(msg)) {
        const w = waiters.splice(i, 1)[0];
        clearTimeout(w.timer);
        w.resolve(msg);
        return;
      }
    }
    buffer.push(msg);
  };

  const pump = async () => {
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = acc.indexOf('\n\n')) !== -1) {
          const raw = acc.slice(0, idx);
          acc = acc.slice(idx + 2);
          if (raw.trim()) dispatch(parseSseEvent(raw));
        }
      }
    } catch {
      // stream closed or aborted
    }
  };
  void pump();

  return {
    next(predicate, timeoutMs = 10_000) {
      const idx = buffer.findIndex(predicate);
      if (idx >= 0) return Promise.resolve(buffer.splice(idx, 1)[0]);
      return new Promise<SseMessage>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`SSE next() timeout after ${timeoutMs}ms`)),
          timeoutMs,
        );
        waiters.push({ resolve, reject, predicate, timer });
      });
    },
    close() {
      try { ctrl.abort(); } catch { /* ignore */ }
      while (waiters.length) {
        const w = waiters.shift()!;
        clearTimeout(w.timer);
        w.reject(new Error('SSE stream closed'));
      }
    },
  };
}

function parseSseEvent(raw: string): SseMessage {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  const data = dataLines.join('\n');
  let parsed: unknown;
  try { parsed = JSON.parse(data); } catch { /* not JSON */ }
  return { event, data, parsed };
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
