---
id: DS-BRIEF
name: Silver 8 Take-Home Brief
type: product
status: active
source: problem-statement.md
created: 2026-05-02
---

## Summary

Build a real-time crypto market data hub that ingests from Coinbase and distributes to multiple consumers through a subscribable pub/sub interface. The hub must be natively AI-interfaceable via an MCP server. Single venue (Coinbase) in scope; architecture must make adding venues simple.

## Constraints

- **Deadline**: 2-week duration (issued 2026-04-20).
- **Single-deployable**: package as single-container or single-binary.
- **No database required**: in-memory state is acceptable; what is lost on restart must be explicit.
- **Language**: pick for fast development; Python or TypeScript explicitly suggested.
- **AI assistant use**: expected and encouraged; transparency required on how leveraged.

## Required Deliverables

- Source repo (GitHub link preferred, zip acceptable).
- MCP server with clear setup instructions; can be deployed locally.
- Context documentation markdown files in `/docs`.
- One-page architecture write-up covering design choices and trade-offs.
- 10-minute walkthrough of the system and reasoning.

## Functional Requirements

1. **Coinbase Ingestion**: maintain WebSocket connections; lifecycle management; respect Coinbase subscription/message limits; document subscribed channels.
2. **Subscribable Topics**: clear consistent naming; multiple consumers per topic; documented backpressure strategy; dynamic subscribe/unsubscribe.
3. **Connection Registry**: track upstream + downstream; reference-count topic subscriptions so upstream subs reflect actual downstream demand; clean teardown on disconnect; status surface (active connections, uptime, message rates).
4. **MCP Server**: list topics, describe topic schema/example payload, subscribe to topic and stream messages, query current snapshot (top of book, last trade, best bid/ask). Tool names/descriptions/argument schemas written for LLM consumer: action-verb names, strongly typed arguments, short descriptions explaining when to use the tool.
5. **Documents That Teach AI Context**: first-class deliverable. Purpose/scope/non-goals up front; every topic's name/schema/cadence/example payload; worked examples; failure modes spelled out (stale topic, dropped connection, unknown symbol).

## Non-Functional Requirements

- Production-shaped code: tests, structured logs, configuration files, Dockerfile, README.

## Evaluation Criteria

- **Architecture judgement**: clear separation between ingestion, registry, pub/sub, MCP layers; scalability, maintainability, reliability; structured to support future AI usage.
- **Correctness under stress**: reconnections and stale states.
- **LLM usability**: how far a fresh agent gets given only the docs and MCP tool list.
- **Code quality and ergonomics**: readability, maintainability, ease for another engineer to extend.

## How To Apply

This is the foundational driver: every architectural decision should be traceable back to one of these constraints or evaluation criteria. When trading off scope, prefer cuts that preserve LLM usability and architecture clarity over feature breadth.
