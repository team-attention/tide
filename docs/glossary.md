# Glossary — Ubiquitous Language

Terms used consistently across the Tide codebase. When adding new code, use these terms exactly.

All paths below are relative to `crates/tide-app/src/`.

## Entities (have identity)

| Term | Type | Location | Description |
|------|------|----------|-------------|
| **Pane** | `PaneKind` | `domain/pane/mod.rs` | A content container identified by `PaneId`. Can be Terminal, Editor, Diff, Browser, or Launcher. |
| **PaneId** | `u64` | `domain/core_types.rs` | Unique identity of a pane. App-created Workspaces must keep `PaneId` unique across all live and cold-stored Workspaces; each loaded `SplitLayout` rebases its allocator above the current global maximum before creating more panes. |
| **TideWindowId** | `TideWindowId` | `domain/core_types.rs` | Unique identity of a `Tide Window` inside one `Tide Instance`. Platform commands carry this id so the main thread mutates the addressed native window. |
| **Markdown Pane** | `PaneKind::Editor` | `domain/pane/editor.rs` | An Editor Pane backed by a Markdown file. Supports authoring mode, preview-only mode, LivePreviewMode, and split preview behavior. |
| **Workspace** | `Workspace` | `application/services/workspace_infra_service/mod.rs` | An isolated set of panes + layout + focus. Only one is active at a time. |
| **TabGroup** | `TabGroup` | `domain/layout/tab_group.rs` | Multiple panes stacked in one layout slot. Only the active tab renders. |
| **Terminal** | `Terminal` | `domain/terminal/mod.rs` | A PTY backend instance. Owns the shell process and grid state. |
| **TerminalContext** | `TerminalContext` | `domain/pane/mod.rs` | Lightweight cached terminal state (cwd, git_info, shell_idle, etc.) separated from the heavy PTY backend. Can outlive the terminal. |
| **EditorState** | `EditorState` | `domain/editor/mod.rs` | A text buffer with cursor, undo stack, and syntax highlighting. |
| **LspClient** | `LspClient` | `adapter/outward/lsp_adapter/client.rs` | Manages communication with one language server process via JSON-RPC over stdio. |
| **LspManager** | `LspManager` | `adapter/outward/lsp_adapter/manager.rs` | Owns all LspClient instances (one per language). Orchestrates start/stop and request routing. |
| **CompletionPopup** | `CompletionState` | `domain/pane/editor_completion.rs` | Per-EditorPane inline autocomplete dropdown. NOT part of ModalStack — coexists with typing. |
| **BrowserSnapshot** | `BrowserSnapshot` | `domain/pane/browser.rs` | Cached page text and page metadata captured from a Browser Pane's `WKWebView` bridge for Agent Gateway observe commands. |
| **WorktreeInfo** | `WorktreeInfo` | `domain/terminal/git.rs` | Cached git worktree metadata for a working directory, including its `path`, `branch`, `is_main`, and `is_current` flags. |

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
| **WebViewTarget** | `WebViewTarget` | `adapter/outward/platform_adapter/macos/webview.rs` | Value key for Browser Pane native state owned by one `Tide Window`, combining `TideWindowId` and `PaneId`. |

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
| **GlobalAction** | `GlobalAction` | `domain/input/mod.rs` | A user-intent command: `SplitVertical`, `ClosePane`, `Navigate(Up)`, `DockNavigate(Right)`, etc. 41 enum variants. |
| **HeaderHitAction** | `HeaderHitAction` | `adapter/outward/view/header.rs` | A click action exposed by Pane header or TabGroup chrome. Tide resolves it through header hit zones instead of raw coordinate checks. |
| **HeaderActionStrip** | `HeaderActionSpec` + render helpers | `adapter/outward/view/header.rs` | The visible-header right-aligned control cluster that exposes mouse-first Pane creation and split actions. |
| **Action** | `Action` | `domain/input/mod.rs` | Routing decision: `RouteToPane(id)`, `GlobalAction(...)`, `DragBorder(pos)`, or `None`. |
| **EditorAction** | `EditorAction` | `domain/editor/input.rs` | Editor-specific command: `InsertChar`, `Backspace`, `Save`, `Undo`, etc. |
| **WindowCommand** | `WindowCommand` | `adapter/outward/platform_adapter/mod.rs` | App→window command: `RequestRedraw`, `SetFullscreen`, `CreateImeProxy`, etc. |

