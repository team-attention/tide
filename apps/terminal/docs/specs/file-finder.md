# Spec: File Finder

## Overview

### As-Is
`GlobalAction::FileFinder` in `crates/tide-app/src/domain/input/mod.rs` opens one floating `FileFinder` modal through `open_file_finder()` in `crates/tide-app/src/application/services/file_ops_service/mod.rs`. The default keybinding is `Cmd+Shift+O`.

`FileFinderState` in `crates/tide-app/src/domain/modal/mod.rs` now supports four modes: plain file search, `@` current-file symbols, `#` workspace symbols, and `/` workspace text search. File search uses path ranking, current-file symbols are gathered when the modal opens, workspace symbol indexing is lazy and runs only after `WorkspaceSymbols` mode is requested, and workspace text search is query-driven. Keyboard selection and pointer activation both resolve a `FileFinderDestination`, so clicking a visible row opens that clicked destination.

`FileFinderState` owns `scroll_offset`, but `scroll_adapter` routes wheel events only to config page, git switcher, tab bars, FileTree View, or the Pane under the pointer. A wheel event over the `FileFinder` popup therefore does not scroll the result list.

The default file list was path-sorted directly from `scan_dir()`. That put hidden/tooling paths such as `.DS_Store`, `.claude/...`, and `.codex/...` before ordinary project files. File rows also rendered only the basename as primary text, which made duplicate names such as `SKILL.md` look indistinguishable.

### To-Be
`FileFinder` remains Tide's single navigation entry point, but it behaves more like a Quick Open palette:

- plain text searches files with a better path-ranking rule
- `@query` searches `SymbolMatch` items in the focused `Editor Pane`
- `#query` searches `SymbolMatch` items across the workspace snapshot
- `/query` searches `WorkspaceSearchHit` text matches across the workspace

Selection remains predictable:

- selecting a current-file `SymbolMatch` moves the cursor inside the focused `Editor Pane`
- selecting a workspace `SymbolMatch` opens its file and jumps to the symbol line
- selecting a `WorkspaceSearchHit` opens its file and jumps to the hit line
- clicking a visible `FileFinder` row opens that clicked destination, even when the keyboard selection is elsewhere
- wheel and trackpad scroll over the `FileFinder` popup scroll the result list
- empty file search shows ordinary project files before hidden/tooling paths
- file result rows show a compact relative path as the primary label so duplicate basenames remain distinguishable
- symbol and text-search rows separate the primary label from path or line metadata so the list scans like a navigation palette

### Approach
1. Keep `GlobalAction::FileFinder` and the existing modal surface instead of adding a second navigation popup.
2. Extend `FileFinderState` with `FileFinderMode`, symbol datasets, and destination-aware selection.
3. Precompute current-file `SymbolMatch` data when the modal opens and load workspace `SymbolMatch` data lazily on the first `WorkspaceSymbols` query.
4. Keep workspace text search capped and query-driven so the palette stays responsive.
5. Render mode-aware placeholders and result rows so the user can see which navigation model is active before pressing Enter.
6. Make pointer activation resolve the clicked filtered row, not the stale selected row.
7. Route popup-local wheel events to `FileFinderState::scroll_by_lines()` before pane-level scroll routing.
8. Sort default file entries with a `FileFinder`-specific comparator: visible paths first, then hidden/tooling paths, each ordered by relative path.
9. Render file rows as relative paths, and render symbol/text rows as primary text plus muted location metadata.

## Bounded Contexts

| Context | Role |
|---------|------|
| `domain/modal` | Owns `FileFinderState`, `FileFinderMode`, filtering, selection, and destination mapping. |
| `application/services/file_ops_service` | Builds the file inventory and symbol datasets used to open `FileFinder`. |
| `adapter/inward` | Routes keyboard and pointer selection to the correct destination behavior. |
| `adapter/outward/view/overlays` | Renders mode-aware `FileFinder` input and result rows. |

## Use Cases

### UC-1: SearchFiles
- **Actor**: User
- **Trigger**: Open `FileFinder` and type a plain query
- **Precondition**: `FileFinder` is open
- **Flow**:
  1. Tide interprets the query as `FileFinderMode::Files`.
  2. Tide ranks file-path matches.
  3. The result list updates in place.
- **Postcondition**: File results stay searchable and ordered by likely intent.
- **Business Rules**:
  - BR-1: A plain query uses `FileFinderMode::Files`.
  - BR-2: File search prefers basename and prefix matches ahead of deeper path-only matches.
  - BR-15: Empty file search orders visible project files before hidden/tooling paths, while still keeping hidden files searchable.
  - BR-16: `FileFinder` candidates respect `.gitignore`/`.ignore` (the same rules ripgrep and VS Code use), so generated output (`dist/`, `build/`, `target/`, `node_modules/`, dotfiles) never floods the list.

