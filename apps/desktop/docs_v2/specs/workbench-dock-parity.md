# Spec: Workbench Dock Parity

## Scope

Make the v2 Workbench behave like the v1 Tide Terminal "Terminal Context Surface"
(dock): a launcher-first surface of multiple coexisting panes with intuitive
Stacked/Split presentation, available on the composer (New Thread) screen, and
manipulable by the agent. Six concrete changes, delivered as one combined pass:

1. **Launcher-first (placeholder)** — opening the Workbench (`+`/toggle) with nothing
   in it shows the Launcher; the Launcher is a PLACEHOLDER that is RESOLVED in-slot
   when you pick an action (replaced by the chosen pane), per v1 dock-placeholder.
2. **Multiple Browser Panes** — open several Launchers (`+` → launcher → resolve to
   Browser, repeated) to get several coexisting browsers; the Launcher never persists
   beside the panes it opens.
3. **Cmd/Ctrl+click → new Browser Pane** — modifier-click on a chat link opens a new
   Browser Pane; plain click keeps reuse-active.
4. **Intuitive Stacked/Split** — replace the single ambiguous toggle icon with an
   icon-only `Stacked | Split` segmented control (the two presentation glyphs, active
   one filled; labels in tooltips), and add per-pane **maximize** (Split → Stacked
   focused on that pane). Default presentation is Stacked. The Workbench top row is the
   **same 52px header in both modes** with the same trailing controls — Stacked fills
   the left with the tab strip, Split leaves it an empty spacer (the panes own their
   headers) — so the chrome never changes height or jumps when you toggle.
   Stacked tabs are flat and label-like; the active tab carries a full-height surface
   highlight + a charcoal under-bar (ink, never a chip) so it reads as a tab — not as
   the segmented toggle in the same row — and its region is clearly delineated. The
   active tab never shrinks (the current filename stays legible); inactive tabs give up
   width first, collapsing toward icon-only with a filename tooltip. The close button is
   collapsed-until-revealed so inactive tabs spend their width on the title.
5. **Composer-screen Launcher + adoption** — the Workbench + Launcher are available
   on the New Thread / start page (no thread yet); panes opened there are *adopted*
   by the Thread that the first send creates.
6. **Agent pane/layout control** — new Tide MCP tools let the agent focus a pane,
   close a pane, and switch Stacked/Split; `tide_observe_workbench` reports the
   current layout mode.

## Evidence

- v1 reference: `apps/terminal/docs/specs/dock-global.md` — Terminal Context Surface
  = Split (binary `SplitLayout`, directional drops split / center swaps) vs Stacked
  (one active pane + flat tab bar); new surfaces default to **Stacked**; header
  maximize toggles Stacked (UC-3 BR-3); Split/Stacked choice is per-`Terminal`.
- v2 layout today is renderer-local: `workbenchLayoutMode: "tabs" | "split"` and
  `workbenchLayoutTree` in `src/desktop/application/domains/product-shell/state/{create,workbench,workbench-split-tree}.ts`;
  toggled by one icon in `workbench.tsx` (`onWorkbenchLayoutModeToggle`).
- Backend pane ops + commands: `src/backend/application/services/workbench/workbench-command-handler.ts`
  (has `focus_pane`, `close_pane`, `open_browser`, …); browser open/reuse in
  `workbench-browser-operations.ts` (`disposition: reuse_active_browser | new_browser_pane`).
- Launcher: `open_launcher` command + `openWorkbenchLauncher`; synthetic empty
  launcher `emptyWorkbenchLauncherPane()` in `launcher-pane.tsx`; UI launcher
  `open_browser` action currently sends no disposition → reuse.
- Agent (MCP) surface: `src/backend/application/services/tide-mcp/tide-mcp-tool-handler.ts`
  + tool-name registry `TIDE_MCP_WORKBENCH_TOOL_NAMES` in
  `src/backend/application/domains/workbench/workbench.ts`. No focus/close/layout tools.
- Composer → thread create: `state/composer-bridge.ts:194-232` (`submitProductShellComposerDraft`)
  — on a brand-new thread it sets `activeThreadId` and **drops** `startPageFile` +
  `workbenchOpen:false` ("opens clean"). Start-page editor is thread-independent via
  `START_FILE_PANE_ID` (`state/types.ts`, `state/view-model.ts`) using
  `workspace.readFile` / `workspace.writeFile`.
- Chat link click: `agent-chat/transcript/transcript.tsx:100-109` routes
  `data-open-browser-link` → `onOpenBrowserPane(url)` (no modifier read today).

## Decisions

- **Layout mode becomes backend-authoritative, per-Thread.** Move the Stacked/Split
  choice into `thread.workbench.layoutMode` (`"stacked" | "split"`, default
  `"stacked"`), snapshot it, and mutate it through a `set_layout_mode` Workbench
  command. This is required so the agent can both *observe* and *set* it, and gives
  per-Thread memory (v1 parity). Terminology: the renderer's `"tabs"` becomes
  `"stacked"` everywhere.
