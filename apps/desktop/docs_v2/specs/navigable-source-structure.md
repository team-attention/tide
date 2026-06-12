# Spec: Navigable Source Structure (whole-app decomposition)

> **Status: IMPLEMENTED** (2026-06-12). Navigation guide:
> `docs_v2/implementation/source-map.md`. Deviations from the target tree
> below, chosen during the moves:
> - `product-shell/chat-column.ts` exists (the agent-chat column assembly).
> - The contract adapter kept its dispatch class whole; `dto/{thread,workbench}-dtos.ts`,
>   `error-codes.ts`, `envelope-support.ts` were extracted instead of `routes/`
>   (splitting the class's case handlers is a rewrite, not a move).
> - Live-backend provider helpers landed in `live-provider-discovery.ts`
>   (still infrastructure; relocating them into adapters stays Phase-5.2 work).
> - `thread-runtime-service.ts` was not shrunk: it is ~400 lines of API types
>   plus one 1,382-line lifecycle class; the class split remains the
>   `thread-runtime-service-decomposition.md` collaborator refactor (pinned).
> - The electron smoke's dead `antigravity` default was replaced with a direct
>   `openai_api` thread.start binding (audit Phase-2.3's prescribed fix), making
>   `npm run test:smoke:electron` the auth-free end-to-end gate; it passed
>   against the decomposed app, as did the 682-test suite, typecheck, build,
>   and a pw-smoke screenshot pass.

## Scope

Restructure the entire Tide v2 source tree (`src/desktop`, `src/backend`,
`src/shared` untouched) so the directory tree itself answers "where do I change
X" — without changing behavior. This executes the deferred Phase 3 of
`docs_v2/implementation/codebase-issues-and-remediation-plan.md` and extends it
to the CSS blob (which Phase 3 missed) and the backend services pile.

The acceptance story (from the goal): *"I want to change the CSS of a button on
a thread row in the left thread list"* must be answerable by directory walk
alone — e.g. `renderer/styles/left-rail.css` (style) and
`react-renderer/product-shell/left-rail/thread-row.ts` (markup) — for every
area of the app, not just that one.

## Evidence

- `tests/file-size-ratchet.test.ts` pins 8 god-files; none has been split.
- `tide-product-shell.ts` 5,835 lines / 92 top-level decls: shell + left rail +
  all six workbench panes + dialogs + search palettes + settings modal + icons.
- `tide-product-shell.css` 5,094 lines, one file, all areas interleaved.
- `product-shell-state.ts` 3,054 / `agent-chat-shell-state.ts` 2,317: whole-app
  view state + per-agent vocabulary in single files.
- `backend/application/services/` = 25 sibling files from 4 different areas.
- `backend-contract-message-adapter.ts` 1,012: every command in one switch.
- Audit §3 already sketches the renderer target tree; this spec concretizes it.

## Decisions

1. **Move, don't rewrite.** Declarations are cut and relocated byte-identical
   (imports/`export` keywords are the only permitted edits). Any shape change
   is out of scope for this epic.
2. **Old god-file paths stay as barrels.** `tide-product-shell.ts`,
   `agent-chat-shell.ts`, `product-shell-state.ts`, `agent-chat-shell-state.ts`
   keep their paths and re-export the moved API so tests and entrypoints keep
   compiling; the implementation lives in feature directories next to them.
3. **CSS becomes an ordered `styles/` directory** imported by the existing
   `tide-product-shell.css` path (now an `@import` index). Rule blocks may be
   regrouped out of original order only when their selector set is unique
   file-wide (cascade-tie safe); otherwise they stay in original-order files.
4. **Module direction is leaf-ward:** `types/helpers ← feature modules ←
   shell/root`. Feature modules never import the shell; shared mutable
   singletons live in exactly one leaf module.
5. **The ratchet enforces completion:** every slice lowers or deletes pins in
   `file-size-ratchet.test.ts`; new files obey the 800 cap (target ≤ 500).

## Out Of Scope

- Behavior, markup, or styling changes of any kind.
- The Phase-1 registry leftovers (model/effort vocabulary stays where the
  registry left it, only relocated).
- `thread-runtime-service.ts` deep decomposition beyond the existing
  `thread-runtime-service-decomposition.md` collaborator pattern.
- v1 (`apps/terminal`).

## Target tree

### Renderer views — `desktop/adapters/inbound/react-renderer/`

```
react-renderer/
  tide-product-shell.ts            # barrel (re-export only)
  agent-chat-shell.ts              # barrel (re-export only)
  product-shell/
    shell.ts                       # TideProductShell component + props/handlers wiring
    types.ts                       # ProductShellHandlers, MenuAnchorRect, props
    layout.ts                      # COLUMN_MINS, fitColumnsToWidth, useColumnPresence
    agent-identity.ts              # agentMonogram, AgentIdentityIcon, agentLabel, normalizeAgentId
    chrome.ts                      # window-chrome toggles, traffic controls, icon button, resize handle
    settings.ts                    # settings modal, theme options, list/worktree/start localStorage
    left-rail/
      left-rail.ts                 # createLeftUi column assembly
      project-section.ts           # project groups + per-project thread list
      pinned-section.ts
      thread-section.ts
      thread-row.ts                # createThreadRow (+ scope label)
      section-header.ts            # headers, nav rows, list-settings button/menu
      context-menu.ts              # left-rail context menu + overlay
      skeletons.ts
    workbench/
      workbench-column.ts          # createWorkbenchColumn + tab strip
      split-view.ts                # WorkbenchSplitView + drop-zone math
      pane-content.ts              # pane content dispatch + editor-picker pane
      pane-chrome.ts               # heading/meta/preview/bytes helpers
      browser-pane.ts              # browser pane + webview snapshot/actions + background webview host
      editor-pane.ts               # editor pane + breadcrumb + references + language
      code-editor.ts               # WorkbenchCodeEditor (CodeMirror)
      markdown-view.ts
      diff-pane.ts                 # diff pane + diff row parsing/rendering
      terminal-pane.ts             # terminal view/pane + output sink registry
      launcher-pane.ts
    file-tree.ts                   # file-tree column + skeleton
    dialogs/
      worktree-delete-dialog.ts
      worktree-name-input.ts
    search/
      quick-open.ts                # QuickOpenPalette + scoring
      content-search.ts            # ContentSearchPanel
  agent-chat/
    shell.ts                       # AgentChatShell component
    types.ts                       # ComposerHandlers, AnchorRect
    thread-header.ts
    readiness.ts                   # provider readiness surface
    start-surface.ts               # new-thread start surface + description
    prompt-card.ts
    transcript/
      session.ts                   # createAgentSession + grouping + skeleton/empty
      agent-turn.ts                # AgentSessionTurn + per-answer actions
      user-turn.ts                 # user/attachment bodies
      reasoning.ts
      working-indicator.ts
      markdown.ts                  # markdown-it setup + render helpers (E2 cache point)
      tool-log.ts                  # tool turns, activity group, files-changed, summaries
      tool-diff.ts                 # editDiffLines/parsePatchLines/lineDiff
      file-chip.ts
    composer/
      composer.ts                  # createComposer + send/stop + stack
      steer-queue.ts               # queued steer stack + queued rows
      attachments.ts               # paste handling + image attach
      context-chips.ts             # chips, chip icons, chip popover
      choice-surface.ts            # menus surface + rows + icons
      usage-meter.ts
```

### Styles — `desktop/renderer/`

```
renderer/
  tide-product-shell.css           # @import index, order-preserving
  styles/
    base.css                       # tokens, dark theme, syntax palettes, scrollbars
    app-chrome.css                 # columns, top bar, traffic, toggles, resize handles
    left-rail.css                  # sections, project groups, thread rows, rail menus
    chat-transcript.css            # transcript, markdown, code blocks, tool log, reasoning
    composer.css                   # composer, chips, choice surfaces, steer queue, usage
    workbench.css                  # tab strip, split mode, fullscreen, pane chrome
    panes.css                      # browser/editor/markdown/diff/terminal/launcher panes
    file-tree.css
    dialogs.css                    # worktree dialogs, quick-open, content-search, settings modal
```

### Desktop state — `desktop/application/domains/`

```
product-shell/
  product-shell-state.ts           # barrel (re-export only)
  state/
    types.ts                       # state/view-model/command types + defaults
    create.ts                      # createProductShellState + initial data
    view-model.ts                  # createProductShellViewModel + view builders
    thread-list.ts                 # open/rename/pin/archive/sort/project grouping
    workbench.ts                   # pane focus/close/editor/browser/terminal ops
    file-tree.ts
    composer-bridge.ts             # composer plumbing delegating to agent-chat
    search.ts                      # quick-open / content-search commands
    start.ts                       # new-thread/scratch start, preferred composer
    settings.ts                    # list/worktree settings, settings dialog
    events.ts                      # applyProductShellBackendEvent + routing guards
  workbench-split-tree.ts          # (already extracted, unchanged)
agent-chat/
  agent-chat-shell-state.ts        # barrel (re-export only)
  state/
    types.ts
    create.ts
    composer.ts                    # draft/attachments/chips/submit/queue/interrupt
    choice-surfaces.ts             # agent/model/effort/permission/project/worktree/branch menus
    launch-options.ts
    prompt.ts
    events.ts                      # applyAgentChatBackendEvent
    view-model.ts
```

### Electron main — `desktop/main/`

```
main/
  electron-main.ts                 # bootstrap + IPC wiring only
  backend-bridge.ts                # backend process lifecycle + request/broadcast plumbing
  project-registry.ts              # registry file + git context helpers
  main-window.ts                   # window creation + renderer URL + app data root
  app-menu.ts
  move-to-applications.ts
  runtime-smoke.ts                 # electron runtime smoke driver
  window-navigation-policy.ts      # (existing — do not weaken)
  provider-command-discovery.ts    # (existing)
```

### Backend — `src/backend/`

```
application/services/
  thread/        # thread-runtime-service, thread-crud, thread-persistence,
                 # thread-store, thread-snapshot, thread-runtime-clone,
                 # thread-runtime-events, fixture-agent-session-reader
  workbench/     # workbench-runtime, -command-handler, -command-data, -snapshot,
                 # -file/-exec/-browser-operations, -launcher, unavailable-workspace-ports
  tide-mcp/      # tide-mcp-tool-handler, tide-mcp-output
  provider/      # provider-session-discovery, runtime-readiness-registry
  support/       # service-result, service-value-helpers, record-helpers, diff-text
adapters/inbound/contract-message-adapter/
  backend-contract-message-adapter.ts  # dispatch switch only
  routes/        # thread-routes, composer-routes, workbench-routes,
                 # workspace-routes, provider-routes, error-codes
infrastructure/node/
  live-backend.ts                  # wiring only
  live-projector.ts                # projector closure (extracted)
  provider-adoption.ts             # session-ref discovery/adoption wiring
```

## Flow (slices, each committed green)

1. CSS split (`styles/` + index) — selector-uniqueness check + screenshot.
2. `tide-product-shell.ts` → `product-shell/` (sub-slices: workbench panes,
   left rail, dialogs/search/settings, shell/layout rest).
3. `agent-chat-shell.ts` → `agent-chat/`.
4. `product-shell-state.ts` → `product-shell/state/`.
5. `agent-chat-shell-state.ts` → `agent-chat/state/`.
6. `electron-main.ts` → `main/` modules.
7. Backend: services grouping; contract-adapter routes; live-projector
   extraction; thread-runtime-service collaborator move (per existing spec).
8. Ratchet pins lowered/deleted; `system-overview.md` + `specs/README.md`
   refreshed; this spec marked Implemented.

## Invariants

- Suite + typecheck green after every slice; no test assertions change (only
  import paths inside tests, when a barrel is insufficient).
- Focus/binding invariants (`runtime-mental-model.md`) untouched.
- `window-navigation-policy` untouched.
- Concatenated `styles/*.css` in import order ≡ original CSS modulo
  cascade-safe regrouping (verified by duplicate-selector report).
- No module-level mutable singleton is duplicated across modules.
- No import cycles among new modules (leaf-ward direction).

## Tests

- Existing 684-test suite is the behavior net (markup-level tests travel free
  via barrels).
- `tests/file-size-ratchet.test.ts`: pins go down per slice; stale-entry test
  forces pin removal once a file drops under 800.
- After renderer slices: `npm run test:smoke:electron` (real app, fake
  provider) + dev-harness screenshot compare.

## Implementation Notes

- React is `createElement`-style in `.ts` files — moved modules keep `.ts`.
- Shared mutable state found during cutting (e.g. `terminalOutputSinks`,
  `markdownRenderer`, xterm constructor resolution) must land in exactly one
  leaf module and be imported elsewhere.
- Import repair loop: cut → typecheck → add imports/exports from the original
  file's import map; iterate until clean. No logic edits during repair.
