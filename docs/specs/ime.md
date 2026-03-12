# Spec: IME

Input Method Editor composition lifecycle: preedit, commit, and cleanup.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | ImeState tracks composition state |
| `tide-platform` | NSTextInputClient protocol drives IME events |

## Use Cases

### UC-1: Composition

- **Actor**: System (IME framework)
- **Trigger**: User types with non-Latin input method (e.g., Korean)
- **Precondition**: IME is active
- **Flow**:
  1. Preedit text arrives → set_preedit(text): composing=true, store text
  2. More preedit → update text
  3. Commit → handle_ime_commit(text): deliver final text, clear preedit
  4. Empty preedit → set_preedit(""): composing=false
- **Postcondition**: Final text delivered to target, composition cleared
- **Business Rules**:
  - BR-1: New ImeState is not composing
  - BR-2: set_preedit with text starts composition
  - BR-3: set_preedit with empty string ends composition
  - BR-4: clear_composition resets all state

### UC-2: CompositionCleanup

- **Actor**: System
- **Trigger**: Workspace switch or Pane close
- **Precondition**: Active composition exists
- **Flow**:
  1. Workspace switch → clear composition (different Pane set)
  2. Close Pane that is IME target → clear composition
  3. Close Pane that is NOT IME target → preserve composition
- **Postcondition**: Composition cleared or preserved appropriately
- **Business Rules**:
  - BR-5: Workspace switch clears composition
  - BR-6: Workspace switch without composition does not affect IME
  - BR-7: Closing Pane that is IME target clears composition
  - BR-8: Closing Pane that is NOT IME target preserves composition

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `new_ime_state_is_not_composing` |
| UC-1 | BR-2 | `set_preedit_with_text_starts_composition` |
| UC-1 | BR-3 | `set_preedit_with_empty_string_ends_composition` |
| UC-1 | BR-4 | `clear_composition_resets_all_state` |
| UC-2 | BR-5 | `workspace_switch_clears_composition` |
| UC-2 | BR-6 | `workspace_switch_without_composition_does_not_affect_ime` |
| UC-2 | BR-7 | `closing_pane_that_is_ime_target_clears_composition` |
| UC-2 | BR-8 | `closing_pane_that_is_not_ime_target_preserves_composition` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| ImeState | tide-app | `ui_state.rs` |
| Platform | tide-platform | `macos/view.rs` (NSTextInputClient) |
| Tests | tide-app | `behavior_tests.rs :: mod ime_behavior` |
