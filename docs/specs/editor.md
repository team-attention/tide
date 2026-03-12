# Spec: Editor

Editor Pane behavior: text input, dirty tracking, preview mode, and scroll.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | Hosts EditorPane, routes text input |
| `tide-editor` | EditorState buffer, cursor, undo stack |

## Use Cases

### UC-1: EditText

- **Actor**: User
- **Trigger**: Text input (keyboard, IME commit, paste)
- **Precondition**: Editor Pane is focused, not in preview mode
- **Flow**:
  1. Text routed to focused Editor via send_text_to_target()
  2. EditorState inserts characters at cursor
  3. Buffer marked as modified
- **Postcondition**: Text inserted, editor marked dirty
- **Business Rules**:
  - BR-1: New Editor starts unmodified
  - BR-2: Typing text marks Editor as modified
  - BR-3: Text input is blocked in preview mode (unless search bar is active)
  - BR-3a: Search bar receives text even when editor is in preview mode
  - BR-3b: IME commit routes to search bar even when editor is in preview mode
  - BR-4: IME commit routes text to focused Editor
  - BR-5: IME commit to FileFinder does not reach Editor

### UC-2: EditorDefaults

- **Actor**: System
- **Trigger**: EditorPane creation
- **Precondition**: None
- **Flow**:
  1. Create EditorPane with empty buffer
- **Postcondition**: Default state established
- **Business Rules**:
  - BR-6: New Editor has no file_path
  - BR-7: New Editor is not in preview mode

### UC-3: PreviewScroll

- **Actor**: User
- **Trigger**: j/k/d/u/g/G keys in preview mode
- **Precondition**: Editor is in preview mode
- **Flow**:
  1. j → scroll down 1 line
  2. k → scroll up 1 line (clamp to 0)
  3. d → scroll down half page
  4. u → scroll up half page
  5. g → scroll to top
  6. G → scroll to bottom
- **Postcondition**: Viewport scroll offset updated
- **Business Rules**:
  - BR-8: j scrolls down one line
  - BR-9: k scrolls up one line
  - BR-10: k does not scroll below zero
  - BR-11: d scrolls down half page
  - BR-12: u scrolls up half page
  - BR-13: g scrolls to top
  - BR-14: G scrolls to bottom
  - BR-15: Scroll clamps to max

## Tests

| UC | BR | Test module | Test |
|----|-----|-------------|------|
| UC-1 | BR-1 | `editor_behavior` | `new_editor_starts_unmodified` |
| UC-1 | BR-2 | `editor_behavior` | `typing_text_into_editor_marks_it_as_modified` |
| UC-1 | BR-3 | `editor_behavior` | `text_input_is_blocked_in_preview_mode` |
| UC-1 | BR-3a | `editor_behavior` | `search_bar_receives_text_in_preview_mode` |
| UC-1 | BR-3b | `editor_behavior` | `ime_commit_reaches_search_bar_in_preview_mode` |
| UC-1 | BR-4 | `editor_behavior` | `ime_commit_routes_text_to_focused_editor` |
| UC-1 | BR-5 | `editor_behavior` | `ime_commit_to_file_finder_does_not_reach_editor` |
| UC-1 | — | `editor_behavior` | `preview_scroll_j_moves_viewport_down` |
| UC-2 | BR-6 | `editor_behavior` | `new_editor_has_no_file_path` |
| UC-2 | BR-7 | `editor_behavior` | `new_editor_is_not_in_preview_mode` |
| UC-3 | BR-8 | `preview_scroll` | `j_scrolls_down_one_line` |
| UC-3 | BR-9 | `preview_scroll` | `k_scrolls_up_one_line` |
| UC-3 | BR-10 | `preview_scroll` | `k_does_not_scroll_below_zero` |
| UC-3 | BR-11 | `preview_scroll` | `d_scrolls_down_half_page` |
| UC-3 | BR-12 | `preview_scroll` | `u_scrolls_up_half_page` |
| UC-3 | BR-13 | `preview_scroll` | `g_scrolls_to_top` |
| UC-3 | BR-14 | `preview_scroll` | `capital_g_scrolls_to_bottom` |
| UC-3 | BR-15 | `preview_scroll` | `scroll_clamps_to_max` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| EditorPane | tide-app | `editor_pane.rs` |
| EditorState | tide-editor | `lib.rs`, `buffer.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod editor_behavior, preview_scroll` |
