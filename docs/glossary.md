# Glossary — Ubiquitous Language

Terms used consistently across the Tide codebase. When adding new code, use these terms exactly.

All paths below are relative to `crates/tide-app/src/`.

## Entities (have identity)

| Term | Type | Location | Description |
|------|------|----------|-------------|
| **Pane** | `PaneKind` | `domain/pane/mod.rs` | A content container identified by `PaneId`. Can be Terminal, Editor, Diff, Browser, or Launcher. |
| **PaneId** | `u64` | `domain/core_types.rs` | Unique identity of a pane. Allocated incrementally by `SplitLayout::alloc_id()`. |
| **Workspace** | `Workspace` | `application/services/workspace_infra_service/mod.rs` | An isolated set of panes + layout + focus. Only one is active at a time. |
| **TabGroup** | `TabGroup` | `domain/layout/tab_group.rs` | Multiple panes stacked in one layout slot. Only the active tab renders. |
| **Terminal** | `Terminal` | `domain/terminal/mod.rs` | A PTY backend instance. Owns the shell process and grid state. |
| **TerminalContext** | `TerminalContext` | `domain/pane/mod.rs` | Lightweight cached terminal state (cwd, git_info, shell_idle, etc.) separated from the heavy PTY backend. Can outlive the terminal. |
| **EditorState** | `EditorState` | `domain/editor/mod.rs` | A text buffer with cursor, undo stack, and syntax highlighting. |
| **LspClient** | `LspClient` | `adapter/outward/lsp_adapter/client.rs` | Manages communication with one language server process via JSON-RPC over stdio. |
| **LspManager** | `LspManager` | `adapter/outward/lsp_adapter/manager.rs` | Owns all LspClient instances (one per language). Orchestrates start/stop and request routing. |
| **CompletionPopup** | `CompletionState` | `domain/pane/editor_completion.rs` | Per-EditorPane inline autocomplete dropdown. NOT part of ModalStack — coexists with typing. |

## Value Objects (identity-less, compared by value)

| Term | Type | Location | Description |
|------|------|----------|-------------|
| **Rect** | `Rect` | `domain/core_types.rs` | `{x, y, width, height}` — a positioned rectangle. |
| **Size** | `Size` | `domain/core_types.rs` | `{width, height}` — dimensions without position. |
| **Key** | `Key` | `domain/core_types.rs` | A keyboard key (`Char('a')`, `Enter`, `F(1)`, etc.). |
| **Modifiers** | `Modifiers` | `domain/core_types.rs` | `{shift, ctrl, alt, meta}` — modifier key state. |
| **Hotkey** | `Hotkey` | `domain/input/mod.rs` | A `Key` + `Modifiers` combination that maps to a `GlobalAction`. |
| **Color** | `Color` | `domain/core_types.rs` | RGBA float color. |
| **TextStyle** | `TextStyle` | `domain/core_types.rs` | Bold/dim/italic/underline + fg/bg color. |
| **TerminalCell** | `TerminalCell` | `domain/core_types.rs` | One character + its `TextStyle`. |
| **TerminalGrid** | `TerminalGrid` | `domain/core_types.rs` | 2D array of `TerminalCell` — the terminal's visible content. |
| **CursorState** | `CursorState` | `domain/core_types.rs` | Position + visibility + shape of a terminal cursor. |
| **DropTarget** | `DropTarget` | `domain/core_types.rs` | Where a dragged pane can land: `Pane(id, zone)` or `Root(zone)`. |

## Aggregates (consistency boundaries)

| Term | Root Entity | Description |
|------|-------------|-------------|
| **App** | `App` | The top-level aggregate. Owns all panes, layout, focus, modals, workspaces. All mutations go through App methods. |
| **SplitLayout** | `SplitLayout` | The binary tree of splits and tab groups. Enforces layout invariants (min ratio, tree balance). |
| **WorkspaceManager** | `WorkspaceManager` | Owns the workspace list and active index. Swaps layout/panes/focus on switch. |
| **ModalStack** | `ModalStack` | Mutually-exclusive popups. At most one modal is open at a time. |

## Domain Events (things that happened)

