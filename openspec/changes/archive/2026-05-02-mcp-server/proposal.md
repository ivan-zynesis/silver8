# MCP Server: tools + resources/subscribe + dual transport

**Initiative:** market-data-hub
**Milestone:** 4/5

## What

Wrap the hub in an MCP server. Five LLM-legible tools cover discovery and snapshot reads. Per-symbol book resources support `resources/subscribe` for streaming updates. Two transports — stdio for local agent integration and Streamable HTTP for network clients — share the same server logic.

## References

- DEC-013 (resources/subscribe), DEC-014 (dual transport), DEC-015 (tool surface)
- DEC-019 (rebalance hint via MCP notifications)
- DEC-022 (status surface parity), DEC-023 (LLM-targeted docs)

## Approach

### Server

Use `McpServer` from `@modelcontextprotocol/sdk` (high-level API). Tools use Zod input schemas with descriptions written for an LLM consumer. Resources use the URI shape `market://<venue>/book/<symbol>`.

### Tools (DEC-015)

| Tool | Args | Returns |
|---|---|---|
| `list_topics` | (none) | array of `{uri, kind, venue, symbol, description}` |
| `describe_topic` | `{uri}` | `{uri, schema, cadence, examplePayload, freshness}` |
| `get_top_of_book` | `{symbol, venue?}` | `TopOfBook` JSON (bid/ask/mid/spread + `stale` flag) |
| `get_book_snapshot` | `{symbol, venue?, depth?}` | `BookView` (top-N bids/asks) |
| `get_hub_status` | (none) | `HubStatus` — same payload as HTTP /status |

Errors are LLM-actionable: `unknown symbol BTC-USDT; available symbols: BTC-USD, ETH-USD, SOL-USD`.

### Resources

For each configured symbol we register a resource at `market://coinbase/book/<symbol>`. Read returns a `BookView` snapshot. Subscribe → server stores the URI in a tracked set; on each Bus update for a subscribed URI, send `notifications/resources/updated`. On unsubscribe, remove from the set.

### Transports

- **stdio**: when `MCP_TRANSPORT=stdio`, connect via `StdioServerTransport` (process pipes). Used for local CLI testing (Claude Desktop, MCP Inspector).
- **streamable-http** (default): mount POST + GET handlers on the Fastify HTTP server. The same `McpServer` instance can be reused; we instantiate a `StreamableHTTPServerTransport` per session. For simplicity v1 uses stateless mode (one transport per request).

### Drain

Implements Drainable. On SIGTERM the MCP server emits a custom notification (`notifications/silver8/rebalance`) — the SDK's notifications system carries it to connected clients via the active transport. Then transports are closed.

## Tests

- Tool input validation (invalid symbol enum, etc.).
- list_topics returns the configured topics.
- get_top_of_book returns the TopOfBook from the store.
- get_hub_status returns same shape as /status (parity check).
- Resources list/read against an in-memory bus.
- Subscribe → bus publish → tracking observed (unit-level; full SDK round-trip is integration territory).
