# Spec: Editor

## Overview

### As-Is
`EditorPane::open()` in `crates/tide-app/src/domain/pane/editor.rs` opens file-backed Markdown Panes with `preview_mode = false`, and the same constructor enables `soft_wrap` for prose extensions. That means Markdown authoring now starts directly in the editable Pane instead of a read-only preview path. Markdown Panes still start with `live_preview = false`, though, so the hybrid Markdown rendering path stays opt-in even after the Pane has already chosen the prose-authoring interaction model. The remaining mode split is still significant: `effective_soft_wrap()` disables wrapping while preview is active, the routing layer in `crates/tide-app/src/adapter/inward/text_routing_adapter/mod.rs` blocks text input when `preview_mode` is true, and the key handling path in `crates/tide-app/src/application/services/action_service/mod.rs` exits early for almost every key while preview is active. Preview scrolling is also enforced in multiple places now: keyboard preview navigation goes through `apply_preview_scroll()`, wheel scrolling mutates `preview_scroll` in `action_service`, and scrollbar drag writes `preview_scroll` directly in `mouse_adapter`, but the spec only locks the keyboard path today.

### To-Be
Editor behavior remains centered on `EditorPane` and `EditorState`, and Markdown Panes continue to open in authoring mode first. Markdown authoring defaults to `LivePreviewMode` while keeping `preview_mode = false`, so text input remains enabled and preview-only mode stays an explicit toggle. Soft Wrap stays active for prose authoring, preview keeps its own rendering and scroll model, and toggle transitions preserve reading context without trapping the user in a blocked-input state. Search, IME, click handling, and preview scrolling stay predictable across authoring and preview flows. Preview scrolling clamps to the same valid range no matter whether the user scrolls by keyboard, mouse wheel, or scrollbar drag.

### Approach
1. Keep the current `EditorPane` and `EditorState` architecture instead of replacing the editor core.
2. Preserve Markdown Pane authoring-first defaults while enabling `LivePreviewMode` by default for Markdown files.
3. Preserve the current preview rendering and preview scroll model, but make transitions between authoring and preview predictable.
4. Keep text routing, IME routing, search routing, and click handling aligned with the active mode.
5. Preserve Soft Wrap behavior for prose authoring and keep preview mode unaffected by Soft Wrap.
6. Lock one shared preview-scroll clamping rule across keyboard, wheel, and scrollbar drag paths.

## Bounded Contexts

| Context | Role |
|---------|------|
| `domain/editor` | Owns `EditorState`, buffer mutation, cursor movement, undo state, and generation tracking. |
| `domain/pane` | Owns `EditorPane` mode state such as preview, selection, search, completion, preview cache, and Soft Wrap cache. |
| `adapter/inward` | Routes text input, IME commits, mouse clicks, and search-bar input to the focused Pane. |
| `application/services` | Maps `GlobalAction` and key presses into Pane-level behavior, including preview toggling and preview escape flows. |

## Use Cases

### UC-1: EditText
- **Actor**: User
- **Trigger**: Text input, IME commit, or paste routed to a focused Editor Pane
- **Precondition**: The focused Pane is an `EditorPane` in authoring mode
- **Flow**:
  1. The text routing layer resolves the focused input target.
  2. Authoring input is forwarded into `EditorState`.
  3. Any active selection is deleted before editing input is applied.
  4. The buffer is marked modified and the cursor remains visible.
- **Postcondition**: The buffer mutates in authoring mode and the Pane remains usable for continued editing.
- **Business Rules**:
  - BR-1: A new untitled Editor Pane starts unmodified.
  - BR-2: Editing text marks the buffer as modified.
  - BR-3: Editing text and IME commits route to `EditorState` only while the Pane is in authoring mode.
  - BR-4: Preview mode blocks editor-buffer text mutation.
  - BR-5: The search bar receives text even while preview mode is active.
  - BR-6: IME commit to File Finder does not mutate the focused Editor Pane.

### UC-2: EditorDefaults
- **Actor**: System
- **Trigger**: An Editor Pane is created or a file-backed Editor Pane is opened
- **Precondition**: None
- **Flow**:
  1. The system constructs a new `EditorPane`.
  2. If a file path exists, the Pane detects file type and prose status.
  3. The Pane initializes its mode-specific state.
- **Postcondition**: The Editor Pane opens with defaults that match the file type and UX target.
- **Business Rules**:
  - BR-7: A new untitled Editor Pane has no `file_path`.
  - BR-8: A new untitled Editor Pane starts with `preview_mode = false`.
  - BR-9: Opening a Markdown file starts in authoring mode with `preview_mode = false` and `live_preview = true`.
  - BR-10: Opening a prose file enables Soft Wrap for authoring mode.
  - BR-11: Opening a non-prose file preserves the no-wrap default unless another spec enables wrapping.

### UC-3: ToggleMarkdownPreview
- **Actor**: User
- **Trigger**: The preview toggle hotkey or Escape while preview mode is active
- **Precondition**: The focused Pane is an `EditorPane`
- **Flow**:
  1. A Markdown Pane receives the preview toggle command.
  2. The Pane switches between authoring mode and preview mode.
  3. Scroll state and search state are synchronized into the destination mode.
  4. The active Pane is redrawn in the new coordinate space.
