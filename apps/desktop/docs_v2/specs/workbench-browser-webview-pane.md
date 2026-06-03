# Spec: Workbench Browser WebView Pane

## Scope

This spec turns a Browser Workbench Pane from metadata-only rendering into an
Electron-hosted page surface.

It covers:

- Rendering Browser Pane URLs through an Electron `<webview>` element.
- Keeping Browser Pane metadata and bounded preview text as fallback evidence.
- Enabling `webviewTag` on the Desktop BrowserWindow so the Workbench Browser
  Pane can actually load pages.

It does not cover:

- Browser click/type/page-map automation.
- Browser session persistence.
- Auth popup handling.
- Download handling.
- Agent Browser control mode.

## Evidence

- `docs_v2/master-plan.md` says Workbench can contain Browser Panes for browser
  automation details and verification.
- `docs_v2/implementation/electron-node-architecture-decisions.md` says Browser
  Pane is a first-class Workbench Pane in Electron.
- `docs_v2/specs/tide-mcp-workbench-observe-open-browser.md` defines
  `tide_open_browser` as creating or revealing a Tide-owned Browser Pane rather
  than opening the OS default browser.
- `docs_v2/specs/desktop-workbench-pane-content-rendering.md` currently
  excludes a native browser WebView and renders only Browser metadata.
- `src/desktop/main/electron-main.ts` creates the main BrowserWindow without
  `webviewTag`.
- `src/desktop/adapters/inbound/react-renderer/tide-product-shell.ts` currently
  renders Browser Pane URL and preview text but no page-hosting element.

## Decisions

### D1. First Browser Pane runtime uses Electron webview

The first visible Browser Pane runtime is an Electron `<webview>` rendered in
the Workbench column.

### D2. Metadata remains visible

URL, title, loading state, revision, and bounded text preview remain visible so
Agent Session evidence and tests can still inspect what Tide believes is open.

### D3. Browser automation stays deferred

This slice only makes the Browser Pane visible and loadable. Agent click/type,
page-map observation, and auth popup behavior require later Browser Pane
runtime specs.

## Flow

### UC-1: Open Browser Pane with URL

1. Agent calls `tide_open_browser`.
2. Backend creates or reveals a Browser Pane ref with `url`.
3. Desktop receives `workbench.changed`.
4. Product Shell renders the Browser Pane as an Electron `<webview src=...>`.
5. URL metadata and bounded preview remain available in the Pane body.

## Invariants

1. Browser Pane uses Tide-owned Workbench UI, not the OS default browser.
2. Browser Pane rendering does not mutate Backend state.
3. Browser Pane metadata remains visible even when the page surface is empty or
   unavailable.
4. Browser click/type automation is not implied by this slice.

## Tests

| Rule | Test |
|------|------|
| Browser Pane renders WebView | `workbench_browser_pane_renders_electron_webview_for_url` |
| Desktop enables webview tag | `electron_main_enables_webview_tag_for_workbench_browser_panes` |

## Implementation Notes

- Keep the webview element in the Product Shell renderer adapter.
- Keep BrowserWindow security defaults such as `nodeIntegration: false` and
  `contextIsolation: true`.
