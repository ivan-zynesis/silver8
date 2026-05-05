# Walkthrough

This is a guided entry point to the submission, written for the hiring manager. The repository contains a working system, a documentation set, and a decision trail — this page tells you what each is for and the order I'd suggest reading them in.

## Run it yourself — the live environment is the walkthrough

There is no recorded walkthrough for this submission, by design. The system is built to come up locally with bare-minimum host dependencies — Node and pnpm, nothing else — so the live environment serves as the walkthrough. Doing this first means everything below has something running to point at.

```bash
pnpm install && pnpm dev
```

The full setup is in the [README](README.md).

## The dashboard

Once the hub is running, open **[http://localhost:3000/dashboard/](http://localhost:3000/dashboard/)**.

The dashboard is intentionally a different kind of artifact from everything else in this submission. The documentation — including this page — describes the system in prose. The dashboard lets you watch it operate: the upstream connection state, topic subscriptions warming and idling, the order book ticking, the consumer-side surfaces all reflecting the same internal state. It was built partly to satisfy the operator-usability requirement of the brief, and partly as an evaluation aid — a way to show, rather than tell, that the system behaves the way the documents claim.

If you only have a few minutes, run the system and open the dashboard. It will tell you more about the project's quality than any single document on its own.

## Two layers of documentation: `docs/` and `opensprint/`

The repository carries two distinct documentation surfaces, each with a different audience and purpose. Understanding the split makes it easier to know what to read for which question.

**[`docs/`](docs/) — the consumer-facing documentation set.** This is the present-tense description of the system: what it is, how to use it, what every tool and event means. It's structured for an AI agent to read end-to-end and operate the system on first attempt (the brief's stated evaluation criterion), and it serves a human reader equally well.

A reasonable reading order:

1. **[`docs/00-overview.md`](docs/00-overview.md)** — what the system is, what it isn't.
2. **[`docs/08-architecture.md`](docs/08-architecture.md)** — one-page architectural write-up, design choices, and trade-offs.
3. **[`docs/01-getting-started.md`](docs/01-getting-started.md)** — how a consumer (engineer or AI agent) actually connects.
4. **[`docs/05-worked-examples.md`](docs/05-worked-examples.md)** — concrete agent scenarios, end-to-end.
5. **[`docs/06-failure-modes.md`](docs/06-failure-modes.md)** — every error and event the hub emits, and what a consumer should do about each.

The remaining files (`02-mcp-tool-reference`, `03-mcp-resources`, `04-topics`, `07-ws-gateway`) are reference material — useful to dip into, not to read straight through.

**[`opensprint/`](opensprint/) — the architectural decision trail.** Where `docs/` describes the system as it is, `opensprint/` records how it came to be that way. Its primary audience is the AI agent driving the project: driver specs, ADRs, and initiative records are the artifacts the agent reads and writes to keep architectural intent legible across sessions. That said, it's worth reading for a human evaluator who wants to navigate the history of how decisions were made — every load-bearing choice has an ADR with the alternatives considered, the rationale, and an invalidation condition. [`opensprint/DECISION-MAP.md`](opensprint/DECISION-MAP.md) is the index.

## Summary of where to look, by intent

| If you want to evaluate… | Look at… |
|---|---|
| Whether the system actually works | Run it; open the dashboard |
| Architecture judgement and design choices | [`docs/08-architecture.md`](docs/08-architecture.md), then [`opensprint/`](opensprint/) |
| LLM usability of the consumer surface | [`docs/`](docs/) end-to-end |
| Code quality and structure | [`packages/`](packages/) and [`apps/hub/`](apps/hub/) |
| How decisions were reached | [`opensprint/ADRs/`](opensprint/ADRs/) |
