---
id: DS-MCP
name: Model Context Protocol
type: technical
status: active
created: 2026-05-02
---

## Summary

The Model Context Protocol (MCP) is the standard surface for exposing tools, resources, and prompts to LLM agents. The hub must speak MCP as a first-class interface so AI agents can use it directly. The protocol's specifics constrain our MCP-layer design.

## Key Capabilities

- **Tools**: request/response operations with typed argument schemas. Used for actions like "get current top of book." Naming, argument types, and descriptions are LLM-facing; quality is load-bearing for usability.
- **Resources**: addressable content with URI-style identifiers. Clients can read resource content and (with `resources/subscribe`) be notified of updates via `notifications/resources/updated`. This is the protocol-native streaming primitive.
- **Prompts**: parameterized prompt templates. Out of scope for this hub.

## Transports

- **stdio**: process-spawned, parent-child pipe. Convenient for local agent installations (Claude Desktop, etc.).
- **HTTP+SSE**: network-addressable, agent connects to a URL. Convenient for shared/server-side deployments.
- The official `@modelcontextprotocol/sdk` is transport-agnostic at the server-logic level: same server bound to different transports.

## Constraints

- Tool argument schemas must be expressible as JSON Schema; Zod is the idiomatic TypeScript way to author these.
- Resource URIs are arbitrary strings (no requirement to be web-real); we choose our own scheme.
- `resources/subscribe` semantics: server emits update notifications; clients re-read resource content (or are pushed content depending on implementation choice).

## How To Apply

- MCP is the AI-native surface. Tool names, descriptions, and argument schemas are written for an LLM consumer first, an engineer second.
- Streaming uses `resources/subscribe` rather than tool polling — this is the protocol-native and most agent-friendly approach.
- Both transports are supported (HTTP+SSE primary for production-like deployment; stdio for local CLI testing) — the SDK makes dual-transport essentially free.
