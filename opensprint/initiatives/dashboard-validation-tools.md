---
id: dashboard-validation-tools
status: active
created: 2026-05-05
parent: market-data-hub
---

## Description

Extend the operator dashboard with two walkthrough-grade validation tools that make the system's behavior visible to a human running the 10-minute demo:

1. **In-app tabs on the book ticker** — operators can subscribe to multiple symbols inside one dashboard window, each tab a separate URI subscription over a single WebSocket connection. This demonstrates the gateway protocol's subscription multiplexing (Scenario A: one WS consumer, N subscriptions). The complementary refcount-across-consumers demo (one symbol, N consumers) remains operator-driven by opening extra browser windows — that's a walkthrough technique, not a built-in feature.

2. **MCP onboarding panel** — copy-paste Claude Desktop config snippets for both stdio and HTTP+SSE transports (DEC-014). The currently-active transport is rendered as a copy-paste-ready snippet driven by `/status.mcp`; the inactive transport is shown informationally ("alternative; requires `MCP_TRANSPORT=<other>` and restart") so the panel stays educational without misleading. To support truthful snippets, `/status` gains a small additive `mcp: { transport, path }` block (DEC-022 evolution, additive only).

Out of scope (remain deferred from the original `hub-dashboard-and-lifecycle` follow-up notes): connection event log, per-consumer detail view, message-rate graph / sparkline.

## Driver Specs

- DS-OPERATOR-USABILITY (primary — both items pull on this)
- DS-BRIEF (10-minute walkthrough is the deadline pressure)
- DS-MCP (onboarding panel surfaces MCP-specific config snippets)

No new driver-specs.

## ADRs

No new ADRs.

Existing ADRs that remain load-bearing for this initiative:

- DEC-014 — MCP Dual Transport (HTTP+SSE primary, stdio supported); both surfaced in the onboarding panel.
- DEC-022 — Status Surface (HTTP `/status` and parity MCP `get_hub_status`); augmented additively with an `mcp: { transport, path }` block.
- DEC-025 — Dashboard as Production-Foundation Surface; this initiative grows it.
- DEC-026 — Dashboard Data Plane (HTTP poll + WS subscribe); unchanged — both the multi-tab tickers and the onboarding panel use existing surfaces.
- DEC-027 — Demand-Driven Upstream Lifecycle; the behavior that operators visually validate.

## Milestones

- [ ] **multi-tab-and-onboarding**: In-app tab UI on the book ticker so a single dashboard window can subscribe to multiple `market://...` URIs over one WS connection, with per-tab BookTicker rendering and tab-level subscribe/unsubscribe (DEC-027 lifecycle visible). MCP onboarding panel shipping Claude Desktop config snippets for both transports, with the active transport (per `/status.mcp.transport`) presented as copy-paste-ready and the inactive transport shown informationally with the env-var instruction. `/status` payload extended with `mcp: { transport, path }`; HTTP `/status` and MCP `get_hub_status` keep payload parity. Tests: dashboard-side rendering checks where feasible; status-builder asserts the `mcp` block; smoke verifies the onboarding panel shows the configured transport and a connecting MCP client succeeds with the rendered snippet.

## Notes

- The "per-window scope of WS connection" decision (each browser tab/window opens its own WS rather than the dashboard pooling subscriptions) is recorded as an implementation note in the opsx change rather than as a separate ADR. Operator-confirmed during exploration: this is implementation detail, not architecture.
- The single-milestone shape is deliberate: the two items are small, share the dashboard surface, and have aligned test/smoke needs. Splitting would just add ceremony.
- Initiative is small by design: 0 ADRs, 0 driver-specs, 1 milestone. Blast radius confined to dashboard UI surface area, one additive `/status` field, and the MCP service exposing transport/path metadata to the status builder. Seams (`Bus`, `OrderBookStore`, `Registry`) unchanged; catalog (DEC-030) unaffected.
