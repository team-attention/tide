# Spec: IME

## Overview

### As-Is

- Tide already tracks IME composition state in `ImeState`, clears composition on `Workspace` switch and `Pane` close, and routes committed text through the shared text-input path.
- `Terminal` and `Editor` rendering already show preedit through pane-specific render paths.
- The `Search Bar` renders IME preedit inline, but the committed query text and caret do not yet share a single visual-width model with the top-layer renderer.
- The `Context Comment Composer` accepts IME commit text, but it does not render preedit inline and does not expose an overlay-specific IME cursor area.
- IME cursor-area updates currently derive only from the focused `Terminal` or `Editor` caret, so overlay text inputs such as the `Search Bar` and `Context Comment Composer` can anchor the candidate window to the wrong place.

### To-Be

- IME composition lifecycle stays correct across commit, cleanup, and focus changes.
- Overlay text inputs in Tide-rendered chrome update immediately during preedit.
- The `Search Bar` and `Context Comment Composer` both render IME preedit inline at their own caret positions.
- The IME candidate window follows the active overlay caret for `Search Bar` and `Context Comment Composer` instead of the underlying `Pane` cursor.
- Long Korean composition in the `Search Bar` keeps committed text, preedit text, caret, and IME cursor area visually aligned.

### Approach

1. Preserve the current composition-state and cleanup rules.
2. Detect when IME preedit targets a Tide-rendered overlay and invalidate chrome immediately.
3. Render preedit inline inside `Search Bar` and `Context Comment Composer` using the same visual-width rules as committed text.
4. Compute overlay-specific IME cursor rectangles for `Search Bar` and `Context Comment Composer` and use them before falling back to `Terminal` or `Editor` caret geometry.
5. Lock the long-Hangul `Search Bar` alignment rule with behavior tests before changing the renderer path.

## Bounded Contexts

| Context | Role |
|---------|------|
| `ime_adapter` | Receives IME commit and preedit events and updates `ImeState` plus redraw invalidation |
| `text_routing_adapter` | Delivers committed text to the correct target, including overlay text inputs |
| `event_loop_adapter` | Computes the effective IME target and updates the platform IME cursor area |
| `view/overlays` | Renders inline preedit for Tide-owned text inputs |
| `tide-platform` | Hosts the per-`Pane` IME proxy and candidate-window cursor area |

## Use Cases

### UC-1: Composition

- **Actor**: System (IME framework)
- **Trigger**: User types with non-Latin input method
- **Precondition**: IME is active
- **Flow**:
  1. Preedit text arrives and `set_preedit(text)` stores it
  2. More preedit updates replace the stored text
  3. Commit delivers final text through `handle_ime_commit(text)` and clears preedit
  4. Empty preedit clears composition
- **Postcondition**: Final text delivered to target, composition cleared
- **Business Rules**:
  - BR-1: New `ImeState` is not composing
  - BR-2: `set_preedit` with text starts composition
  - BR-3: `set_preedit` with empty string ends composition
  - BR-4: `clear_composition` resets all state

### UC-2: CompositionCleanup

- **Actor**: System
- **Trigger**: `Workspace` switch or `Pane` close
- **Precondition**: Active composition exists
- **Flow**:
  1. `Workspace` switch clears composition
  2. Closing the IME target clears composition
  3. Closing a different `Pane` preserves composition
- **Postcondition**: Composition cleared or preserved appropriately
- **Business Rules**:
  - BR-5: `Workspace` switch clears composition
  - BR-6: `Workspace` switch without composition does not affect IME
  - BR-7: Closing the IME target `Pane` clears composition
  - BR-8: Closing a non-target `Pane` preserves composition

### UC-3: FocusChangeKeepsEffectiveTargetCoherent

- **Actor**: System
- **Trigger**: Focus changes while IME composition state exists
- **Precondition**: A focused `Pane` exists
- **Flow**:
  1. Tide recomputes the effective IME target after the focus change
  2. Tide keeps the last committed target stable until platform sync resolves the transition
- **Postcondition**: IME routing remains coherent across focus changes
- **Business Rules**:
  - BR-9: CLI focus changes update the effective IME target
  - BR-10: Focus changes during composition preserve the old last-target until proxy sync finishes

### UC-4: OverlayComposition

- **Actor**: System
- **Trigger**: IME preedit targets the `Search Bar` or `Context Comment Composer`
- **Precondition**: A Tide-rendered overlay text input is active
- **Flow**:
  1. Tide updates `ImeState.preedit`
  2. Tide invalidates chrome immediately so the overlay can redraw
  3. Tide renders preedit inline at the overlay caret
  4. Tide updates the platform IME cursor area from the overlay caret rect
- **Postcondition**: Overlay input shows responsive IME composition and a correctly positioned candidate window
- **Business Rules**:
  - BR-11: IME preedit with an active `Search Bar` invalidates chrome and redraws inline in the `Search Bar`
  - BR-12: IME preedit with an open `Context Comment Composer` invalidates chrome and redraws inline in the composer input
  - BR-13: The `Search Bar` provides the IME cursor area while it is the active text input
  - BR-14: The `Context Comment Composer` provides the IME cursor area while it is the active text input
  - BR-15: Long Korean `Search Bar` composition keeps committed text, preedit, caret, and IME cursor area aligned

## Invariants

1. IME composition state remains separate from committed text.
2. Cleanup on `Workspace` switch or IME-target `Pane` close still clears composition exactly once.
3. Overlay IME cursor areas take precedence only while the overlay text input is active.
4. If no overlay text input is active, IME cursor area falls back to the focused `Terminal` or `Editor` caret rules.
5. `Search Bar` committed text, preedit text, and IME cursor area use one shared visual-width model while composition is active.

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
| UC-3 | BR-9 | `cli_focus_pane_updates_effective_ime_target` |
| UC-3 | BR-10 | `cli_focus_pane_with_active_composition_commits_to_old_target` |
| UC-4 | BR-11 | `ime_preedit_with_search_focus_invalidates_chrome` |
| UC-4 | BR-12 | `ime_preedit_with_context_comment_composer_invalidates_chrome` |
| UC-4 | BR-13 | `search_bar_ime_cursor_area_tracks_search_caret` |
| UC-4 | BR-14 | `context_comment_composer_ime_cursor_area_tracks_composer_caret` |
| UC-4 | BR-15 | `search_bar_long_hangul_input_keeps_text_and_caret_aligned` |

## Location

| Layer | Key Files |
|-------|-----------|
| Spec | `docs/specs/ime.md` |
| IME input | `crates/tide-app/src/adapter/inward/ime_adapter/mod.rs` |
| IME target + cursor area | `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` |
| Overlay rendering | `crates/tide-app/src/adapter/outward/view/overlays/search_bar.rs`, `crates/tide-app/src/adapter/outward/view/overlays/context_comment.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/ime_behavior.rs` |
