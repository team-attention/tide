# Spec: LSP Navigation (Go to Definition / Find References)

## Overview

### As-Is
- The v1 LSP client only spoke `textDocument/completion`. The editor right-click
  menu's "Go to Definition" / "Find References" fell back to the integrated
  finder's symbol index (`@`/`#`) and a filesystem text grep (`/`), which is an
  approximation — not the language server's semantic result.

### To-Be
- "Go to Definition" issues a real `textDocument/definition` request and jumps to
  the returned location.
- "Find References" issues a real `textDocument/references` request and lists the
  returned locations in the `FileFinder`.
- When no language server is serving the file, both gracefully fall back to the
  finder's symbol/text search so the feature always does something useful.

### Approach
1. Add `textDocument/definition` and `textDocument/references` to `LspClient`.
2. Track a pending navigation request in `LspManager` and resolve it via
   `poll_navigation`, parsing `Location | Location[] | LocationLink[]`.
3. Expose `supports_navigation`, `request_definition`, `request_references`,
   `poll_navigation` on `LspPort`.
4. Drive the request from the editor context menu (`FileOpsPort` →
   `execute_editor_symbol_context_menu_action`), preferring LSP, else fallback.
5. Handle the async result in the event loop (`poll_lsp_navigation`): open the
   definition target, or inject reference hits into the `FileFinder`.

## Bounded Contexts

| Context | Role |
|---------|------|
| `lsp` (adapter/outward) | `LspClient` requests, `LspManager` pending-request tracking + `parse_locations` |
| `lsp_service` | Polls navigation responses, opens definitions, shows references |
| `file_ops_service` | Builds the editor-symbol context menu with the click position |
| `file_tree_service` | Executes the menu action (LSP request or fallback) |
| `modal` | `FileFinderState` external (injected) reference hits |

## Use Cases

### UC-1: ParseLocations
- **Actor**: System
- **Trigger**: A `definition`/`references` response arrives
- **Flow**: Decode a single `Location`, a `Location[]`, or a `LocationLink[]` into
  filesystem paths + 0-based line/character.
- **Business Rules**:
  - BR-1: `parse_locations` handles a single `Location`, an array of `Location`,
    and an array of `LocationLink` (`targetUri`/`targetSelectionRange`); `null`
    yields no locations.

### UC-2: GoToDefinition
- **Actor**: User
- **Trigger**: "Go to Definition" on an identifier
- **Flow**: With a server serving the file, send `textDocument/definition`; on the
  response, open the first location's file at its line. Otherwise fall back to the
  finder symbol search.
- **Business Rules**:
  - BR-2: With a server available, "Go to Definition" issues a real LSP request
    (no finder fallback).
  - BR-3: The definition response opens the target file at the returned line.

### UC-3: FindReferences
- **Actor**: User
- **Trigger**: "Find References" on an identifier
- **Flow**: With a server serving the file, send `textDocument/references`
  (`includeDeclaration: true`); on the response, list the locations in the
  `FileFinder`, filtered in memory. Otherwise fall back to the workspace text
  search.
- **Business Rules**:
  - BR-4: References results render in the `FileFinder` and filter in memory
    (never re-grepped from disk).

## Invariants
1. Navigation never blocks the UI; responses arrive via `poll_navigation`.
2. The completion poll and navigation poll do not consume each other's responses
   (a right-click dismisses any in-flight completion).
3. When no server serves the file, the feature falls back to finder search.

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `parse_single_location_object`, `parse_location_array`, `parse_location_link_array`, `parse_null_definition_yields_no_locations` |
| UC-2 | BR-2 | `go_to_definition_uses_lsp_when_a_server_is_available` |
| UC-3 | BR-4 | `find_references_hits_render_in_finder_and_filter_in_memory` |

## Location

| Layer | Key Files |
|-------|-----------|
| Spec | `docs/specs/lsp-navigation.md` |
| LSP requests | `crates/tide-app/src/adapter/outward/lsp_adapter/{client,manager,protocol}.rs` |
| LSP port | `crates/tide-app/src/application/ports/outward/lsp_port/mod.rs` |
| Wiring | `crates/tide-app/src/application/services/{lsp_service,file_tree_service,file_ops_service}/mod.rs` |
| Finder injection | `crates/tide-app/src/domain/modal/mod.rs` (`set_reference_hits`) |
| Tests | `behavior_tests/file_finder_behavior.rs`, `lsp_adapter/manager.rs` |
