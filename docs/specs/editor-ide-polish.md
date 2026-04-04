# Spec: Editor IDE Polish

## Overview

### As-Is
Tide already shows a CompletionPopup for LSP completions, but the polish level is uneven. The current completion behavior is spread across `crates/tide-app/src/domain/pane/editor_completion.rs`, `crates/tide-app/src/application/services/search_service/mod.rs`, and `crates/tide-app/src/adapter/outward/lsp_adapter/manager.rs`. Ranking is mostly fuzzy-score based, `filterText` is used when present, and accepted text uses `insertText` or falls back to the label. The current gaps are polish gaps rather than feature gaps: completion ordering is not explicitly specified as a deterministic UI contract, `preselect` behaves like a broad boost instead of a narrow preference, and accepted text does not explicitly normalize snippet-style placeholders or prefer `textEdit.newText` when the server provides it.

### To-Be
CompletionPopup ordering and insertion feel deterministic and closer to VS Code without adding new language features. When the user types in an Editor Pane:

1. items are ranked deterministically by match quality,
2. `preselect` acts as a preference when items are otherwise tied,
3. `filterText` controls matching when provided,
4. accepted text is chosen predictably from `textEdit.newText`, `insertText`, or label,
5. snippet-style placeholder markers are normalized to plain inserted text because Tide does not yet support snippet cursor choreography.

### Approach
1. Capture the completion-polish behavior in a focused spec instead of expanding the larger LSP feature spec.
2. Add behavior tests for deterministic ordering, `preselect` preference, `filterText` matching, and accepted-text normalization.
3. Update CompletionPopup state logic in `editor_completion.rs` to make ranking and accepted text deterministic.
4. Update the LSP adapter in `manager.rs` to prefer `textEdit.newText` when the server supplies it.

## Bounded Contexts

| Context | Role |
|---------|------|
| `domain/pane` | Owns CompletionPopup ranking, selection state, and accepted-text normalization through `CompletionState`. |
| `adapter/outward/lsp_adapter` | Maps raw LSP completion payloads into Tide completion items. |
| `application/behavior_tests` | Codifies the completion-popup UX contract. |

## Use Cases

### UC-1: RankCompletionDeterministically
- **Actor**: User
- **Trigger**: CompletionPopup is opened or re-filtered while typing
- **Precondition**: An Editor Pane has an active CompletionPopup
- **Flow**:
  1. The CompletionPopup evaluates each item against the current prefix.
  2. Matching items are scored.
  3. The popup orders items deterministically.
- **Postcondition**: The first visible item is stable for the same prefix and item set.
- **Business Rules**:
  - BR-1: Higher fuzzy-score items rank before lower-score items.
  - BR-2: If scores tie, `preselect = true` ranks before `preselect = false`.
  - BR-3: If score and `preselect` tie, `sortText` ranks lexicographically ascending.
  - BR-4: If score, `preselect`, and `sortText` tie, original server order is preserved.

### UC-2: FilterCompletionByPrefix
- **Actor**: User
- **Trigger**: The user continues typing while CompletionPopup is open
- **Precondition**: The CompletionPopup already has items
- **Flow**:
  1. The CompletionPopup re-filters its current items.
  2. For each item, it chooses the match text.
  3. Matching items remain visible in deterministic order.
- **Postcondition**: The CompletionPopup narrows to items that still match the prefix.
- **Business Rules**:
  - BR-5: `filterText` is used for matching when the server provides it.
  - BR-6: The label is used for matching only when `filterText` is absent.

### UC-3: AcceptCompletionText
- **Actor**: User
- **Trigger**: The user accepts the selected CompletionPopup item
- **Precondition**: A CompletionPopup item is selected
- **Flow**:
  1. Tide resolves the accepted text for the selected item.
  2. Tide replaces the typed prefix with the accepted text.
  3. The CompletionPopup closes.
- **Postcondition**: The buffer receives clean accepted text instead of raw protocol placeholders.
- **Business Rules**:
  - BR-7: `textEdit.newText` is preferred over `insertText` when both are available from the server payload.
  - BR-8: `insertText` is preferred over the label when `textEdit.newText` is absent.
  - BR-9: Snippet-style tab stop markers are stripped or flattened to plain text before insertion.
  - BR-10: Escaped dollar signs in accepted text remain literal dollar signs.

## Invariants

1. CompletionPopup ordering is deterministic for the same prefix and item set.
2. `preselect` influences ordering only as a tie-break preference, not as a replacement for match quality.
3. Accepted completion text is always plain buffer text; Tide does not insert raw snippet placeholders.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1 | BR-1 | `lsp_completion` | `higher_scoring_prefix_match_ranks_first` |
| UC-1 | BR-2 | `lsp_completion` | `preselect_breaks_tie_without_beating_better_match` |
| UC-1 | BR-3 | `lsp_completion` | `sort_text_breaks_tie_when_fuzzy_scores_equal` |
| UC-2 | BR-5 | `lsp_completion` | `filter_text_drives_prefix_matching` |
| UC-3 | BR-7 | `lsp_completion` | `manager_prefers_text_edit_new_text_for_inserted_text` |
| UC-3 | BR-9 | `lsp_completion` | `accepted_completion_strips_snippet_placeholders` |
| UC-3 | BR-10 | `lsp_completion` | `accepted_completion_preserves_escaped_dollar_signs` |

## Location

| What | Location |
|------|----------|
| IDE polish spec | `docs/specs/editor-ide-polish.md` |
| CompletionPopup behavior tests | `crates/tide-app/src/application/behavior_tests/lsp_completion.rs` |
| CompletionPopup ranking and accepted text | `crates/tide-app/src/domain/pane/editor_completion.rs` |
| LSP completion payload mapping | `crates/tide-app/src/adapter/outward/lsp_adapter/manager.rs` |
