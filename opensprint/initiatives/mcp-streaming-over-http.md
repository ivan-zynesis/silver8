---
id: mcp-streaming-over-http
status: completed
created: 2026-05-05
completed: 2026-05-05
parent: market-data-hub
---

## Description

Restore the protocol-native streaming flow that DEC-013 + DEC-014 originally committed: an MCP agent connecting over HTTP can `resources/subscribe` to a topic and receive `notifications/resources/updated` continuously over the SSE channel of its session's transport.

The current HTTP implementation runs in stateless mode (`sessionIdGenerator: undefined`, fresh `McpServer` + transport per request) — a fix-commit-level workaround landed under df290b4 to escape the SDK's "Already connected to a transport" error when a singleton server was shared across requests. The workaround keeps `tools/call` working but advertises `resources: { subscribe: false }` and cannot push notifications. This initiative replaces it with stateful sessions: each session owns its own server + transport pair, the SDK's session-id mechanism (`Mcp-Session-Id` header) routes follow-up requests to their session, and `resources/subscribe` is re-enabled.

For an LLM agent (Claude Desktop via mcp-remote, MCP Inspector, the official SDK), the user-visible result is: discover topics via `resources/list` or `list_topics`, subscribe with `resources/subscribe`, receive a stream of book updates over the same MCP transport — no protocol switch, no fallback to the WS gateway.

## Driver Specs

- DS-MCP — `resources/subscribe` is the protocol-native streaming primitive; the hub commits to honoring it.
- DS-LLM-USABILITY — agents must discover and stream first-try via the canonical MCP path.
- DS-BRIEF — MCP server is a first-class deliverable; HTTP+SSE is the headline transport.

No new driver-specs.

## ADRs

- DEC-035 — Stateful HTTP Sessions for MCP *(new)*

Existing ADRs that remain load-bearing:

- DEC-013 — MCP Streaming via `resources/subscribe` — fully restored after this initiative.
- DEC-014 — MCP Dual Transport (HTTP+SSE primary, stdio supported) — HTTP keeps being primary; stdio path unchanged.
- DEC-019 — Graceful Drain via Rebalance Hint — drain path now iterates the session map.
- DEC-022 — Status Surface — `/status.consumers.mcp` becomes session-aware.
- DEC-027 — Demand-Driven Upstream Lifecycle — bus subscriptions a session creates still drive upstream demand the same way the WS gateway's do.

## Milestones

- [x] **mcp-stateful-http-streaming** *(archived: openspec/changes/archive/2026-05-05-mcp-stateful-http-streaming)*: Replace the stateless per-request HTTP MCP path in `apps/hub/src/http/mcp.controller.ts` with a stateful session map. Add `createSessionServer()` factory on `McpServerService` that builds a per-session `McpServer` with `resources: { subscribe: true }` and wires bus subscriptions for `notifications/resources/updated`. Session lifecycle: created on `initialize` without an `Mcp-Session-Id` header; reused on every subsequent request matching the header; reaped on transport close OR after `MCP_SESSION_IDLE_MS` (default 300_000) of inactivity. SIGTERM drain (DEC-019) iterates sessions, broadcasts `notifications/silver8/rebalance`, force-closes after deadline. `/status.consumers.mcp` reflects live session count; per-topic `consumerCount` aggregates correctly across MCP sessions and WS gateway consumers (DS-OPERATOR-USABILITY — dashboard already exposes the column). Stateless `createPerRequestServer()` and the matching controller branch are deleted. New integration test (test 5 in `apps/integration-tests/src/lifecycle.test.ts`) — HTTP MCP client subscribes to `market://coinbase/book/BTC-USD`, hub publishes a book update, client receives `notifications/resources/updated`. Runs under both bringup modes (DEC-029 docker, DEC-034 process). Smoke verified locally with `mcp-remote → Claude Desktop` end-to-end.

## Notes

- **The "Already connected to a transport" bug from df290b4 doesn't recur** because stateful sessions hold the SDK's contract cleanly: one `McpServer` per session, `connect()` exactly once at session birth, `transport.handleRequest()` for every subsequent request. The earlier bug came from sharing a singleton `McpServer` across requests; here, every session owns its own.
- **Session is connection-state, not LLM memory.** Sessions track "this client currently has these subscriptions open" — analogous to the WS gateway's per-connection registry entries. They are not related to Claude's context window or any client-side memory; the LLM's conversation history stays entirely client-side.
- **No concurrent-session cap in monolith mode.** One operator, demo scope, infinite is fine. A future split-tier deployment (`MODE=gateway` with `CoreNetworkModule`) would set a cap when memory × replica count starts mattering. Out of scope for v1.
- **5-minute idle TTL** matches DEC-027's upstream-socket idle posture — operator's mental model stays "5 min of nothing → cleanup" regardless of which surface.
- Initiative is small by design: 1 ADR, 0 driver-specs, 1 milestone. Touches only `apps/hub/src/http/mcp.controller.ts`, `packages/mcp-server/src/mcp-server.service.ts`, the integration test file, and the `/status` builder. Seam interfaces unchanged.
