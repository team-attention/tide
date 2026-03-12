# Spec: Modal

How modals intercept input, enforce exclusivity, and return control.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | ModalStack owns all modal state |
| `tide-input` | Router is BYPASSED when a modal is open |

## Use Cases

### UC-1: ModalInterception

- **Actor**: System (handle_key_down)
- **Trigger**: Any KeyDown event while a modal is open
- **Precondition**: At least one modal is `Some` in ModalStack
- **Flow**:
  1. Check modal priority chain:
     - config_page (highest) → context_menu → save_confirm → save_as_input → file_finder → git_switcher → file_tree_rename
  2. First open modal consumes the event
  3. RETURN immediately — input never reaches Router or Panes
- **Postcondition**: Event consumed by modal
- **Business Rules**:
  - BR-1: Config page blocks all text input (highest priority)
  - BR-2: Context menu blocks text input
  - BR-3: Save confirm blocks text input
  - BR-4: File finder captures text instead of Pane
  - BR-5: Git switcher captures text instead of Pane
  - BR-6: ModalStack has higher input priority than search bar
  - BR-7: Config page has highest priority over all other modals

### UC-2: DismissModal

- **Actor**: User
- **Trigger**: ESC key
- **Precondition**: A modal is open
- **Flow**:
  1. ESC key arrives in handle_key_down
  2. First open modal in priority chain is dismissed (set to None)
  3. Input returns to normal routing
- **Postcondition**: Modal closed, input routing restored
- **Business Rules**:
  - BR-8: ESC closes file finder
  - BR-9: ESC closes git switcher
  - BR-10: ESC closes save_as_input
  - BR-11: ESC closes context menu
  - BR-12: ESC cancels save confirm (Pane stays open)
  - BR-13: ESC closes file tree rename

### UC-3: ModalLifecycle

- **Actor**: System
- **Trigger**: App initialization or close_all()
- **Precondition**: None
- **Flow**:
  1. New App → all modal fields are None
  2. close_all() → all modal fields set to None
- **Postcondition**: Clean modal state
- **Business Rules**:
  - BR-14: New App has no modals open
  - BR-15: close_all dismisses every modal

## Invariants

1. **Modal exclusivity**: At most one modal should be open at a time (enforced by convention, not structurally)
2. **Input interception**: If a modal consumes an event, it NEVER reaches Router or Panes

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `config_page_blocks_all_text_input` |
| UC-1 | BR-2 | `context_menu_blocks_text_input` |
| UC-1 | BR-3 | `save_confirm_blocks_text_input` |
| UC-1 | BR-4 | `file_finder_captures_text_instead_of_pane` |
| UC-1 | BR-5 | `git_switcher_captures_text_instead_of_pane` |
| UC-1 | BR-6 | `modal_stack_has_higher_input_priority_than_search_bar` |
| UC-1 | BR-7 | `config_page_has_highest_priority_in_modal_stack` |
| UC-2 | BR-8 | `escape_closes_file_finder_modal` |
| UC-2 | BR-9 | `escape_closes_git_switcher` |
| UC-2 | BR-10 | `escape_closes_save_as_input` |
| UC-2 | BR-11 | `escape_closes_context_menu` |
| UC-2 | BR-12 | `escape_cancels_save_confirm` |
| UC-2 | BR-13 | `escape_closes_file_tree_rename` |
| UC-3 | BR-14 | `new_app_modal_stack_is_empty` |
| UC-3 | BR-15 | `modal_stack_close_all_dismisses_all_modals` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| ModalStack | tide-app | `ui_state.rs` (ModalStack struct) |
| Event handler | tide-app | `event_handler/keyboard.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod modal_behavior` |
