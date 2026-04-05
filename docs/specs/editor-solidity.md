# Spec: Editor Solidity

## Overview

### As-Is
The current editor already has a real `EditorState`, `EditorPane`, Markdown preview renderer, Soft Wrap, search, selection, and inline completion. The UX problem is structural rather than missing-core-editor functionality. In `crates/tide-app/src/domain/pane/editor.rs`, file-backed Markdown Panes now open with `preview_mode = false`, so authoring starts directly and prose Panes can use Soft Wrap immediately. The remaining mismatch lives in the mode split around preview: `crates/tide-app/src/adapter/inward/text_routing_adapter/mod.rs` still blocks routed text input while preview mode is active, and `crates/tide-app/src/application/services/action_service/mod.rs` still exits early for most keys while preview is active and relies on explicit toggle and Escape flows. This keeps Markdown authoring and Markdown reading on separate interaction paths and is why the EditorPane still feels less solid than VS Code or Obsidian.

### To-Be
The editor roadmap is delivered in controlled phases instead of a rewrite.

- Phase 1 establishes EditorPane solidity. Markdown opens in authoring mode, preview becomes explicit, and input, click, scroll, search, and toggle behavior feel predictable.
- Phase 2 adds Obsidian-like knowledge-work workflows on standard Markdown only: split preview, frontmatter-aware navigation, outline navigation, and link/backlink affordances.
- Phase 3 adds IDE-grade polish for code editing: find and replace, folding, diagnostics, hover, go-to-definition, and similar workflows.

Phase 1 is the first solidity target. It finishes the authoring-first model that already exists in the worktree and tightens the remaining behavior without changing architecture.

### Approach
1. Capture the phased roadmap and Phase 1 behavior in specs before code changes.
2. Preserve the current authoring-first Markdown defaults and harden the remaining edit and preview transitions.
3. Keep preview as a dedicated reading mode with explicit entry, explicit exit, and synchronized context on both transitions.
4. Preserve Soft Wrap for prose authoring and keep preview rendering independent from Soft Wrap layout.
5. Add behavior tests for the new authoring-first flow before any implementation lands.
6. Stage knowledge-work and IDE-polish work behind later specs so Phase 1 stays narrow and verifiable.

## Bounded Contexts

| Context | Responsibility |
|---------|----------------|
| `domain/editor` | Buffer mutation, cursor state, undo stack, generation tracking, and authoring semantics through `EditorState`. |
| `domain/pane` | Pane-level editor UX state including preview mode, preview cache, preview scroll, selection, search, completion, and Soft Wrap. |
| `adapter/inward` | Input routing from keyboard, mouse, IME, and search-bar flows into the correct Pane target. |
| `application/services` | Preview toggle commands, preview escape handling, click behavior, and Pane redraw invalidation. |
| `domain/pane/editor_rendering` | Preview rendering and redraw correctness after authoring and preview transitions. |

## Use Cases

### UC-1: OpenMarkdownPaneForAuthoring
- **Actor**: User
- **Trigger**: Open a Markdown file into an Editor Pane
- **Precondition**: The file path resolves successfully
- **Flow**:
  1. The system opens the file through `EditorPane::open()`.
  2. The Pane detects the Markdown extension.
  3. The Pane opens directly in authoring mode.
  4. Prose authoring features such as Soft Wrap are initialized for the Pane.
- **Postcondition**: The user can type immediately into the Markdown buffer without first escaping preview.
- **Business Rules**:
  - BR-1: Markdown files open with `preview_mode = false`.
  - BR-2: Markdown authoring enables Soft Wrap immediately on open.
  - BR-3: Preview mode is available for Markdown files, but only through explicit toggle.
  - BR-4: Non-Markdown files preserve their current non-preview open behavior.

### UC-2: TogglePreviewWithoutLosingContext
- **Actor**: User
- **Trigger**: Preview toggle hotkey or Escape while preview is active
- **Precondition**: The focused Pane is a Markdown Editor Pane
- **Flow**:
  1. The user enters preview through the toggle command.
  2. The Pane synchronizes scroll state into preview coordinates.
  3. The user exits preview with the same toggle or Escape.
  4. The Pane synchronizes the authoring view back into editor coordinates.
- **Postcondition**: Preview is useful for reading without disorienting the user when they return to authoring.
- **Business Rules**:
  - BR-5: Preview mode is entered only by explicit user action.
  - BR-6: Edit-to-preview transition preserves reading position proportionally.
  - BR-7: Preview-to-edit transition preserves authoring position proportionally.
  - BR-8: Search state is re-executed in the destination coordinate space after each toggle.
  - BR-9: Escape exits preview mode.

