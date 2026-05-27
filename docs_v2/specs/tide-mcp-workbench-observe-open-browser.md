# Spec: Tide MCP Tool Surface for Workbench Observe and Open Browser

## Scope

This spec defines the first Tide MCP Tool Surface slice for agent-operated Workbench context.

It covers:

- MCP attachment to the same Agent Runtime session.
- Thread-scoped tool authorization.
- observe Thread/Workbench state.
- open Browser Pane.
- observe Browser Pane at a coarse level.
- visible side effects.
- Workbench Pane identity.
- stale reference handling.
- human/agent shared control rules for the first Browser Pane slice.

It does not define browser click/type automation, full page map, Diff/File tools, Terminal Pane tools, context artifacts, or external browser delegation.

## Evidence

- `docs_v2/glossary.md` defines Tide MCP Tool Surface as the provider-visible tool surface that lets the selected Agent observe and operate Tide-owned UI and routes tool calls back to Tide.
- `docs_v2/master-plan.md` says Workbench panes/views attach to the active Thread, do not create separate Thread identity, and do not include the hidden Agent Runtime by default.
- `docs_v2/master-plan.md` says the active Agent should be able to know which Workbench panes/views are open and operate them through Tide-owned MCP tools when supported.
- `docs_v2/implementation/electron-node-architecture-decisions.md` says MCP tool calls are attached to the same provider CLI session and do not split one Agent into multiple runtimes.
- `docs_v2/implementation/concrete-design-backlog.md` selects Tide-owned MCP tools and lists observe Thread/Workbench, open Browser Pane, observe Browser Pane, act on Browser Pane, Diff/File, Terminal Pane, and context artifacts as initial tool groups.
- `crates/tide-app/resources/bin/codex`, `crates/tide-app/resources/bin/claude`, and `crates/tide-app/resources/bin/gemini` include existing tool guidance that prefers Tide MCP tools such as `tide_open_browser` and `tide_observe_workspace` for URLs, previews, and Tide surfaces.
- `crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs` exposes an existing MCP stdio bridge and includes tool definitions for workspace observation and browser opening in Tide v1.

## Decisions

### D1. MCP is attached to the Agent Runtime session

Tide MCP Tool Surface is attached by the selected Agent Integration during provider launch or resume.

Tool calls belong to the same Thread and Agent Runtime context as the provider CLI session.

### D2. First MCP slice is observe and open Browser

The first tool set is:

- `tide_observe_thread`.
- `tide_observe_workbench`.
- `tide_open_browser`.
- `tide_observe_browser`.

Browser action tools are deferred until the Browser Pane runtime spec has page map and action semantics.

### D3. Tools are Thread-scoped

Every tool call resolves an active Thread.

The provider may pass explicit Thread id only when Tide gave it one. Otherwise Backend derives Thread identity from the Agent Runtime session that owns the MCP connection.

### D4. Tools have visible side effects

`tide_open_browser` creates or reveals a visible Browser Pane in the active Thread's Workbench.

It does not open the OS default browser.

It does not create a hidden browser runtime.

### D5. Observe tools are safe reads

Observe tools return bounded snapshots of Thread, Agent Chat state, Workbench Panes, Browser Pane metadata, and available tool next steps.

They do not mutate Workbench state.

### D6. Browser Pane identity is stable and checked

Browser Pane references include WorkbenchPaneId and a revision token.

Tool calls that target a stale or missing Browser Pane return a structured tool error instead of acting on a guessed target.

### D7. Human-visible focus is preserved by default

Agent-opened Workbench Panes may become visible, but tool calls do not steal text focus from the human Composer unless a future explicit focus-transfer tool is specified.

### D8. External browser delegation is out of first path

Agents use Tide-owned Browser Pane tools for Tide UI context.

Shell commands or provider-owned external browser tools do not satisfy the first Workbench tool path.

## Out Of Scope

- Browser click, type, keypress, screenshot, and page map action tools.
- Browser automation cursor.
- Diff/File read and edit tools.
- Terminal Pane tools.
- Context artifact tools.
- Multi-window routing.
- Persistent Browser Pane session restore.
- User permission prompts for every browser open.

## Domain Model

### MCP Session

MCP Session is the provider-visible tool connection attached to one Agent Runtime session.

It carries:

- Agent id.
- Thread id.
- Agent Runtime id.
- Backend connection identity.
- supported tool list.

### Workbench Snapshot

Workbench Snapshot is a bounded read model:

- active Thread id.
- Agent Chat state.
- visible Workbench Panes.
- Browser Pane refs.
- Diff/File/Terminal refs when present.
- current focus ownership summary.
- allowed next tool names.

