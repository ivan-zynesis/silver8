---
id: DS-LLM-USABILITY
name: LLM as First-Class Consumer
type: quality
status: active
created: 2026-05-02
---

## Summary

A fresh LLM agent, handed only the `/docs` directory and the MCP tool list (no source code, no human guidance), must be able to drive the hub correctly on first attempt. This is an unusual quality attribute — not "nice to have," but a load-bearing constraint that shapes design across the system.

## What It Drives

- **Tool naming**: action-verb names that read naturally (`get_top_of_book`, not `gtob` or `marketDataQuery`). Names communicate what the tool does and roughly when to use it.
- **Argument schemas**: strongly typed; enums where the value space is closed (symbols, channels); avoid free-form strings where alternatives exist. Zod-driven so schemas flow into MCP tool definitions automatically.
- **Tool descriptions**: explain *when* to use the tool, not just what it does. Include example invocations where helpful.
- **Error messages**: actionable for an agent. `unknown symbol BTC-USDT; available symbols: BTC-USD, ETH-USD, SOL-USD` beats `400 Bad Request`. The agent should be able to recover from the error string alone.
- **Resource URIs**: human-and-LLM legible (`market://coinbase/book/BTC-USD`).
- **Documentation structure** (`/docs`):
  - Purpose, scope, non-goals stated up front in plain language.
  - Every topic's name, schema, update cadence, real example payload.
  - Worked examples: "Agent wants the current mid for BTC-USD: it should call X with Y and expect Z."
  - Failure modes spelled out: what does the agent see when a topic is stale, a connection drops, a symbol is unknown.

## How To Apply

- Treat `/docs` and MCP tool definitions as primary interfaces — review them with the same care as any user-facing API.
- When making design tradeoffs, prefer the option that an LLM is more likely to use correctly first try, even at minor cost to engineer ergonomics.
- This is also an explicit evaluation criterion in DS-BRIEF: "how far a fresh agent gets when handed only your documents and MCP tool list."