### UC-3: RouteAuthoringInputPredictably
- **Actor**: User
- **Trigger**: Keyboard input, IME commit, paste, or click in a focused Editor Pane
- **Precondition**: The Pane has keyboard focus
- **Flow**:
  1. The routing layer resolves the active text target.
  2. Authoring input is forwarded into `EditorState`.
  3. Preview mode blocks editor-buffer mutation while still allowing preview-safe interactions.
  4. Click behavior matches the active mode.
- **Postcondition**: Editing and reading modes feel distinct but predictable.
- **Business Rules**:
  - BR-10: Text input mutates the buffer in authoring mode.
  - BR-11: Preview mode blocks editor-buffer text mutation.
  - BR-12: The search bar receives text even while preview mode is active.
  - BR-13: IME commits follow the same routing rules as direct text input.
  - BR-14: Authoring-mode clicks reposition the cursor through the current authoring layout.
  - BR-15: Preview-mode clicks do not mutate the buffer.

### UC-4: PreserveProseReadabilityDuringAuthoring
- **Actor**: User
- **Trigger**: Open, resize, scroll, or navigate within a prose Editor Pane
- **Precondition**: The focused Pane is a prose file in authoring mode
- **Flow**:
  1. The Pane enables Soft Wrap for prose authoring.
  2. Wrap state is rebuilt when the viewport width changes.
  3. Cursor visibility and scroll state stay consistent after layout changes.
- **Postcondition**: Prose authoring remains readable while the editor UX is modernized.
- **Business Rules**:
  - BR-16: Soft Wrap remains enabled for Markdown authoring mode.
  - BR-17: Preview mode remains outside the Soft Wrap layout path.
  - BR-18: Wrap rebuild on resize keeps the cursor visible.

## Invariants

1. Phase 1 changes behavior inside the existing `EditorPane` and `EditorState` architecture; it does not replace the editor core.
2. Preview mode is opt-in for Markdown Panes and never the default open state.
3. Preview mode remains read-oriented: routed text input cannot mutate the editor buffer while preview is active.
4. Soft Wrap remains enabled for prose authoring and disabled for preview rendering.
5. Later roadmap phases may add features, but they must not weaken Phase 1 authoring-first behavior.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1 | BR-1 | `editor_behavior` | `markdown_file_opens_in_authoring_mode` |
| UC-1 | BR-2 | `soft_wrap_behavior` | `markdown_authoring_opens_with_soft_wrap_active` |
| UC-1 | BR-3 | `editor_behavior` | `markdown_preview_is_entered_only_by_explicit_toggle` |
| UC-2 | BR-6 | `editor_behavior` | `edit_to_preview_toggle_preserves_scroll_position` |
| UC-2 | BR-7 | `editor_behavior` | `preview_to_edit_toggle_preserves_scroll_position` |
| UC-2 | BR-8 | `editor_behavior` | `search_matches_reexecute_after_preview_toggle` |
| UC-2 | BR-9 | `editor_behavior` | `escape_exits_preview_mode` |
| UC-3 | BR-10 | `editor_behavior` | `text_input_routes_to_focused_editor_in_authoring_mode` |
| UC-3 | BR-11 | `editor_behavior` | `text_input_is_blocked_in_preview_mode` |
| UC-3 | BR-12 | `editor_behavior` | `search_bar_receives_text_in_preview_mode` |
| UC-3 | BR-13 | `editor_behavior` | `ime_commit_reaches_search_bar_in_preview_mode` |
| UC-3 | BR-14 | `editor_behavior` | `click_in_authoring_mode_moves_cursor_using_current_layout` |
| UC-4 | BR-16 | `soft_wrap_behavior` | `markdown_authoring_opens_with_soft_wrap_active` |
| UC-4 | BR-18 | `soft_wrap_behavior` | `cursor_visible_after_rewrap` |

## Location

| What | Location |
|------|----------|
| Roadmap spec | `docs/specs/editor-solidity.md` |
| Core editor behavior spec | `docs/specs/editor.md` |
| Prose wrapping spec | `docs/specs/soft-wrap.md` |
| Editor Pane implementation | `crates/tide-app/src/domain/pane/editor.rs` |
| Input routing | `crates/tide-app/src/adapter/inward/text_routing_adapter/mod.rs` |
| Action routing | `crates/tide-app/src/application/services/action_service/mod.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/` |
