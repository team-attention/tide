# Source Map — "where do I change X"

The directory tree is the index: every UI area, state concern, and backend
domain has one named home. This page is the walk-through. (Structure spec:
`docs_v2/specs/navigable-source-structure.md`.)

## The three trees

```
src/
  desktop/   the Electron app: renderer UI, view state, Electron main process
  backend/   the Node utility process: threads, agent runtimes, workbench, MCP
  shared/    process-boundary contracts (DTOs + envelopes) — nothing else
```

Both `desktop/` and `backend/` have exactly the same three top-level layers
(per `electron-node-architecture-decisions.md` §Desktop Boundary):

```
adapters/         code that talks to the outside (inbound: UI/IPC; outbound: clients)
application/      the app's own logic — backend: domains + ports + services;
                  desktop: domains only (state is pure and returns command
                  objects instead of doing IO, so it needs no ports)
infrastructure/   composition roots and platform plumbing (entrypoints, processes)
```

A UI change almost always touches `desktop/` twice — once in **markup**
(`adapters/inbound/react-renderer/...`) and once in **CSS**
(`adapters/inbound/react-renderer/styles/`, right next to the markup).
Behavior changes touch the **state layer** (`application/domains/`). Anything
the agent/provider actually *does* is `backend/`.

## Worked example: "the button on a thread row in the left thread list"

1. Style → `src/desktop/adapters/inbound/react-renderer/styles/left-rail.css` (thread rows, sections,
   rail menus live here; search `.thread-row`).
2. Markup/handlers → `src/desktop/adapters/inbound/react-renderer/product-shell/left-rail/thread-row.ts`.
3. What clicking it *does* → `src/desktop/application/domains/product-shell/state/thread-list.ts`.
4. If the action goes to the backend → the command lands in
   `src/backend/adapters/inbound/contract-message-adapter/backend-contract-message-adapter.ts`
   (the dispatch switch), which calls a service under
   `src/backend/application/services/<domain>/`.

## The entry-module rule

Inside `react-renderer/`, every feature directory follows one convention:

- **`<dir>/<dir>.ts` is the entry** — the module that assembles/mounts
  everything in that directory (`product-shell/product-shell.ts` is the shell
  component; `left-rail/left-rail.ts` builds the rail; `workbench/workbench.ts`
  builds the workbench column; `transcript/transcript.ts` builds the
  transcript; `composer/composer.ts` builds the composer).
- **`contract-adapter.ts`** (where present) translates shared-contract
  envelopes ↔ that feature's state vocabulary (`agent-chat/contract-adapter.ts`,
  `app-chrome/contract-adapter.ts`).
- **Every other file is a detail module** called by the entry (rows, sections,
  panes, menus). A directory without a same-named module (e.g. `dialogs/`,
  `search/`, `state/`) is a flat bag whose pieces the parent entry mounts
  directly.

So to read any feature top-down: open `<dir>/<dir>.ts` and follow its calls.

## Desktop: view layer (`src/desktop/adapters/inbound/react-renderer/`)

