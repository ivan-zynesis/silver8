# Catalog as Adapter Capability

**Initiative:** topic-catalog
**Milestone:** 1/1

## What

Make topic catalog a first-class capability of the venue adapter, distinct from active/warm topics. Resolve the chicken-and-egg the demand-driven lifecycle (DEC-027) created: with no eager pre-subscription, a cold hub has no order books → `/status.topics` is empty → dashboard offers nothing to subscribe → no demand ever forms.

After this change:

- A fresh LLM agent calling `list_topics()` against a cold hub gets a complete answer.
- The dashboard's symbol selector shows what is askable, not what is currently warm.
- WS subscribes to catalog-unknown URIs are rejected with the helpful-error pattern (`unknown topic ...; available: ...`).
- `/readyz` is true only after the venue adapter's catalog is populated.

## References

- DEC-030 — Topic Catalog as VenueAdapter Capability (primary)
- DEC-031 — Catalog Source: Hardcoded Common Pairs for v1; REST Discovery Deferred
- DEC-032 — `/status` and `list_topics` Catalog vs Active Split
- DEC-033 — Adapter Catalog Readiness Gates `/readyz`
- DEC-007 (venue adapter pattern — formalized minimally as part of this change)
- DEC-015 (MCP tool surface — `list_topics` / `describe_topic` ground in catalog)
- DEC-022 (status surface — payload split into `catalog` + `active`)
- DEC-027 (demand-driven lifecycle — the mechanism that exposed the gap)

## Approach

### Minimal `VenueAdapter` interface in core/

DEC-007's adapter pattern was concrete-only in v1 (CoinbaseAdapter is a NestJS-injected class, not an interface implementer). This change introduces the minimum interface needed for the catalog seam — just the catalog members. Other adapter responsibilities (start/stop, subscribeChannel, etc.) stay concrete for now; formalizing them is a separate cleanup that isn't load-bearing here.

```typescript
// packages/core/src/types.ts (new)
export interface TopicDescriptor {
  uri: ResourceURI;
  kind: ChannelKind;
  venue: Venue;
  symbol: Symbol;
  description: string;
}

export interface VenueAdapterCatalog {
  readonly venue: Venue;
  listCatalog(): readonly TopicDescriptor[];
  describeCatalogEntry(uri: ResourceURI): TopicDescriptor | undefined;
  readonly catalogReady: boolean;
}
```

The existing `TopicDescriptor` in `mcp-server/src/tools.ts` is moved to core; mcp-server consumes the core type.

### Hardcoded catalog on CoinbaseAdapter (DEC-031)

Replace env-var-driven `CoinbaseAdapterConfig.symbols` with a hardcoded constant in the adapter source:

```typescript
// packages/ingestion/src/coinbase/coinbase-catalog.ts (new)
export const COINBASE_DEFAULT_SYMBOLS: readonly Symbol[] = [
  'BTC-USD', 'ETH-USD', 'SOL-USD', 'AVAX-USD',
  'DOGE-USD', 'XRP-USD', 'LINK-USD', 'MATIC-USD',
] as const;
```

Bootstrap reads from this constant rather than `process.env.COINBASE_SYMBOLS`. The DI seam stays — tests inject their own symbol lists via `CoinbaseAdapterConfig`. The env var is removed from production config; tests that previously relied on it switch to constructor injection.

`CoinbaseAdapter` exposes:

- `listCatalog()` returning a `TopicDescriptor[]` derived from configured symbols.
- `describeCatalogEntry(uri)` for per-URI lookup.
- `catalogReady` — `true` synchronously after construction (hardcoded source has no I/O).

### `/status` payload split (DEC-032)

```diff
{
  ...
- "topics": [...]                  // subscribed-only
+ "catalog": [...]                 // from adapter.listCatalog()
+ "active": [...]                  // what was previously "topics"
  ...
}
```

Both `buildStatus` (HTTP) and `buildMcpStatus` (MCP `get_hub_status`) get the same split. The `upstream.coinbase.symbols` field stays for now (it's adapter-internal config visibility) but the dashboard switches to reading `status.catalog`.

### MCP grounding

- `list_topics` continues to return `TopicDescriptor[]` — but the source becomes the adapter's catalog rather than a duplicate `McpServerConfig.symbols`. McpServer gains a dependency on the catalog provider.
- `describe_topic(uri)` validates against `adapter.describeCatalogEntry(uri)` rather than against `configuredSymbols`.
- MCP `resources/subscribe` already implicitly catalog-validates via SDK resource registration; that path needs no change.

### WS gateway catalog enforcement (DEC-030)

In `WsGatewayService.handleSubscribe`, after `parseResourceUri()` succeeds, check `adapter.describeCatalogEntry(uri)`. If missing, reject with:

```typescript
{ event: 'error', code: 'unknown_topic', message: <UnknownTopicError msg>, id?: string }
```

The `UnknownTopicError` already lives in `core/errors.ts` and formats the available list with truncation; reuse it.

### Readiness gate (DEC-033)

Declare a `'ingestion.catalog'` component on `ReadinessService` at bootstrap, set to `true` once `adapter.catalogReady` is observed (synchronously for the hardcoded path). The `ReadinessReporter` aggregation already gates `/readyz` on the conjunction; no new logic in the readiness service itself.

### Dashboard

- `apps/dashboard/src/types.ts` — add `catalog` field to status type; rename `topics` → `active`.
- `App.tsx` — read symbol list from `status.catalog` instead of `status.upstream.coinbase.symbols`.
- `SymbolPicker` is unchanged; it just receives a different prop source.

## Tests

- `packages/ingestion/coinbase.adapter.test.ts` — `listCatalog()` shape; `describeCatalogEntry()` for known + unknown URI; `catalogReady` true at construction.
- `packages/gateway-ws/ws-gateway.test.ts` — new test: subscribe to well-formed but catalog-unknown URI is rejected with `unknown_topic` error and enumerated alternatives.
- `packages/mcp-server/status-builder.test.ts` — `/status` payload includes `catalog` (with expected symbols) and `active` (with subscribed-only).
- `packages/mcp-server/tools.test.ts` — `list_topics` reads from adapter catalog; `describe_topic` validates against catalog.
- `apps/hub` readiness wiring — `'ingestion.catalog'` component is declared and ready by the time `/readyz` returns 200.
- Integration suite (`apps/integration-tests`) — existing scenarios still pass against the renamed `active` field; one new assertion that `catalog` is populated before any subscribes.

## Non-goals

- Coinbase REST `/products` discovery — explicitly deferred per DEC-031.
- Cross-venue catalog policy (ALL vs ANY) — out of scope per DEC-030; one venue today.
- Full `VenueAdapter` interface formalization — only catalog members are interface-fied here; start/stop/subscribeChannel etc. stay concrete.
- `describe_topic` metadata enrichment beyond what's already there (stale flag, sequence) — explicitly out of scope per the explore-phase decision.
- MCP `resources/subscribe` validation overhaul — the SDK's implicit registration check is sufficient.

## What's lost / migration notes

- `COINBASE_SYMBOLS` env var is removed. Anyone previously relying on it must either edit `coinbase-catalog.ts` or pass `symbols` explicitly via DI in tests.
- `/status.topics` field is renamed to `/status.active`. Nothing in this repo (other than the dashboard, which is updated in this change) reads it; no production migration concern.