### Browser Pane Ref

Browser Pane Ref:

- WorkbenchPaneId.
- revision.
- title.
- current URL when available.
- loading state.
- visible state.
- stale flag.

## Tool Contracts

### `tide_observe_thread`

Input:

```ts
interface TideObserveThreadInput {
  detail?: "compact" | "full";
}
```

Output:

```ts
interface TideObserveThreadOutput {
  threadId: ThreadId;
  agentId: AgentId;
  agentChatState: string;
  promptActive: boolean;
  workbenchOpen: boolean;
  availableTools: string[];
}
```

### `tide_observe_workbench`

Input:

```ts
interface TideObserveWorkbenchInput {
  detail?: "compact" | "full";
}
```

Output:

```ts
interface TideObserveWorkbenchOutput {
  threadId: ThreadId;
  panes: WorkbenchPaneRef[];
  activePaneId?: WorkbenchPaneId;
  availableTools: string[];
}
```

### `tide_open_browser`

Input:

```ts
interface TideOpenBrowserInput {
  url?: string;
  title?: string;
  disposition?: "reuse_active_browser" | "new_browser_pane";
}
```

Output:

```ts
interface TideOpenBrowserOutput {
  threadId: ThreadId;
  pane: BrowserPaneRef;
  visibleSideEffect: "created" | "revealed" | "navigated";
}
```

### `tide_observe_browser`

Input:

```ts
interface TideObserveBrowserInput {
  paneId: WorkbenchPaneId;
  revision?: string;
  detail?: "compact" | "full";
}
```

Output:

```ts
interface TideObserveBrowserOutput {
  threadId: ThreadId;
  pane: BrowserPaneRef;
  pageTitle?: string;
  url?: string;
  loading: boolean;
  bodyTextPreview?: string;
  availableTools: string[];
}
```

The first slice may omit full DOM page map. Browser action tools require a later page map spec.

## Flow

### UC-1: Agent observes Thread

1. Provider calls `tide_observe_thread`.
2. Backend identifies Thread from MCP Session.
3. Backend returns bounded Thread and Agent Chat state.
4. No Workbench state changes.

### UC-2: Agent observes Workbench

1. Provider calls `tide_observe_workbench`.
2. Backend returns visible Workbench Panes for the Thread.
3. Browser Pane refs include revision tokens.
4. No focus transfer occurs.

### UC-3: Agent opens Browser Pane

1. Provider calls `tide_open_browser` with optional URL.
2. Backend validates Thread ownership.
3. Backend creates, reveals, reuses, or navigates a Browser Pane according to disposition.
4. Desktop shows the Browser Pane in Workbench.
5. Tool result returns Browser Pane ref.

### UC-4: Agent observes Browser Pane

1. Provider calls `tide_observe_browser` with pane id.
2. Backend validates that the pane belongs to the Thread.
3. Backend detects stale revision when provided.
4. Backend returns bounded Browser Pane state or structured stale/missing target error.

## Invariants

1. Tide MCP Tool Surface attaches to the same Agent Runtime session.
2. MCP tools do not create a second Agent Runtime.
3. Every tool call resolves a Thread.
4. Observe tools do not mutate Workbench state.
5. `tide_open_browser` creates or reveals a visible Browser Pane in Workbench.
6. Browser Pane tool calls validate Thread ownership.
7. Stale or missing pane refs return structured errors.
8. Agent tools preserve human text focus by default.
9. External browser delegation is not the first Workbench path.

## Tests

| Rule | Test expectation |
|------|------------------|
| MCP session resolves Thread | Fake MCP call without explicit Thread id resolves from Agent Runtime session. |
| Observe is read-only | `tide_observe_workbench` returns snapshot without changing pane list. |
| Open browser creates visible pane | `tide_open_browser` creates a Browser Pane attached to active Thread Workbench. |
| Open browser does not open OS browser | Test double records no external browser call. |
| Browser observe checks ownership | Observing a pane from another Thread returns structured error. |
| Stale revision is detected | Observing with old revision returns stale target result. |
| Focus is preserved | Opening Browser Pane does not move Composer text focus by default. |
| Tool list is bounded | MCP tools/list exposes only first-slice tools for this spec. |

## Implementation Notes

- Implement MCP server as a Backend inbound adapter.
- Keep Workbench mutations inside Backend services.
- Return small snapshots; avoid dumping full DOM or raw app state.
- Keep Browser action tools out until page map and authorization are specified.
- Use v1 MCP names as evidence, but define v2 tools around Thread and Workbench terms.
- Include user-visible side effect text in tool results so the Agent can narrate accurately.