| Term | Type | Location | Description |
|------|------|----------|-------------|
| **PlatformEvent** | `PlatformEvent` | `adapter/outward/platform_adapter/mod.rs` | Raw OS event: key press, mouse click, resize, IME commit, etc. |
| **InputEvent** | `InputEvent` | `domain/core_types.rs` | Normalized input: `KeyPress`, `MouseClick`, `MouseScroll`, `Resize`. |

## Commands (intent to mutate)

| Term | Type | Location | Description |
|------|------|----------|-------------|
| **GlobalAction** | `GlobalAction` | `domain/input/mod.rs` | A user-intent command: `SplitVertical`, `ClosePane`, `Navigate(Up)`, `ToggleZoom`, etc. 31 variants. |
| **Action** | `Action` | `domain/input/mod.rs` | Routing decision: `RouteToPane(id)`, `GlobalAction(...)`, `DragBorder(pos)`, or `None`. |
| **EditorAction** | `EditorAction` | `domain/editor/input.rs` | Editor-specific command: `InsertChar`, `Backspace`, `Save`, `Undo`, etc. |
| **WindowCommand** | `WindowCommand` | `adapter/outward/platform_adapter/mod.rs` | App→window command: `RequestRedraw`, `SetFullscreen`, `CreateImeProxy`, etc. |

## Associations

| Term | Type | Description |
|------|------|-------------|
| **Terminal Context** | concept | A Terminal acts as the context provider (cwd source of truth) for its associated non-terminal Panes. |
| **Associated Terminal** | `Option<PaneId>` | The Terminal that provides cwd context for a non-terminal Pane. Set at Pane creation time. |
| **Retained Context** | `HashMap<PaneId, TerminalContext>` | A closed Terminal's TerminalContext. Removed from UI but its context data is retained for associated Panes. Cleaned up when all associated Panes are closed. |

## Domain Concepts

| Term | Type | Description |
|------|------|-------------|
| **FocusArea** | `FocusArea` | Which region has keyboard focus: `FileTree`, `Stage`, or `Dock`. |
| **AreaSlot** | `AreaSlot` | Positional slot (`Slot1`/`Slot2`/`Slot3`) for Cmd+1/2/3 focus cycling. |
| **Direction** | `Direction` | `Up`/`Down`/`Left`/`Right` for pane navigation. |
| **SplitDirection** | `SplitDirection` | `Horizontal` (top/bottom) or `Vertical` (left/right) split. |
| **DropZone** | `DropZone` | Which edge of a pane to drop on: `Top`/`Bottom`/`Left`/`Right`/`Center`. |
| **PaneKind** | enum | The 5 content types: `Terminal`, `Editor`, `Diff`, `Browser`, `Launcher`. |
| **CursorShape** | enum | Terminal cursor appearance: `Block`, `Beam`, `Underline`. |
| **CompletionItem** | struct | A single completion suggestion: label, kind, insertText, sortText. |
| **Generation** | `u64` | Monotonic counter for cache invalidation. Incremented on state change. |
| **Ratio** | `f32` | Split position (0.0–1.0). Clamped to [0.1, 0.9] minimum. |
| **Cell Size** | `Size` | Pixel dimensions of one terminal character cell (font-dependent). |
| **Pinned Pane** | concept | A dock pane marked as pinned. Visible from all terminals within the workspace, displayed in a dedicated pinned TabGroup on the left side of the dock when viewed from a non-owning terminal. |

## Infrastructure Concepts

| Term | Description |
|------|-------------|
| **PTY** | Pseudo-terminal. The OS mechanism connecting Tide to a shell process. |
| **Sync Thread** | Background thread that copies terminal grid data, converts colors, and diffs changes. |
| **Render Thread** | Dedicated background thread (`adapter/outward/renderer_adapter/render_thread.rs`) for GPU drawable acquisition and frame submission. Decouples CAMetalLayer blocking from the main App thread. |
| **IME Proxy** | Per-pane `NSTextInputClient` view for Input Method Editor composition. |
| **Glyph Atlas** | GPU texture cache of rendered font glyphs (MSDF format). |
| **Dirty Tracking** | Generation-based system to skip re-rendering unchanged panes/chrome. |
| **WrapMap** | Cached mapping from logical lines to visual rows for soft-wrap rendering. Built per EditorPane when soft wrap is active. |
| **Soft Wrap** | Automatic line wrapping at viewport width. Enabled for prose files (`.md`, `.txt`). Line numbers only on first visual row. |
