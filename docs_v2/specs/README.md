# Tide v2 Specs

This folder contains focused implementation specs derived from `docs_v2/master-plan.md` and `docs_v2/implementation/concrete-design-backlog.md`.

Each spec must be narrow enough to test and implement as one slice.

## Sequence

| Order | Spec | Status |
|-------|------|--------|
| 1 | [Shared Contracts](shared-contracts.md) | Drafted |
| 2 | [Backend Thread and Agent Runtime Lifecycle](backend-thread-agent-runtime-lifecycle.md) | Drafted |
| 3 | [Provider Integration Bootstrap](provider-integration-bootstrap.md) | Drafted |
| 4 | [Agent Session Block Rendering Path](agent-session-block-rendering-path.md) | Drafted |
| 5 | [Desktop Agent Chat and Composer Shell](desktop-agent-chat-composer-shell.md) | Drafted |
| 6 | [Backend/Desktop Process Connection](backend-desktop-process-connection.md) | Drafted |
| 7 | [Tide MCP Tool Surface for Workbench Observe/Open Browser](tide-mcp-workbench-observe-open-browser.md) | Drafted |
| 8 | [App Chrome and Workbench Tab Strip](app-chrome-workbench-tab-strip.md) | Drafted |
| 9 | [Persistence](persistence.md) | Drafted |
| 10 | [Build and Package](build-and-package.md) | Drafted |

## Support Specs

| Spec | Status | Purpose |
|------|--------|---------|
| [Provider Evidence Harness](provider-evidence-harness.md) | Drafted | Repeatably collect provider PTY, readiness, prompt, and history-reference evidence before implementing real Agent Integrations. |

## Rule

Move through the sequence in order unless a later spec exposes a missing premise in an earlier one.

For each spec:

1. Record evidence from current `docs_v2` documents.
2. Separate decided behavior from open questions.
3. Define contracts, flow, invariants, and tests before code.
4. Keep fallback behavior explicit and narrow.
5. Avoid adding alternate runtime paths for the same Agent.