- **Postcondition**: The Pane changes modes without losing context.
- **Business Rules**:
  - BR-12: Only Markdown Panes can enter preview mode.
  - BR-13: Entering preview mode is an explicit user action, never the default open path.
  - BR-14: Edit-to-preview transition preserves reading position proportionally.
  - BR-15: Preview-to-edit transition preserves authoring position proportionally.
  - BR-16: Search matches are re-executed in the destination coordinate space after a mode toggle.
  - BR-17: Escape exits preview mode and returns the Pane to authoring mode.

### UC-4: PreviewScroll
- **Actor**: User
- **Trigger**: Preview navigation keys while preview mode is active
- **Precondition**: The focused Pane is an `EditorPane` in preview mode
- **Flow**:
  1. The Pane receives preview navigation input.
  2. The preview scroll state is updated and clamped.
  3. The preview is redrawn at the new viewport position.
- **Postcondition**: Preview navigation stays responsive without mutating the buffer.
- **Business Rules**:
  - BR-18: `j` scrolls preview down one line.
  - BR-19: `k` scrolls preview up one line.
  - BR-20: Preview scroll does not move below zero.
  - BR-21: `d` scrolls preview down half a page.
  - BR-22: `u` scrolls preview up half a page.
  - BR-23: `g` scrolls preview to the top.
  - BR-24: `G` scrolls preview to the bottom and clamps to the available preview range.
  - BR-25: Mouse-wheel preview scrolling clamps to the same top and bottom range as keyboard preview navigation.
  - BR-26: Scrollbar drag in preview mode clamps to the same top and bottom range as keyboard preview navigation.

### UC-5: PreviewRendering
- **Actor**: System
- **Trigger**: Preview rendering for a Markdown Pane
- **Precondition**: The Pane is in preview mode with a valid preview cache
- **Flow**:
  1. The renderer iterates visible preview lines.
  2. Styled spans are drawn into the preview grid.
  3. Code-block background areas are padded consistently with the preview layout.
- **Postcondition**: Markdown preview renders with stable visual structure.
- **Business Rules**:
  - BR-27: Code-block background extends with right padding that matches the preview layout.

## Invariants

1. Markdown preview is opt-in: opening a Markdown file never forces the Pane into preview mode.
2. Preview mode never mutates the editor buffer through routed text input.
3. Search and scroll state are always synchronized into the active mode after a preview toggle.
4. Soft Wrap remains a prose authoring concern and stays disabled while preview mode is active.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1 | BR-1 | `editor_behavior` | `new_editor_starts_unmodified` |
| UC-1 | BR-2 | `editor_behavior` | `typing_text_into_editor_marks_it_as_modified` |
| UC-1 | BR-3 | `editor_behavior` | `text_input_routes_to_focused_editor_in_authoring_mode` |
| UC-1 | BR-4 | `editor_behavior` | `text_input_is_blocked_in_preview_mode` |
| UC-1 | BR-5 | `editor_behavior` | `search_bar_receives_text_in_preview_mode` |
| UC-1 | BR-6 | `editor_behavior` | `ime_commit_to_file_finder_does_not_reach_editor` |
| UC-2 | BR-7 | `editor_behavior` | `new_editor_has_no_file_path` |
| UC-2 | BR-8 | `editor_behavior` | `new_editor_is_not_in_preview_mode` |
| UC-2 | BR-9 | `editor_behavior` | `markdown_file_opens_in_authoring_mode_with_live_preview_enabled` |
| UC-2 | BR-10 | `soft_wrap_behavior` | `markdown_authoring_opens_with_soft_wrap_active` |
| UC-3 | BR-12 | `editor_behavior` | `preview_toggle_is_ignored_for_non_markdown_files` |
| UC-3 | BR-13 | `editor_behavior` | `markdown_preview_is_entered_only_by_explicit_toggle` |
| UC-3 | BR-14 | `editor_behavior` | `edit_to_preview_toggle_preserves_scroll_position` |
| UC-3 | BR-15 | `editor_behavior` | `preview_to_edit_toggle_preserves_scroll_position` |
| UC-3 | BR-16 | `editor_behavior` | `search_matches_reexecute_after_preview_toggle` |
| UC-3 | BR-17 | `editor_behavior` | `escape_exits_preview_mode` |
| UC-4 | BR-18 | `preview_scroll` | `j_scrolls_down_one_line` |
| UC-4 | BR-19 | `preview_scroll` | `k_scrolls_up_one_line` |
| UC-4 | BR-20 | `preview_scroll` | `k_does_not_scroll_below_zero` |
| UC-4 | BR-21 | `preview_scroll` | `d_scrolls_down_half_page` |
| UC-4 | BR-22 | `preview_scroll` | `u_scrolls_up_half_page` |
| UC-4 | BR-23 | `preview_scroll` | `g_scrolls_to_top` |
| UC-4 | BR-24 | `preview_scroll` | `capital_g_scrolls_to_bottom` |
| UC-4 | BR-25 | `preview_scroll` | `mouse_wheel_preview_scroll_clamps_to_visible_range` |
| UC-4 | BR-26 | `preview_scroll` | `preview_scrollbar_drag_clamps_to_visible_range` |
| UC-5 | BR-27 | `preview_rendering` | `code_block_background_has_right_padding` |

## Location

| Layer | Location |
|-------|----------|
| `EditorPane` mode state | `crates/tide-app/src/domain/pane/editor.rs` |
| Editor rendering | `crates/tide-app/src/domain/pane/editor_rendering.rs` |
| Key and action routing | `crates/tide-app/src/application/services/action_service/mod.rs` |
| Text and IME routing | `crates/tide-app/src/adapter/inward/text_routing_adapter/mod.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/` |