### UC-2: SearchSymbols
- **Actor**: User
- **Trigger**: Open `FileFinder` and type `@query` or `#query`
- **Precondition**: `FileFinder` is open
- **Flow**:
  1. Tide switches to the requested symbol-search mode.
  2. Tide filters the appropriate `SymbolMatch` dataset.
  3. The user selects a result.
- **Postcondition**: The result list exposes symbol-oriented navigation instead of file paths.
- **Business Rules**:
  - BR-3: `@query` switches `FileFinder` into `FileFinderMode::Symbols` and searches the focused `Editor Pane`.
  - BR-4: `#query` switches `FileFinder` into `FileFinderMode::WorkspaceSymbols` and searches workspace `SymbolMatch` items.
  - BR-5: Selecting a current-file `SymbolMatch` targets the focused `Editor Pane` instead of opening a new `Pane`.
  - BR-6: Selecting a workspace `SymbolMatch` opens the target file at the symbol line. The `#` index is built once, on demand, by the background workspace-scan worker (off the app thread — it reads every workspace file); the finder shows a "Loading symbols…" state until it arrives and does not re-dispatch while loading or once loaded.

> Note: the FileFinder open *walk* (`gather_finder_entries`) stays synchronous — it traverses directories without reading file contents and is bounded by `max_depth`. Only the content-reading scans (`/` search, `#` symbols) run on the background worker. Making the walk async is deferred until profiling shows the walk itself stalls.

### UC-3: SearchWorkspaceText
- **Actor**: User
- **Trigger**: Open `FileFinder` and type `/query`
- **Precondition**: `FileFinder` is open
- **Flow**:
  1. Tide switches to `FileFinderMode::WorkspaceSearch`.
  2. Typing flags a pending background search (no filesystem I/O on the app thread); the finder shows a transient "Searching…" state.
  3. A background worker scans workspace files and posts results; the latest query wins (older results are dropped).
  4. The user selects a result.
- **Postcondition**: The result list exposes workspace text hits with file and line context, without the keystroke ever stalling input/rendering.
- **Business Rules**:
  - BR-7: `/query` switches `FileFinder` into `FileFinderMode::WorkspaceSearch`.
  - BR-7a: The background worker scan finds case-insensitive matches and reports file, 1-based line, and 1-based column.
  - BR-7b: Typing a `/query` performs no filesystem read on the input path; it only flags a pending background search (`searching` + `pending_search`).
  - BR-8: Workspace text search ignores empty and one-character queries.
  - BR-9: Selecting a `WorkspaceSearchHit` opens the target file at the hit line.
  - BR-10: Results for a superseded query are discarded (latest-query cancellation via `search_request_id`).

### UC-4: SelectWithPointer
- **Actor**: User
- **Trigger**: Click a visible `FileFinder` result row
- **Precondition**: `FileFinder` is open and the clicked row maps to a filtered result
- **Flow**:
  1. Tide hit-tests the clicked row inside the `FileFinder` popup.
  2. Tide resolves the destination for that clicked filtered index.
  3. Tide opens the clicked destination and closes `FileFinder`.
- **Postcondition**: Pointer activation opens the clicked result instead of a stale keyboard selection.
- **Business Rules**:
  - BR-10: Clicking a visible `FileFinder` file result must open the clicked file, not the previously selected result.

### UC-5: ScrollWithPointer
- **Actor**: User
- **Trigger**: Wheel or trackpad scroll while the pointer is inside the `FileFinder` popup
- **Precondition**: `FileFinder` is open and has more results than visible rows
- **Flow**:
  1. Tide hit-tests the pointer against the `FileFinder` popup.
  2. Tide updates `FileFinderState.scroll_offset` by the normalized scroll-line delta.
  3. Tide clamps `scroll_offset` to the available result range.
  4. Tide keeps the selected result within the visible row window.
- **Postcondition**: The visible result list moves without scrolling the Pane below the popup.
- **Business Rules**:
  - BR-11: Wheel or trackpad scroll over the `FileFinder` popup scrolls the `FileFinder` list, not the Pane below it.
  - BR-12: `FileFinder` scroll offset is clamped to the filtered result range and keeps the selected result visible.

### UC-6: ScanResultRows
- **Actor**: User
- **Trigger**: `FileFinder` renders file, symbol, or workspace text results
- **Precondition**: `FileFinder` has at least one visible result
- **Flow**:
  1. Tide resolves a primary row label for the result.
  2. Tide resolves secondary metadata for path, parent directory, or line context.
  3. Tide renders the primary label with stronger contrast and metadata with muted contrast.
- **Postcondition**: Result rows expose the item first and supporting context second.
- **Business Rules**:
  - BR-13: File result rows render the relative path as primary text.
  - BR-14: Symbol and workspace-search rows render the symbol or preview as primary text and path/line context as secondary metadata.

### UC-7: EditorSymbolNavigation
- **Actor**: User
- **Trigger**: Right-click an identifier in an `Editor Pane`
- **Precondition**: The `Editor Pane` is in authoring (non-preview) mode and an identifier is under the pointer
- **Flow**:
  1. Tide resolves the identifier under the pointer and opens a context menu with "Go to Definition" and "Find References".
  2. "Go to Definition" opens the `FileFinder` with the definition query (`@name` when the symbol is defined in the focused file, otherwise `#name`).
  3. "Find References" opens the `FileFinder` with the workspace text-search query (`/name`), listing every occurrence.
