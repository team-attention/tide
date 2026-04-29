# App Orchestrator

**Role**: The Application Service that coordinates all Bounded Contexts.
All user input enters through App, and all state mutations happen through App methods.

## Aggregate: App

`crates/tide-app/src/app.rs`

App is the system's root Aggregate. State is partitioned into sub-modules:

```
App
├── panes: HashMap<PaneId, PaneKind>    ← all Pane entities
├── layout: SplitLayout                  ← arrangement Aggregate
├── focused: Option<PaneId>              ← current focus
├── focus_area: FocusArea                ← FileTree | Stage | Dock
│
├── ime: ImeState                        ← IME composition state
├── modal: ModalStack                    ← popups (mutually exclusive)
├── cache: RenderCache                   ← render cache + Generation tracking
├── interaction: InteractionState        ← mouse/drag/scroll
├── ft: FileTreeModel                    ← FileTree View + git status
└── ws: WorkspaceManager                 ← workspace list
```

## Sub-Modules

### ImeState (`domain/state/ime.rs`)
CJK input method composition state. Manages per-Pane IME proxy lifecycle.

| Field | Type | Description |
|-------|------|-------------|
| `composing` | `bool` | Whether IME composition is active |
| `preedit` | `String` | Uncommitted text |
| `last_target` | `Option<u64>` | Last pane that received IME text |
| `pending_creates` | `Vec<u64>` | IME proxies awaiting creation |
| `pending_removes` | `Vec<u64>` | IME proxies awaiting removal |
| `cursor_dirty` | `bool` | IME cursor area needs sync |

### ModalStack (`domain/modal/mod.rs`)
**Invariant: At most one open at a time.** When `is_any_open()` is true, input routes to the modal.

| Modal | Trigger | Purpose |
|-------|---------|---------|
| `file_finder` | Cmd+Shift+O | File, symbol, and workspace text search |
| `git_switcher` | Header git/worktree badge | Branch/worktree switch |
| `config_page` | Cmd+, | Settings overlay |
| `save_confirm` | Closing dirty editor | Save confirmation |
| `save_as_input` | Cmd+S on untitled Editor Pane | Save as dialog |
| `context_menu` | Right-click | Context menu |
| `file_tree_rename` | R key (FileTree View) | Inline rename |
| `context_comment_composer` | Context comment affordance | Create Context Artifact |
| `branch_cleanup` | Branch delete | Delete confirmation |

### RenderCache (`domain/state/render_cache.rs`)
Generation-based dirty tracking. Minimizes GPU re-rendering.

```
invalidate_chrome() → chrome_generation += 1
invalidate_pane(id) → pane_generations[id] += 1
needs_redraw = true → GPU work on next frame
```

### InteractionState (`domain/state/drag_types.rs`)
Mouse interaction state machine.

```
PaneDragState: Idle → PendingDrag → Dragging
                         (threshold)    (drop target computation)
```

### FileTreeModel (`domain/state/file_tree_model.rs`)
FileTree View + git status cache. CWD tracking → sticky git root.

### WorkspaceManager (`application/services/workspace_infra_service/`)
**Core pattern: Swap**
```
switch_workspace(idx):
  1. save_active_workspace()   ← App fields → Workspace[active]
  2. ws.active = idx
  3. load_active_workspace()   ← Workspace[idx] → App fields
  4. Clear all pane_generations (full redraw)
```

## Event Flow

```
PlatformEvent (from OS)
    │
    ▼
handle_platform_event()
    │
    ├── KeyDown → handle_key_down()
    │               │
    │               ├── Modal open? → modal consumes it
    │               ├── FocusArea == FileTree? → FileTree View key handling
    │               ├── Router.process() → Action
    │               │     ├── GlobalAction → handle_action()
    │               │     ├── RouteToPane → send_text_to_target()
    │               │     └── None → ignored
    │               └── Plain text? → send_text_to_target()
    │
    ├── MouseDown → handle_mouse_down()
    │               ├── hit test: which Pane/tab/button?
    │               ├── tab bar → focus or start drag
    │               └── Pane area → focus + selection start
    │
    ├── ImeCommit → handle_ime_commit()
    │               └── send_text_to_target()
    │
    └── Resized → reconfigure_surface() + compute_layout()

    ▼
update()  (every frame)
    ├── Terminal.process() — consume PTY output
    ├── File watcher — editor reload
    ├── Git poller — FileTree View status refresh
    └── Animations (scroll, cursor blink)

    ▼
render()  (when needs_redraw == true)
    └── Submit GPU frame
```

## Input Routing Priority

This order **must never be skipped** (Invariant):

```
1. config_page       (highest — blocks all input)
2. context_menu      (ESC to dismiss)
3. file_tree_rename  (text input + ESC)
4. git_switcher      (text input + arrows + ESC)
5. file_finder       (text input + arrows + ESC)
6. save_as_input     (text input + ESC)
7. context_comment_composer (text input + submit/cancel)
8. branch_cleanup    (Enter/ESC)
9. save_confirm      (ESC to cancel)
10. Completion popup (arrows + Enter/Tab + ESC)
11. FocusArea dispatch (FileTree / Stage / Dock)
12. Router.process() → GlobalAction
13. Text input → send_text_to_target()
```

## Key Methods

| Method | File | Role |
|--------|------|------|
| `handle_key_down()` | `adapter/inward/keyboard_adapter/` | Key event routing entry point |
| `handle_global_action()` | `application/services/action_service/` | GlobalAction dispatch |
| `handle_focus_area()` | `application/services/workspace_service/` | FocusArea 3-state toggle |
| `focus_terminal()` | `application/services/workspace_service/` | Pane focus + Generation update |
| `new_editor_pane()` | `application/services/pane_create_service/` | Create editor tab |
| `split_with_launcher()` | `application/services/pane_create_service/` | Split Pane |
| `close_specific_pane()` | `application/services/pane_close_service/` | Close Pane (may trigger modal) |
| `switch_workspace()` | `application/services/workspace_infra_service/` | Workspace switch (swap pattern) |
| `compute_layout()` | `layout_compute.rs` | Window size → Pane Rect calculation |
| `update()` | `application/services/update_service/` | Per-frame state update |

## Invariants

1. **PaneId sync**: `layout.pane_ids()` ⊆ `panes.keys()` ∧ `panes.keys()` ⊆ `layout.pane_ids()`
2. **Modal exclusivity**: At most 1 field in `modal` is `Some`
3. **Input routing order**: The priority chain above is never skipped
4. **Generation monotonicity**: `chrome_generation` and `pane_generations[id]` only increase within a workspace session. Exception: `pane_generations` is cleared on workspace switch (entirely new pane set loaded)
5. **Workspace isolation**: Inactive Workspace Panes are NOT in App.panes
6. **IME proxy sync**: The focused Pane always has an active IME proxy
