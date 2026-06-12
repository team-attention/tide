# Spec: Tide MCP Browser Action Tool

## Scope

This spec adds the first Browser Pane action loop to the Tide MCP Tool Surface.

It covers:

- A `tide_act_browser` MCP tool for bounded Browser Pane actions.
- Browser Pane action state in Backend-owned Workbench state.
- Desktop executing the pending action inside the visible Electron WebView.
- Desktop reporting the action result and a fresh Browser Pane snapshot through
  `workbench.command update_browser_action_result`.

It does not implement a full Browser Page Map, screenshots, coordinate-based
clicking, drag/drop, downloads, popups, multi-frame targeting, or arbitrary
JavaScript execution from the Agent.

## Evidence

- `docs_v2/implementation/concrete-design-backlog.md` lists "act on Browser
  Pane" as an initial Tide MCP Workbench tool group.
- `docs_v2/implementation/electron-node-architecture-decisions.md` says Browser
  Pane observe/action should be exposed as Tide-owned MCP tools with bounded
  inputs and visible effects.
- `docs_v2/specs/workbench-browser-pane-evidence-loop.md` stores WebView title,
  URL, loading state, and bounded body text in Backend Workbench state, and
  explicitly leaves click/type automation to a later spec.
- `src/backend/application/domains/workbench/workbench.ts` already models
  Browser Pane refs and available Tide MCP tools.
- `src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.ts` already
  owns WebView snapshot extraction and dispatches `workbench.command`
  `update_browser_snapshot`.

## Decisions

### D1. Browser actions are scheduled by Backend and executed by Desktop

Backend validates Thread ownership, Browser Pane id, revision, and action input.
Desktop owns WebView execution because the Browser Pane WebView is a Desktop
surface.

### D2. The first action target is a CSS selector

The first tool accepts a CSS selector and an action kind. This is not the final
Page Map strategy, but it keeps the tool bounded and avoids exposing arbitrary
Agent-authored JavaScript.

### D3. Observe-before-action is required

The Agent must provide the Browser Pane revision it observed. Backend rejects
stale revisions before scheduling an action.

### D4. Actions are asynchronous visible side effects

`tide_act_browser` returns a pending action. The action is complete only after
Desktop executes it and reports `update_browser_action_result`.

## Domain Model

```ts
type BrowserPaneActionKind = "click" | "type_text";

interface BrowserPaneActionRequest {
  actionId: string;
  kind: BrowserPaneActionKind;
  selector: string;
  text?: string;
  requestedAt: string;
}

interface BrowserPaneActionResult extends BrowserPaneActionRequest {
  status: "completed" | "failed";
  message: string;
  completedAt: string;
}
```

Browser Pane state carries at most one pending action and one last action result.

## Contracts

### MCP Tool

```json
{
  "name": "tide_act_browser",
  "inputSchema": {
    "type": "object",
    "properties": {
      "paneId": { "type": "string" },
      "revision": { "type": "string" },
      "action": { "type": "string", "enum": ["click", "type_text"] },
      "selector": { "type": "string" },
      "text": { "type": "string" }
    },
    "required": ["paneId", "revision", "action", "selector"]
  }
}
```

`text` is required only when `action` is `type_text`.

### Workbench Command

Desktop reports execution through:

```json
{
  "threadId": "...",
  "targetPaneId": "pane-browser",
  "command": "update_browser_action_result",
  "data": {
    "revision": "rev-after-scheduling",
    "actionId": "action-1",
    "status": "completed",
    "message": "Clicked button.primary",
    "url": "https://example.test/next",
    "pageTitle": "Next page",
    "bodyTextPreview": "bounded visible page text",
    "loading": false
  }
}
```

## Flow

### UC-1: Agent schedules Browser click

1. Agent observes Browser Pane and receives `paneId` plus `revision`.
2. Agent calls `tide_act_browser` with `action: "click"` and a CSS selector.
3. Backend validates Thread ownership, Browser Pane id, and revision.
4. Backend records a pending Browser action and emits `workbench.changed`.
5. Desktop sees the pending action on the visible Browser Pane, executes the
   WebView click, then reports `update_browser_action_result`.
6. Backend clears the pending action, records the last action result, stores the
   fresh Browser snapshot, and emits `workbench.changed`.

### UC-2: Agent schedules Browser text input

1. Agent observes Browser Pane and receives `paneId` plus `revision`.
2. Agent calls `tide_act_browser` with `action: "type_text"`, a selector, and
   text.
3. Backend schedules the action as in UC-1.
4. Desktop focuses the target element, replaces its value or text content,
   dispatches input/change events, and reports the result.

### UC-3: Stale Browser action is rejected

1. Browser Pane revision changes after the Agent observes it.
2. Agent calls `tide_act_browser` with the old revision.
3. Backend returns `workbench_stale_reference`.
4. No pending action is recorded.

## Invariants

1. Browser actions target only a Browser Pane owned by the MCP Session Thread.
2. Browser actions require a matching observed revision.
3. Browser actions never run arbitrary Agent-authored JavaScript.
4. Backend may schedule only one pending Browser action per Browser Pane.
5. Desktop action results must match both Browser Pane revision and action id.
6. Failed Browser actions are recorded as visible Browser Pane evidence rather
   than silently discarded.

## Tests

| Rule | Test expectation |
|------|------------------|
| Tool list includes Browser action | `tide_mcp_tool_surface_lists_bounded_workbench_tools` includes `tide_act_browser`. |
| Click schedules visible action | `browser_action_tool_schedules_pending_click_for_desktop_webview` records pending click and emits Workbench state. |
| Type requires text | `browser_type_action_without_text_returns_structured_error` rejects missing text. |
| Stale action is rejected | `browser_action_with_stale_revision_returns_structured_error` returns `workbench_stale_reference`. |
| Desktop result clears pending action | `browser_action_result_command_records_completion_and_snapshot` clears pending action and records the result. |
| Product Shell reports action result | `product_shell_browser_action_result_emits_workbench_command` emits `update_browser_action_result`. |

## Implementation Notes

- Keep the WebView DOM execution inside the Desktop React adapter.
- Keep Browser action DTOs in Shared Contracts because they cross the
  Desktop/Backend process boundary.
- Keep the selector action model deliberately narrow until a Browser Page Map
  spec exists.