- **Postcondition**: The integrated `FileFinder` is open in the matching mode so the user can jump to the definition or any reference.
- **Business Rules**:
  - BR-17: `editor_definition_query` prefixes a focused-file symbol with `@` and any other identifier with `#` (used as the fallback when no language server is available).
  - BR-18: "Find References" opens the `FileFinder` in `FileFinderMode::WorkspaceSearch` for the identifier (fallback path).
  - BR-19: "Go to Definition" opens the `FileFinder` in symbol mode for the identifier (fallback path).
  - BR-20: When a language server serves the file, "Go to Definition" issues a real LSP request instead of the finder fallback (see `lsp-navigation.md`).
  - BR-21: LSP "Find References" results render in the `FileFinder` and filter in memory (see `lsp-navigation.md`).
  - BR-22: Cmd/Ctrl+click in an `Editor Pane` navigates directly (VS Code style) — it opens the import/file-path link under the pointer, otherwise jumps to the symbol's definition (LSP, else the first workspace-symbol match). It never opens the `FileFinder` palette.

## Invariants

1. `FileFinder` stays the single modal entry point for file and code navigation.
2. `FileFinderMode` is derived from the current query prefix, not from hidden external state.
3. Current-file symbol selection never opens a duplicate `Editor Pane`.
4. Workspace result selection always resolves to a file path plus a line target.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1 | BR-1 | `file_finder_behavior` | `plain_query_uses_file_mode` |
| UC-1 | BR-2 | `file_finder_behavior` | `plain_file_query_prefers_basename_matches_over_deeper_paths` |
| UC-1 | BR-15 | `file_finder_behavior` | `empty_file_query_orders_visible_project_files_before_hidden_paths` |
| UC-1 | BR-16 | `file_finder_behavior` | `finder_entries_respect_gitignore` |
| UC-2 | BR-3 | `file_finder_behavior` | `at_prefix_switches_to_current_file_symbol_mode` |
| UC-2 | BR-4 | `file_finder_behavior` | `hash_prefix_switches_to_workspace_symbol_mode` |
| UC-2 | BR-5 | `file_finder_behavior` | `selected_current_file_symbol_targets_focused_editor` |
| UC-2 | BR-6 | `file_finder_behavior` | `selected_workspace_symbol_opens_file_at_symbol_line` |
| UC-3 | BR-7 | `file_finder_behavior` | `slash_prefix_switches_to_workspace_search_mode` |
| UC-3 | BR-7a | `file_finder_behavior` | `workspace_search_scan_finds_matching_lines_in_background` |
| UC-3 | BR-7b | `file_finder_behavior` | `filter_workspace_search_does_no_filesystem_read` |
| UC-3 | BR-8 | `file_finder_behavior` | `workspace_search_ignores_single_character_queries` |
| UC-3 | BR-9 | `file_finder_behavior` | `selected_workspace_search_hit_opens_file_at_matching_line` |
| UC-4 | BR-10 | `file_finder_behavior` | `clicking_second_file_result_opens_the_clicked_file` |
| UC-5 | BR-11/BR-12 | `file_finder_behavior` | `scrolling_over_file_finder_popup_scrolls_results` |
| UC-6 | BR-13 | `file_finder_behavior` | `file_result_row_parts_show_relative_path` |
| UC-6 | BR-14 | `file_finder_behavior` | `symbol_result_row_parts_separate_label_and_location` |
| UC-7 | BR-17 | `file_finder_behavior` | `editor_definition_query_prefixes_local_symbol_with_at` |
| UC-7 | BR-18 | `file_finder_behavior` | `editor_find_references_opens_workspace_text_search` |
| UC-7 | BR-19 | `file_finder_behavior` | `editor_go_to_definition_opens_symbol_search` |
| UC-7 | BR-20 | `file_finder_behavior` | `go_to_definition_uses_lsp_when_a_server_is_available` |
| UC-7 | BR-21 | `file_finder_behavior` | `find_references_hits_render_in_finder_and_filter_in_memory` |
| UC-7 | BR-22 | `file_finder_behavior` | `cmd_click_on_import_path_opens_the_file_not_a_palette` |

## Location

| Layer | Location |
|-------|----------|
| Modal state | `crates/tide-app/src/domain/modal/mod.rs` |
| Open / preload flow | `crates/tide-app/src/application/services/file_ops_service/mod.rs` |
| Keyboard selection | `crates/tide-app/src/adapter/inward/keyboard_adapter/modal.rs` |
| Mouse selection | `crates/tide-app/src/adapter/inward/mouse_adapter/mod.rs` |
| Overlay rendering | `crates/tide-app/src/adapter/outward/view/overlays/file_finder.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/file_finder_behavior.rs` |