| You want to change… | Go to |
|---|---|
| Shell layout, column wiring, top bar assembly | `product-shell/product-shell.ts` (the shell component + the feature's re-exported API) |
| Left rail: rows, sections, headers, context menu | `product-shell/left-rail/` (`thread-row.ts`, `project-section.ts`, `pinned-section.ts`, `thread-section.ts`, `section-header.ts`, `context-menu.ts`, `skeletons.ts`) |
| Workbench panes (browser / editor / markdown / diff / terminal / launcher) | `product-shell/workbench/` — one file per pane, entry `workbench.ts`, plus `split-view.ts`, `pane-chrome.ts`, `pane-content.ts` |
| File tree column | `product-shell/file-tree.ts` |
| Quick Open (Cmd+P) / content search (Cmd+Shift+F) | `product-shell/search/` |
| Worktree dialogs | `product-shell/dialogs/` |
| Settings modal, theme picker, list-settings persistence | `product-shell/settings.ts` |
| Window chrome toggles, traffic lights, resize handles | `product-shell/chrome.ts` |
| Column sizing math | `product-shell/layout.ts` |
| Agent monograms/icons | `product-shell/agent-identity.ts` |
| Chat transcript (turns, markdown, tool log, reasoning) | `agent-chat/transcript/` (entry `transcript.ts`, `agent-turn.ts`, `user-turn.ts`, `tool-log.ts`, `tool-diff.ts`, `markdown.ts`, `reasoning.ts`, `working-indicator.ts`, `file-chip.ts`) |
| Composer (input box, chips, menus, steer queue, usage) | `agent-chat/composer/` (`composer.ts`, `context-chips.ts`, `choice-surface.ts`, `steer-queue.ts`, `attachments.ts`, `usage-meter.ts`) |
| Thread header / provider readiness / start surface / prompt cards | `agent-chat/thread-header.ts`, `readiness.ts`, `start-surface.ts`, `prompt-card.ts` |

The chat column's root component is `agent-chat/agent-chat.ts`; backend-event/
command translation for the chat lives in `agent-chat/contract-adapter.ts`.
The workbench tab strip is `app-chrome/app-chrome.ts` (+ its
`contract-adapter.ts`). Shared leaf utilities stay at the react-renderer root:
`markdown-rendering.ts`, `code-highlight.ts`, `file-icons.ts`, `theme.ts`.

## Desktop: CSS (`src/desktop/adapters/inbound/react-renderer/`)

Styles live next to the markup adapter. `styles/index.css` is an
**ordered @import index** over `styles/` — import order preserves the cascade,
so never reorder it casually.

| Area | File |
|---|---|
| Tokens, themes, syntax palette, scrollbars, shared atoms | `styles/base.css` |
| Columns, top bar, window toggles, resize handles | `styles/app-chrome.css` |
| Thread list / left rail (incl. thread rows) | `styles/left-rail.css` |
| Transcript, markdown, tool log, reasoning | `styles/chat-transcript.css` |
| Composer, chips, choice menus, steer queue | `styles/composer.css` |
| Workbench chrome: tabs, split mode, fullscreen | `styles/workbench.css` |
| Individual panes (browser/editor/md/diff/terminal/launcher) | `styles/panes.css` |
| File tree | `styles/file-tree.css` |
| Dialogs, Quick Open, content search, settings modal | `styles/dialogs.css` |

## Desktop: view state (`src/desktop/application/domains/`)

| Concern | product-shell | agent-chat |
|---|---|---|
| Types + state shape | `product-shell/state/types.ts` | `agent-chat/state/types.ts` |
| Creation/initial state | `state/create.ts` | `state/create.ts` |
| View-model derivation | `state/view-model.ts` | `state/view-model.ts` |
| Backend-event application | `state/events.ts` (router) + appliers in their concern | `state/events.ts` |
| Thread list / rail actions | `state/thread-list.ts` | — |
| Workbench pane ops | `state/workbench.ts` (+ `workbench-split-tree.ts`) | — |
| File tree | `state/file-tree.ts` | — |
| Search commands | `state/search.ts` | — |
| New-thread/start | `state/start.ts` | `state/create.ts` |
| Settings | `state/settings.ts` | — |
| Composer plumbing | `state/composer-bridge.ts` (delegates to agent-chat) | `state/composer.ts` |
| Menus (agent/model/effort/permission/project/worktree/branch) | — | `state/choice-surfaces.ts` |
| Per-agent vocabulary (permissions, models, availability) | — | `state/agent-vocab.ts` |
| Launch options | — | `state/launch-options.ts` |
| Prompt answering | `state/composer-bridge.ts` | `state/composer.ts` |

The old `product-shell-state.ts` / `agent-chat-shell-state.ts` paths are pure
re-export barrels.

## Desktop: process shells (`src/desktop/infrastructure/electron/`)

The three Electron process surfaces are infrastructure (composition +
platform plumbing), mirroring `backend/infrastructure/node/`:

| Surface | Where |
|---|---|
| Main process | `main/` (below) |
| Preload bridge | `preload/index.ts` |
| Renderer web shell (index.html, entry, dev-harness) | `renderer/` |
| Backend process supervisor abstraction | `backend-process-supervisor.ts` |

### Main process (`infrastructure/electron/main/`)

| Concern | File |
|---|---|
| Bootstrap + all `ipcMain`/`app` wiring | `electron-main.ts` |
| Backend utility-process lifecycle, command/broadcast plumbing | `backend-bridge.ts` |
| Project registry file + git context helpers | `project-registry.ts` |
| Window creation, renderer URL | `main-window.ts` |
| Navigation guard (do not weaken) | `window-navigation-policy.ts` |
| App menu / move-to-Applications / runtime smoke hook | `app-menu.ts`, `move-to-applications.ts`, `runtime-smoke.ts` |
| Provider CLI command discovery | `provider-command-discovery.ts` |

## Backend (`src/backend/`)

| Concern | Where |
|---|---|
| Thread lifecycle, persistence, store, snapshots | `application/services/thread/` |
| Workbench command handling, file/exec/browser ops | `application/services/workbench/` |
| Tide MCP tool handling/output | `application/services/tide-mcp/` |
| Provider session discovery, readiness registry | `application/services/provider/` |
| Cross-cutting helpers (results, records, diff text) | `application/services/support/` |
| Domain models (thread, agent-runtime, agent-session, …) | `application/domains/` |
| Ports (interfaces the services need) | `application/ports/outbound/` |
| Contract command routing (the dispatch switch) | `adapters/inbound/contract-message-adapter/backend-contract-message-adapter.ts`; DTO mappers in `…/dto/`, error mapping in `…/error-codes.ts` |
| Per-provider adapters (claude/codex/gemini/opencode) | `adapters/outbound/agent-integrations/<agent>/` |
| Protocol clients (stream-json / app-server / ACP) | `adapters/outbound/agent-runtime/structured/` |
| Live wiring (composition root) | `infrastructure/node/live-backend.ts` |
| Streaming projection (provider events → blocks/persist) | `infrastructure/node/live-projector.ts` |
| External-session adoption / provider file locations | `infrastructure/node/live-provider-discovery.ts` |

## Enforcement

`tests/file-size-ratchet.test.ts` caps every new source file at 800 lines
(target ≤ 500) and pins the remaining large files so they can only shrink:
the product-shell component (1,445), `thread-runtime-service.ts` (1,996 — its
class split is specced in `thread-runtime-service-decomposition.md`), and
`live-backend.ts` (814).
