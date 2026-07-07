# Spec: Workbench Browser Pane Evidence Loop

## Scope

This spec connects the visible Browser Pane page surface back to Backend-owned
Workbench state so Agents can observe browser evidence through Tide MCP.

It covers:

- A `workbench.command` named `update_browser_snapshot`.
- Desktop emitting a Browser Pane snapshot after the Electron WebView loads.
- BrowserRuntime returning post-load observation for `open_browser` commands.
- Backend validating Browser Pane ownership and revision before storing page
  title, URL, loading state, and bounded body text preview.
- `tide_observe_browser` returning the latest stored Browser Pane evidence.

It does not implement browser click/type automation, full DOM maps,
screenshots, auth popup handling, downloads, or Browser session persistence.

## Evidence

- `docs_v2/specs/workbench-browser-webview-pane.md` renders Browser Pane URLs
  through an Electron WebView but explicitly defers automation.
- `docs_v2/specs/tide-mcp-workbench-observe-open-browser.md` defines
  `tide_observe_browser` as returning bounded Browser Pane state and says
  Browser Pane refs carry revision tokens.
- `src/backend/application/services/thread-runtime-service.ts` currently stores
  `BrowserPaneState.bodyTextPreview`, but `openBrowserOutput` only sets URL,
  title, loading, revision, and updatedAt.
- `src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.ts` renders a
  `<webview>` for Browser Panes and can dispatch `workbench.command` through
  Product Shell handlers.

## Decisions

### D1. Browser evidence is Backend-owned

Desktop may observe the WebView surface, but Backend owns the stored Browser
Pane evidence that MCP tools read.

### D2. Snapshot writes are revision-checked

Desktop includes the Browser Pane revision it rendered. Backend rejects stale
snapshot writes so a late WebView load cannot overwrite a newer navigation.

### D3. First evidence is bounded text

The first loop stores page title, URL, loading state, and bounded body text
preview. Full page maps and action targets need a later Browser automation
spec.

### D4. Runtime observation clears command-open loading

`open_browser` commands must return immediately so the Workbench pane becomes
visible without waiting for Electron BrowserRuntime. The follow-up
BrowserRuntime `ensure` still has to write its observation back through an async
`workbench_changed` event. If the pane revision changed while the ensure was in
flight, the observation is stale and must be dropped.

## Contracts

No new BackendCommand kind is required. Use `workbench.command`:

```json
{
  "threadId": "...",
  "targetPaneId": "pane-browser",
  "command": "update_browser_snapshot",
  "data": {
    "revision": "rev-1",
    "url": "https://example.test",
    "pageTitle": "Example",
    "bodyTextPreview": "bounded visible page text",
    "loading": false
  }
}
```

## Flow

### UC-1: Browser WebView stores page evidence

1. Browser Pane is open with a URL.
2. Desktop WebView finishes loading.
3. Desktop extracts page title, location href, and body innerText from the
   WebView.
4. Desktop emits `workbench.command update_browser_snapshot`.
5. Backend validates Thread, Browser Pane id, and revision.
6. Backend stores bounded browser evidence and emits `workbench.changed`.
7. Agent calls `tide_observe_browser` and receives the latest evidence.

### UC-2: Stale Browser snapshot is rejected

1. Browser Pane navigates and receives a new revision.
2. An older WebView load reports a snapshot for the previous revision.
3. Backend returns `workbench_stale_reference`.
4. The newer Browser Pane evidence stays unchanged.

### UC-3: Command-open BrowserRuntime observation settles loading

1. User opens a Browser Pane from Workbench.
2. Backend returns the Browser Pane snapshot immediately with `loading:true`.
3. BrowserRuntime finishes `ensure` in the background.
4. Backend applies the observation only if the pane still has the same revision.
5. Backend emits async `workbench_changed` so Desktop receives `loading:false`.

## Invariants

1. Desktop does not expose Browser evidence directly to MCP.
2. Snapshot update only mutates a Browser Pane owned by the target Thread.
3. Snapshot update must not create a new Browser Pane.
4. Stale snapshots cannot overwrite newer Browser Pane state.
5. Body text preview is bounded.
6. A BrowserRuntime observation for a command-open Browser Pane must not leave
   the pane in `loading:true` forever.

## Tests

| Rule | Test expectation |
|------|------------------|
| Backend stores Browser evidence | `browser_snapshot_command_updates_observable_browser_preview` |
| Stale snapshot is rejected | `browser_snapshot_with_stale_revision_does_not_mutate_browser_pane` |
| Product Shell emits snapshot command | `product_shell_browser_webview_snapshot_emits_update_command` |
| Command-open BrowserRuntime observation settles loading | `opening_browser_command_emits_runtime_observation_update_without_blocking` |

## Implementation Notes

- Keep WebView extraction inside the Desktop React adapter; the Product Shell
  domain only builds the command from already-extracted snapshot values.
- Keep the first `bodyTextPreview` limit small and deterministic.