## Associations

| Term | Type | Description |
|------|------|-------------|
| **Terminal Context** | concept | A Terminal acts as the context provider (cwd source of truth) for its associated non-terminal Panes. |
| **Associated Terminal** | `Option<PaneId>` | The Terminal that provides cwd context for a non-terminal Pane. Set at Pane creation time. |
| **Retained Context** | `HashMap<PaneId, TerminalContext>` | A closed Terminal's TerminalContext. Removed from UI but its context data is retained for associated Panes. Cleaned up when all associated Panes are closed. |
| **Paired Agent** | concept | The agent process running in the Terminal associated with a source Pane. Context Artifacts are delivered only to this agent. |
| **Pinned Context** | concept | A Context Artifact marked for later explicit retrieval by the paired agent. |
| **Artifact Delivery** | concept | The one-way handoff from a source Pane's Context Artifact to its paired agent. In V1 this includes owner-scoped gateway events and, when the paired Terminal is live, formatted Terminal input injection. |

## Domain Concepts

| Term | Type | Description |
|------|------|-------------|
| **FocusArea** | `FocusArea` | Which region has keyboard focus: `FileTree`, `Stage`, or `Dock`. |
| **AreaSlot** | `AreaSlot` | Positional FocusArea slot (`Slot1`/`Slot2`/`Slot3`/`Slot4`). Default visibility shortcuts use named GlobalActions instead of relying on every slot having a numeric key. |
| **Direction** | `Direction` | `Up`/`Down`/`Left`/`Right` for pane navigation. |
| **SplitDirection** | `SplitDirection` | `Horizontal` creates top/bottom panes; `Vertical` creates left/right panes. |
| **DropZone** | `DropZone` | Which edge of a pane to drop on: `Top`/`Bottom`/`Left`/`Right`/`Center`. |
| **PaneKind** | enum | The 5 content types: `Terminal`, `Editor`, `Diff`, `Browser`, `Launcher`. |
| **CursorShape** | enum | Terminal cursor appearance: `Block`, `Beam`, `Underline`. |
| **CompletionItem** | struct | A single completion suggestion: label, kind, insertText, sortText. |
| **Generation** | `u64` | Monotonic counter for cache invalidation. Incremented on state change. |
| **LivePreviewMap** | struct | A data structure that maps raw-buffer byte ranges to markdown element types (inline bold, heading, code block, etc.) and classifies which bytes are syntax markers vs content. Built from pulldown_cmark source-span offsets. Used by LivePreviewMode to determine which characters to hide or style. |
| **LivePreviewMode** | concept | A third editor rendering mode alongside Plain (raw markdown with syntax highlighting) and Preview (read-only formatted rendering). In LivePreviewMode, inline markdown syntax (e.g. `**`, `_`, backticks) is hidden on lines where the cursor is absent and revealed on the cursor's line. Block-level elements (code blocks, tables, blockquotes) always show syntax but apply visual styling. Operates in the same coordinate space as the raw buffer — no line folding. |
| **EditorBadge** | `EditorBadge` | Shared editor-chrome label data computed in `adapter/outward/view/header.rs` and rendered in both Pane headers and TabGroup chrome. Carries visible badge text plus optional `HeaderHitAction` interactivity. |
| **Editor Chrome** | concept | The non-document UI surrounding an Editor Pane, including the Pane header, TabGroup chrome, gutter, current-line emphasis, and related status or mode affordances. |
| **FileTreeModel** | `FileTreeModel` | State for the FileTree chrome: root tree, scroll, cursor, and cached git status used to render FileTree rows. |
| **FileTree Cursor Row** | concept | The FileTree row addressed by `FileTreeModel.cursor`. Tide renders keyboard-selection chrome on this row only when the FileTree has explicit keyboard focus, not merely when FileTree View is visible. |
| **Expanded Directory Row** | concept | A FileTree row for a directory whose `TreeEntry.is_expanded` is true. Tide renders open-directory chrome on this row even when it is not the `FileTree Cursor Row`. |
| **TitlebarSurfaceIcon** | `TitlebarSurfaceIcon` | `adapter/outward/view/chrome/titlebar.rs` | A vector icon drawn for the titlebar surface toggles. It avoids font-dependent private glyphs for Workspace rail, Dock, and FileTree View controls. |
| **Terminal Context Surface** | concept | The Dock region attached to one Stage Terminal. In Split view it is backed by that Terminal's context `SplitLayout`; in Stacked view it renders one active context Pane with a flat tab bar over all context Panes. It can show Browser Pane, Diff, Editor, Launcher, secondary Terminal, or Render Pane. It does not contain a pinned group or FileTree View. |
| **Terminal Context TabGroup** | legacy concept | The old flat-only name for Terminal Context Surface. Use Terminal Context Surface for new behavior and specs. |
| **FileTree View** | concept | A `FileTreeModel`-backed right-side chrome view toggled by `ToggleFileTree`. It is independent from Terminal Context Surface, can use `FocusArea::FileTree` only when explicitly focused for keyboard routing, and follows the focused Stage Terminal's working directory through the existing FileTree root update path. It is not a `PaneKind` in V1. |
| **Ratio** | `f32` | Split position (0.0–1.0). Clamped to [0.1, 0.9] minimum. |
| **Cell Size** | `Size` | Pixel dimensions of one terminal character cell (font-dependent). |
| **Context Artifact** | concept | A Workspace-local record of an optional captured Pane selection plus an optional user comment. Bound to a source PaneId and its Associated Terminal. |
| **Source Label** | `String` | A human-readable origin label stored on a `Context Artifact` and used in paired-agent delivery text. `Editor` Panes prefer file paths; other Pane kinds use their most useful user-facing location label. |
| **Pinned Pane** | legacy concept | A removed Dock model where a context Pane could appear in a global pinned group. Terminal Context Surface does not expose pinned Pane behavior; legacy pin actions are compatibility no-ops. |
| **Browser Pane** | `PaneKind::Browser` | A Pane backed by a native `WKWebView`. Can run in navigation mode with a URL bar or in render mode for agent-provided HTML. |
| **Browser Pane V2** | concept | A later capability track for Browser Pane work that goes beyond Browser Pane UX hardening, including in-app download management, stronger credential integration, and deeper browser session behavior. |
| **GitSwitcher** | `GitSwitcherState` | Popup state that lists git worktrees for a Terminal Pane, tracks filtering and selection, and marks the current worktree row. |
| **Search Bar** | concept | A Pane-scoped inline text input identified by `FocusState.search_focus`. When active it takes text-input priority over the underlying Pane. |
| **FileFinder** | `FileFinderState` | Tide's modal navigation palette opened by `GlobalAction::FileFinder`. It can search files, current-file symbols, workspace symbols, or workspace text hits depending on `FileFinderMode`. |
| **FileFinderMode** | `FileFinderMode` | The active search mode of `FileFinder`: `Files`, `Symbols`, `WorkspaceSymbols`, or `WorkspaceSearch`. |
| **SymbolMatch** | `SymbolMatch` | A signature-style navigation result with label, relative path, and editor location. Used by `FileFinder` for current-file and workspace symbol search. |
| **WorkspaceSearchHit** | `WorkspaceSearchHit` | A workspace text-search result with relative path, line, column, and preview text. Used by `FileFinder` workspace search mode. |
| **ViewMode** | `ViewMode` | Stage presentation state: `Split` shows the `SplitLayout`; `Stacked` shows one focused Stage `Pane` full-size with a flat tab bar over all Stage split panes. |
| **Context Comment Composer** | `ContextCommentComposerState` | A `ModalStack` popup that previews the current captured Pane selection when available, accepts a user comment, and creates a `Context Artifact` for Artifact Delivery. |
| **Wrapped Agent** | concept | A coding agent process launched through a Tide `Agent Wrapper`. Only a `Wrapped Agent` may drive wrapper-managed attention such as split-`Pane` highlight or inactive-`Workspace` highlight. |
| **Wrapper-Managed Lifecycle Signal** | concept | A lifecycle update (`Running`, `Idle`, or `NeedsInput`) emitted through a Tide `Agent Wrapper` path, either by wrapper hooks or by wrapper-owned OSC 9 reporting. |
| **Wrapped Agent Presence** | concept | The wrapper-managed connected state for a direct Stage `Terminal`. Tide derives it from `wrapper_managed` plus `gateway_connected`, even when `AgentInfo.status` is `None`. |
| **Tide Instance** | concept | A single running Tide process identified by its PID and Agent Gateway socket path. Notification activation relay targets the owning `Tide Instance`, not an arbitrary bundled app launch. |
| **Notification Activation Relay** | concept | The handoff path that routes a macOS system-notification activation to the owning `Tide Instance`, then focuses the target `Pane` inside the correct `Workspace` without opening an extra Tide Window. |
| **Tide Window** | concept | One native OS window owned by one `Tide Instance`. `GlobalAction::NewWindow` creates another `Tide Window` in the same `Tide Instance`, and notification activation reveals the owning `Tide Window`. |
| **Full-Screen Space** | concept | A macOS Space occupied by a full-screen `Tide Window`. Notification activation must reveal that `Tide Window` instead of leaving focus on the desktop Space. |
| **Terminal-Owned Attention** | concept | The wrapped-agent attention projection owned only by the direct wrapped-agent `Terminal` in Stage. It renders on the owning `Terminal` chrome and on the owning `Workspace` item, but never through an `Associated Terminal` onto a non-terminal `Pane`. |
| **AgentChromeState** | `AgentChromeState` | Renderer-facing visual state for a wrapped-agent dot: `ConnectedIdle`, `Running`, or `Attention`. It is derived from `AgentStatus` plus `Wrapped Agent Presence`; it is not itself a routing state. |
| **HeaderSurfaceKind** | `HeaderSurfaceKind` | Renderer-facing classification for Pane header chrome: `Stage` for quiet primary-session chrome, or `TerminalContextSurface` for tabbed supporting-context chrome. |
| **FileIconKind** | `FileIconKind` | Renderer-facing classification for FileTree and file-finder glyphs before choosing a concrete icon character. Keeps special project files, folders, and extension families stable across views. |
| **SurfaceVisibilityAnimation** | `SurfaceVisibilityAnimation` | Pure width animation state for side surfaces such as Dock, FileTree View, and Workspace rail. It interpolates the rendered width between current and target widths without changing Pane identity. |
| **Notification Snippet** | concept | The single-line wrapped-agent response text Tide prefers for a macOS notification body. Tide derives it from structured wrapper payloads when available and otherwise falls back to the owning `Terminal`'s visible grid. |
| **NotificationAuthorizationStatus** | enum | Tide's normalized view of the OS notification-permission state for the bundled macOS app: `Unknown`, `NotDetermined`, `Denied`, `Authorized`, `Provisional`, or `Ephemeral`. Stored in `WindowState` and used only as a runtime diagnostic and chrome signal. |
| **Cascaded Tide Window Position** | concept | The native macOS placement used for newly created `Tide Window`s in one `Tide Instance`. Each new `Tide Window` is offset from the prior placement so the new title bar remains visible. |

