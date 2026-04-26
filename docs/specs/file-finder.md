# Spec: File Finder

## Overview

### As-Is
`GlobalAction::FileFinder` in `crates/tide-app/src/domain/input/mod.rs` opens one floating `FileFinder` modal through `open_file_finder()` in `crates/tide-app/src/application/services/file_ops_service/mod.rs`. That modal currently loads a recursive file list once, then `FileFinderState::filter()` in `crates/tide-app/src/domain/modal/mod.rs` lowercases each relative path and keeps entries whose full path string `contains()` the query. The overlay in `crates/tide-app/src/adapter/outward/view/overlays/file_finder.rs` renders the result list as paths only, and Enter in `crates/tide-app/src/adapter/inward/keyboard_adapter/modal.rs` opens the selected destination. But pointer activation in `crates/tide-app/src/adapter/inward/mouse_adapter/mod.rs` ignores the clicked row index and reuses the current keyboard selection instead.

That means Tide currently has one narrow navigation path where every query is treated as a file-path substring search. There is no mode split for current-file symbol search, workspace symbol search, or workspace text search. This limitation matches the rest of the code: `LspPort` in `crates/tide-app/src/application/ports/outward/lsp_port/mod.rs` only exposes completion requests today, so symbol navigation is not currently available through the existing LSP bridge either.

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

### Approach
1. Keep `GlobalAction::FileFinder` and the existing modal surface instead of adding a second navigation popup.
2. Extend `FileFinderState` with `FileFinderMode`, symbol datasets, and destination-aware selection.
3. Precompute current-file and workspace `SymbolMatch` datasets when the modal opens.
4. Keep workspace text search capped and query-driven so the palette stays responsive.
5. Render mode-aware placeholders and result rows so the user can see which navigation model is active before pressing Enter.
6. Make pointer activation resolve the clicked filtered row, not the stale selected row.

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
  - BR-6: Selecting a workspace `SymbolMatch` opens the target file at the symbol line.

### UC-3: SearchWorkspaceText
- **Actor**: User
- **Trigger**: Open `FileFinder` and type `/query`
- **Precondition**: `FileFinder` is open
- **Flow**:
  1. Tide switches to `FileFinderMode::WorkspaceSearch`.
  2. Tide scans workspace files for matching text hits.
  3. The user selects a result.
- **Postcondition**: The result list exposes workspace text hits with file and line context.
- **Business Rules**:
  - BR-7: `/query` switches `FileFinder` into `FileFinderMode::WorkspaceSearch`.
  - BR-8: Workspace text search ignores empty and one-character queries.
  - BR-9: Selecting a `WorkspaceSearchHit` opens the target file at the hit line.

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
| UC-2 | BR-3 | `file_finder_behavior` | `at_prefix_switches_to_current_file_symbol_mode` |
| UC-2 | BR-4 | `file_finder_behavior` | `hash_prefix_switches_to_workspace_symbol_mode` |
| UC-2 | BR-5 | `file_finder_behavior` | `selected_current_file_symbol_targets_focused_editor` |
| UC-2 | BR-6 | `file_finder_behavior` | `selected_workspace_symbol_opens_file_at_symbol_line` |
| UC-3 | BR-7 | `file_finder_behavior` | `slash_prefix_switches_to_workspace_search_mode` |
| UC-3 | BR-8 | `file_finder_behavior` | `workspace_search_ignores_single_character_queries` |
| UC-3 | BR-9 | `file_finder_behavior` | `selected_workspace_search_hit_opens_file_at_matching_line` |
| UC-4 | BR-10 | `file_finder_behavior` | `clicking_second_file_result_opens_the_clicked_file` |

## Location

| Layer | Location |
|-------|----------|
| Modal state | `crates/tide-app/src/domain/modal/mod.rs` |
| Open / preload flow | `crates/tide-app/src/application/services/file_ops_service/mod.rs` |
| Keyboard selection | `crates/tide-app/src/adapter/inward/keyboard_adapter/modal.rs` |
| Mouse selection | `crates/tide-app/src/adapter/inward/mouse_adapter/mod.rs` |
| Overlay rendering | `crates/tide-app/src/adapter/outward/view/overlays/file_finder.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/file_finder_behavior.rs` |