- **The split *tree* stays renderer-local.** `workbenchLayoutTree` remains a
  renderer concern reconciled from the visible pane set (manual drag arrangement).
  The agent does not arrange exact splits in this pass (Out Of Scope).
- **Composer-screen Workbench uses a renderer-held *draft Workbench*, adopted on
  send (replay).** No phantom Thread, no eager agent spawn (consistent with the
  rejected approach noted in `start-page-editor`). Draft Browser Panes render live
  (renderer-owned `<webview>`); the existing single start-page Editor is shown as a
  pane; Terminal/Diff draft entries are *pending intents*. On `thread.start`, the
  renderer replays each draft as an `open_*` Workbench command against the new
  Thread (FIFO after `thread.start`), then clears the draft and keeps the Workbench
  open. Adoption is best-effort and ordered; a failed replay is dropped, never fatal.
- **Launcher is a PLACEHOLDER, resolved in-slot on open (v1 parity).** This corrects
  the initial implementation (which kept the Launcher and spawned a new pane beside
  it). Per v1 `apps/terminal/docs/specs/dock-placeholder.md` + `dock_service`
  (`replace_pane` + `panes.remove`) and `pane_create_service::resolve_launcher`: the
  Launcher occupies a slot, and picking an action REMOVES it and puts the chosen pane
  in its place. Several browsers come from opening several Launchers (`+` → launcher →
  resolve, repeated), NOT from a persistent Launcher. An empty Workbench shows the
  Launcher; opening a pane while a Launcher is active resolves it; opening a pane with
  no active Launcher (agent, chat-link) adds a new pane.

## Out Of Scope

- Agent-driven exact split-tree arrangement / ratios (manual drag only).
- Multiple thread-independent **Editor** panes pre-thread (the existing single
  start-page editor is reused; multi-editor pre-thread is deferred).
- Pre-thread live **Terminal**/**Diff** (no execution context before a Thread; shown
  as pending intents, materialized on adoption).
- Persistence of the draft Workbench across app restarts.
- Renaming the on-disk `tabs` value in already-persisted Thread metadata (none persists
  layoutMode today; new field defaults to `stacked`).

## Domain Model

- `WorkbenchLayoutMode = "stacked" | "split"` (shared contract + backend domain).
- `Workbench` (backend) gains `layoutMode: WorkbenchLayoutMode` (default `"stacked"`),
  carried in `WorkbenchSnapshot` + `observe_workbench` output.
- Renderer `ProductShellState`:
  - `workbenchLayoutMode` retyped `"stacked" | "split"` and, for a Thread, *derived*
    from the active Thread's workbench snapshot (renderer keeps a value for the
    no-thread draft case and for optimistic update).
  - New `draftWorkbench: DraftWorkbench | null` — `{ panes: DraftPane[]; activePaneId; layoutMode }`
    where `DraftPane` is a browser/editor/terminal/diff *intent* with a renderer
    pane id.
- Tide MCP tools: add `tide_focus_pane`, `tide_close_pane`, `tide_set_workbench_layout`.

## Contracts

`src/shared/contracts/workbench.ts`:
- `WorkbenchSnapshotDto` (or the snapshot carrier) gains `layoutMode: "stacked" | "split"`.

`src/backend/application/domains/workbench/workbench.ts`:
- `WorkbenchLayoutMode` type; `Workbench.layoutMode`; include in `snapshotWorkbench`.
- `TideMcpToolName` + `TIDE_MCP_WORKBENCH_TOOL_NAMES` += the three tools.
- `TideObserveWorkbenchOutput` carries `layoutMode`.

Workbench command (`workbench-command-handler.ts`): new case
- `set_layout_mode` — `data:{ mode:"stacked"|"split" }` → sets `thread.workbench.layoutMode`.

MCP (`tide-mcp-tool-handler.ts` + definitions):
- `tide_focus_pane { paneId }` → reveal+activate pane (reuse `focus_pane` semantics).
- `tide_close_pane { paneId }` → hide pane / stop terminal (reuse `close_pane` semantics).
- `tide_set_workbench_layout { mode:"stacked"|"split" }` → set `layoutMode`.
- All three are workbench-mutating (emit `workbench_changed`).

Renderer handler signature:
- `onOpenBrowserPane(url: string, options?: { newPane?: boolean })`.
- `openProductShellBrowserAtUrl(state, url, { newPane })` passes
  `disposition: newPane ? "new_browser_pane" : "reuse_active_browser"`.

## Flow

**Launcher resolve (placeholder):** Launcher *Browser* → `open_browser` (no
disposition) → backend sees the active pane is a Launcher → opens a new Browser Pane
AND removes the Launcher (`activeLauncherPaneId` + `removeLauncherPane`), so the
Browser takes the Launcher's slot. Same for *Editor*/*Terminal* (`open_editor` /
`open_terminal` remove the active Launcher). Several browsers = repeat `+` → Launcher
→ resolve. With no active Launcher (agent `tide_open_browser`, chat-link click) the
input disposition (reuse / `new_browser_pane`) applies and no Launcher is removed.