## Architecture Concepts

| Term | Description |
|------|-------------|
| **Inward Adapter** | A driving adapter that translates external input (keyboard, mouse, CLI, etc.) into Port method calls. Lives in `adapter/inward/`. Must NOT directly mutate domain state — only call Inward Port methods. |
| **Inward Port** | A trait defining what the application can do. Lives in `application/ports/inward/`. Implemented by App via services. |
| **Outward Port** | A trait defining what the application needs from the outside world. Lives in `application/ports/outward/`. Implemented by outward adapters. |
| **Outward Adapter** | A driven adapter that implements Outward Port traits. Lives in `adapter/outward/`. Examples: GPU renderer, platform layer, file system. |
| **Port Boundary** | The compile-time enforcement point where an inward adapter receives port trait references instead of `&mut App`, preventing direct domain state access. |

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
| **Application-Rendered Prose Reflow Row** | A `Terminal Pane` row that appears visually wrapped because a TUI application rendered prose across multiple rows itself, without emulator `WRAPLINE` metadata. |
| **Agent Gateway** | Built-in subsystem for programmatic control via Unix socket. Always on, zero config. Comprises socket server, CLI client, and MCP bridge. |
| **CliCommand** | A command received from an external process via the Agent Gateway socket. Enqueued as an `AppEvent` variant for single-threaded dispatch. |
| **GatewayStatus** | Tracks Agent Gateway state: socket listening status, connected client count, active render streams. Displayed as a badge in the chrome. |
| **App Main Menu** | The native macOS `NSMenu` installed on `NSApplication`. It drives the system menu bar, including top-edge reveal inside a `Full-Screen Space`. |
| **Socket Server** | Background thread listening on a Unix domain socket (`$TMPDIR/tide-<pid>.sock`). Parses JSON-RPC 2.0 and enqueues `CliCommand` into the app event loop. |
| **Render Pane** | A Browser pane in render mode (`render_mode: true`). Displays agent-provided HTML via `loadHTMLString` instead of URL navigation. No URL bar, title shown in tab. |
| **Render Runtime** | Pre-injected HTML head (morphdom, Tailwind CSS, Tide theme CSS vars, JS bridge) loaded into every Render Pane before agent HTML. |
| **Render Stream** | A long-lived connection where an agent sends HTML chunks to a Render Pane. Each chunk is a full HTML snapshot; morphdom diffs against the current DOM. |
| **AgentStatus** | Lifecycle status of a coding agent process: `Running`, `Idle`, or `NeedsInput`. Wrapper-managed notification routing uses only `Wrapper-Managed Lifecycle Signal` updates reported by `Wrapped Agent` paths. Stored in `AgentInfo.status`. |
| **Agent Wrapper** | A shell script in `$TMPDIR/tide-<pid>-bin/` that shadows a coding agent binary (e.g. `claude`). Injects MCP server config and lifecycle hooks via `--settings`, then `exec`s the real binary. |
| **Codex App Server** | The experimental Codex JSON-RPC server launched by the Codex `Agent Wrapper` when Tide needs structured Codex lifecycle requests. The Codex TUI connects to it in remote mode, and Tide may observe server requests such as command-approval or user-input requests. |
| **Codex App Server Watcher** | A wrapper-owned helper process that connects to the `Codex App Server`, converts structured Codex server requests and thread status notifications into Tide `notify` lifecycle events, and never directly mutates Tide state. |
| **Caller Pane** | The `_caller_pane` field injected into CLI command params by the MCP bridge (from `TIDE_PANE` env var). Identifies which terminal pane originated the command, enabling cross-workspace command routing. Stripped before reaching command handlers. |
| **Cross-Workspace Routing** | The mechanism by which a CLI command targeting a pane in a non-active Workspace is executed in the correct Workspace context. Uses raw `save_active_workspace` / `load_active_workspace` swap (not `switch_workspace`) to avoid UI side effects. See `docs/specs/cli-workspace-routing.md`. |
