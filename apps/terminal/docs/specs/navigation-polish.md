# Spec: Navigation Polish

## Overview

### As-Is

`MacosWindow::new()` in `crates/tide-app/src/adapter/outward/platform_adapter/macos/window.rs` constructs a transparent-titlebar `NSWindow`, but it does not explicitly set any `collectionBehavior` for Spaces, Stage Manager, or the `Full-Screen Space` path. `toggleFullScreen:` still works, but Tide leaves the native full-screen role to AppKit defaults instead of marking the `Tide Window` as the primary full-screen window.

`Cmd+Shift+O` opens `FileFinder` through `GlobalAction::FileFinder`. Before this polish pass, `open_file_finder_with_replace()` in `crates/tide-app/src/application/services/file_ops_service/mod.rs` did more than show the modal: it recursively scanned files and also read workspace files immediately to build `workspace_symbols` before the `ModalStack` was shown. That meant the open gesture paid the full file-scan and workspace-symbol indexing cost up front.

`ActionService::handle_action()` in `crates/tide-app/src/application/services/action_service/mod.rs` already uses modifier-click affordances for `Terminal` URL/file extraction, and LivePreviewMode link clicks also route through `extract_url_at()`. But `Editor Pane` modifier-click currently falls through to plain cursor placement. Tide has no `Editor Pane` affordance that turns a clicked identifier into symbol navigation, while VS Code's default editor navigation uses `Cmd/Ctrl+Hover` and `Cmd/Ctrl+Click` for definition-style navigation and keeps `@` / `#` symbol search close to Quick Open.

### To-Be

`Tide Window` explicitly opts into the system full-screen role by marking the native `NSWindow` as a managed primary full-screen window. Tide still uses AppKit's native `toggleFullScreen:` path, but the `Full-Screen Space` behavior is now explicit instead of defaulted.

`FileFinder` opens with file entries and current-file symbol data only. Workspace symbol indexing becomes lazy: Tide builds `workspace_symbols` the first time the user actually enters `WorkspaceSymbols` mode. The modal appears first, and the heavy workspace-symbol pass is deferred until the user asks for `#` symbol search.

`Editor Pane` modifier-click on an identifier opens `FileFinder` with a seeded symbol query instead of only moving the cursor. If the current file already has symbol signatures matching the identifier, Tide seeds `@identifier`; otherwise it seeds `#identifier`. Markdown link activation and terminal URL/file extraction keep their existing higher-priority behavior.

### Approach

1. Add behavior coverage for native full-screen collection behavior, deferred `FileFinder` workspace-symbol indexing, and modifier-click seeded symbol search.
2. Refactor `FileFinder` construction so current-file symbols and workspace symbols are built separately, and add a lazy-load flag to avoid rebuilding an empty workspace index on every query.
3. Add a seeded-query `FileFinder` open path and call it from `Editor Pane` modifier-click handling.
4. Explicitly set native `NSWindow` collection behavior for managed primary full-screen handling during window construction.

## Bounded Contexts

| Context | Role |
|---------|------|
| `platform` | Owns native `NSWindow` construction and full-screen behavior for the `Tide Window`. |
| `application/services/file_ops_service` | Builds `FileFinder` state and lazy workspace-symbol data. |
| `application/services/action_service` | Resolves modifier-click behavior for `Editor Pane` navigation. |
| `domain/modal` | Owns `FileFinder` state, query seeding, and workspace-symbol lazy-load flags. |

## Use Cases

### UC-1: PreserveSystemFullScreenBehavior

- **Actor**: User
- **Trigger**: Toggle full screen for a `Tide Window`
- **Precondition**: The native window exists
- **Flow**:
  1. Tide constructs the native `NSWindow`.
  2. Tide marks it as a managed primary full-screen window before user full-screen entry.
  3. AppKit handles the system full-screen transition.
- **Postcondition**: The `Tide Window` uses the system full-screen role explicitly.
- **Business Rules**:
  - BR-1: The native `NSWindow` must include managed collection behavior.
  - BR-2: The native `NSWindow` must include primary full-screen collection behavior.
  - BR-3: The native `NSWindow` must include primary Stage Manager/full-screen behavior on supported macOS versions.

### UC-2: OpenFileFinderWithoutWorkspaceSymbolPreload

- **Actor**: User
- **Trigger**: Open `FileFinder` with `Cmd+Shift+O` or `GlobalAction::FileFinder`
- **Precondition**: Tide can resolve a base directory and file list
- **Flow**:
  1. Tide scans file entries and current-file symbols.
  2. Tide opens `FileFinder` immediately.
  3. Tide defers workspace-symbol indexing until `FileFinderMode::WorkspaceSymbols` is requested.
- **Postcondition**: `FileFinder` is visible before workspace symbol indexing is needed.
- **Business Rules**:
  - BR-4: Opening `FileFinder` must not preload workspace symbols.
  - BR-5: `FileFinder` must build workspace symbols lazily when `WorkspaceSymbols` mode is first requested.
  - BR-6: Once lazy loading runs, Tide must remember that the workspace-symbol index is loaded even if the result set is empty.

### UC-3: GoToDefinitionFromModifierClick

- **Actor**: User
- **Trigger**: Cmd/Ctrl-click an identifier or import path inside an `Editor Pane`
- **Precondition**: The click is not on a rendered Markdown link and the token under the click is non-empty
- **Flow**:
  1. If the click lands on an import/file-path link, Tide opens that file directly.
  2. Otherwise Tide resolves the clicked identifier and jumps to its definition: the language server when one serves the file, else a definition in the current file, else the first workspace-symbol definition.
- **Postcondition**: The caret jumps to (or the file opens at) the definition. The `FileFinder` palette never opens.
- **Business Rules**:
  - BR-7: `Editor Pane` modifier-click on a symbol defined in the current file jumps to that definition in place — it does not open the palette.
  - BR-8: `Editor Pane` modifier-click on a symbol defined in another file opens that file at the definition — it does not open the palette.
  - BR-9: Modifier-click on an import/file-path link opens that file, keeping its higher priority over symbol definition.

## Invariants

1. `FileFinder` remains the single modal navigation entry point for file and symbol search.
2. Lazy workspace-symbol indexing must not change plain file search results.
3. `Editor Pane` modifier-click must not bypass Markdown link activation.

## Tests

| UC | BR | Test |
|----|----|------|
| UC-1 | BR-1, BR-2, BR-3 | `macos_window_marks_tide_window_as_managed_primary_full_screen_window` |
| UC-2 | BR-4 | `opening_file_finder_defers_workspace_symbol_indexing` |
| UC-2 | BR-5, BR-6 | `workspace_symbol_mode_loads_symbol_index_once_on_demand` |
| UC-3 | BR-7 | `modifier_click_on_local_editor_symbol_jumps_in_file_without_palette` |
| UC-3 | BR-8 | `modifier_click_on_cross_file_editor_symbol_opens_definition_file_without_palette` |
| UC-3 | BR-9 | `modifier_click_on_live_preview_link_keeps_link_activation` |

## Location

| Layer | Path |
|-------|------|
| Spec | `docs/specs/navigation-polish.md` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/navigation_polish_behavior.rs` |
| FileFinder state | `crates/tide-app/src/domain/modal/mod.rs` |
| FileFinder service | `crates/tide-app/src/application/services/file_ops_service/mod.rs` |
| Action routing | `crates/tide-app/src/application/services/action_service/mod.rs` |
| macOS window | `crates/tide-app/src/adapter/outward/platform_adapter/macos/window.rs` |