**Cmd/Ctrl+click link:** transcript click reads `event.metaKey || event.ctrlKey`;
true → `onOpenBrowserPane(url,{newPane:true})` → `new_browser_pane`; false → reuse.

**Stacked/Split:** segmented control / per-pane maximize → `set_layout_mode` command
(optimistic renderer set + backend authoritative) → snapshot confirms. Maximize sets
`stacked` and focuses the pane (`focus_pane`).

**Composer adoption:** start page (no thread): Launcher actions add `DraftPane`s and
open the Workbench. On submit, `submitProductShellComposerDraft` detects a new
`thread.start`; instead of dropping, it emits an ordered list of follow-up `open_*`
Workbench commands (one per draft pane) bound to the new `threadId`, clears
`draftWorkbench`, and leaves `workbenchOpen` true.

## Invariants

1. Backend `thread.workbench.layoutMode` is the single source of truth for a Thread's
   Stacked/Split choice; the renderer reflects it for the active Thread.
2. The Launcher never disappears as an option: an empty Workbench shows the Launcher.
3. Opening a Browser via the Launcher always yields a new Pane; reuse only happens
   via plain chat-link click or an explicit `reuse_active_browser` disposition.
4. No phantom Thread / no agent spawn from opening composer-screen panes; a Thread is
   created only by an actual send.
5. Adoption is ordered after `thread.start` and best-effort; the chat send itself
   never fails because a pane replay failed.
6. Render isolation (desktop-product-shell-render-isolation) is preserved: layout
   changes flow through the workbench slice only.

## Tests

| # | Area | Expectation |
|---|------|-------------|
| T1 | backend cmd | `set_layout_mode` sets `thread.workbench.layoutMode`; snapshot carries it; invalid mode → failure. |
| T2 | backend cmd | Launcher resolve: `open_browser` while a Launcher is active removes it + adds the Browser (launcher count → 0); a 2nd Launcher → resolve → 2 browsers. |
| T3 | backend MCP | `tide_focus_pane` reveals+activates; `tide_close_pane` hides; `tide_set_workbench_layout` sets mode; all emit `workbench_changed`; `tide_observe_workbench` reports `layoutMode`. |
| T4 | contracts/arch | new tool names present in registry; layoutMode in snapshot DTO; tool list count updated. |
| T5 | renderer state | `openProductShellBrowserAtUrl(...,{newPane:true})` emits `disposition:new_browser_pane`; default reuse. |
| T6 | renderer state | `toggleProductShellWorkbenchLayoutMode` / set-layout emits `set_layout_mode`; maximize emits stacked + focus. |
| T7 | renderer state | start page (activeThreadId null): launcher Browser adds a draft pane + opens workbench; submit yields ordered `open_*` commands for each draft + clears draft + keeps workbench open. |
| T8 | renderer component | Stacked|Split segmented control renders both options as icons with active state; same 52px top-row header in both modes; per-pane maximize button present in Split. |
| T9 | renderer component | transcript modifier-click calls `onOpenBrowserPane(url,{newPane:true})`. |

## Implementation Notes

- Keep internal split-tree code (`workbench-split-tree.ts`) unchanged; only the mode
  *label/value* changes `"tabs"→"stacked"`. Migrate all `=== "tabs"` / `"split"`
  string sites.
- `set_layout_mode` is a pure thread-state mutation (no runtime), mirroring
  `focus_pane`. `tide_set_workbench_layout` shares it.
- Draft panes: reuse `WorkbenchBrowserPane` for live draft browsers (it already keys
  by paneId and drives its own `<webview>`); draft editor reuses the existing
  `START_FILE_PANE_ID` path; draft terminal/diff render a small "opens with your
  first message" placeholder.
- Adoption replay reuses existing `workbench.command` envelopes; dispatch them right
  after the `thread.start` envelope so the backend thread record exists (FIFO).
- Default `create.ts` `workbenchLayoutMode: "stacked"`; backend `Workbench.layoutMode`
  default `"stacked"`.

## Location

| Item | Path |
|------|------|
| Spec | `docs_v2/specs/workbench-dock-parity.md` |
| Contracts | `src/shared/contracts/workbench.ts` |
| Backend domain | `src/backend/application/domains/workbench/workbench.ts` |
| Backend cmd | `src/backend/application/services/workbench/workbench-command-handler.ts` |
| Backend browser op | `src/backend/application/services/workbench/workbench-browser-operations.ts` |
| Backend MCP | `src/backend/application/services/tide-mcp/tide-mcp-tool-handler.ts`, `tide-mcp-output.ts` |
| Renderer state | `src/desktop/application/domains/product-shell/state/{workbench,create,types,view-model,composer-bridge}.ts` |
| Renderer UI | `src/desktop/adapters/inbound/react-renderer/product-shell/workbench/{workbench,launcher-pane,split-view}.tsx` |
| Chat link | `src/desktop/adapters/inbound/react-renderer/agent-chat/transcript/transcript.tsx` |
