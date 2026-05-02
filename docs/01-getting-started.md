# Getting Started

## 1. Run the hub

### Local (Node)

```bash
pnpm install
pnpm build
pnpm start:monolith        # or: MODE=monolith pnpm --filter @silver8/hub start
```

The hub boots and opens:

| Endpoint | What |
|---|---|
| `http://localhost:3000/healthz` | Liveness — process alive |
| `http://localhost:3000/readyz` | Readiness — true once first Coinbase snapshot lands |
| `http://localhost:3000/metrics` | Prometheus exposition |
| `http://localhost:3000/status` | JSON: uptime, upstream, topics, consumers |
| `http://localhost:3000/mcp` | MCP HTTP+SSE transport (when `MCP_TRANSPORT=http`) |
| `ws://localhost:3001/` | WebSocket gateway |

### Docker

```bash
docker compose up
```

Same ports; environment in `docker-compose.yml`.

## 2. Configuration

Every option has a sensible default; see `apps/hub/src/config/env.ts` for the canonical schema.

| Env | Default | Purpose |
|---|---|---|
| `MODE` | `monolith` | `monolith` \| `ingestion` \| `gateway` (latter two require deferred CoreNetworkModule) |
| `HTTP_PORT` | `3000` | HTTP shell + MCP HTTP transport |
| `WS_PORT` | `3001` | WebSocket gateway |
| `MCP_TRANSPORT` | `http` | `http` (network) or `stdio` (process pipes) |
| `COINBASE_WS_URL` | `wss://advanced-trade-ws.coinbase.com` | Upstream feed |
| `COINBASE_SYMBOLS` | `BTC-USD,ETH-USD,SOL-USD` | Subscribed symbols |
| `GATEWAY_QUEUE_DEPTH` | `1000` | Per-consumer ring buffer size |
| `GATEWAY_OVERFLOW_DISCONNECT_MS` | `5000` | Sustained-overflow disconnect window |
| `DRAIN_DEADLINE_MS` | `30000` | SIGTERM rebalance grace period |
| `LOG_LEVEL` | `info` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` |
| `LOG_PRETTY` | `false` | Human-readable log output |

## 3. Connect via MCP — HTTP+SSE

```bash
# initialize
curl -sS -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-agent","version":"0.1"}}}'

# list tools
curl -sS -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# call a tool
curl -sS -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_top_of_book","arguments":{"symbol":"BTC-USD"}}}'
```

## 4. Connect via MCP — stdio (for local agent installations)

Set `MCP_TRANSPORT=stdio` and have your agent spawn the hub binary. The hub speaks MCP over stdin/stdout. For Claude Desktop, register a server entry that points to the hub's launch command.

## 5. Connect via WebSocket

```bash
# any WS client, e.g. wscat
wscat -c ws://localhost:3001/

# subscribe
> {"op":"subscribe","resource":"market://coinbase/book/BTC-USD"}
< {"event":"ack","op":"subscribe","resource":"market://coinbase/book/BTC-USD"}
< {"event":"snapshot","resource":"market://coinbase/book/BTC-USD","data":{...},"sequence":12345,"stale":false}
< {"event":"update","resource":"market://coinbase/book/BTC-USD","data":{...},"sequence":12346}
```

## 6. Check it's working

```bash
curl http://localhost:3000/status | jq
```

You should see:
- `upstream.coinbase.status: "connected"`
- `topics[]` populated with `stale: false` once the first snapshot arrives.
- `consumers.ws / mcp` counts reflect your active connections.

If `readyz` stays at `503`, the upstream feed isn't delivering snapshots. See [`06-failure-modes.md`](06-failure-modes.md).
