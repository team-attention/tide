# Spec: Editor Polish

## Overview

### As-Is
Tide already has the rendering hooks needed for an editor polish pass, but they are not yet governed by a dedicated spec. `DESIGN.md` now defines the intended visual contract for this slice, while the current code still spreads the relevant behavior across the renderer. In [`crates/tide-app/src/adapter/outward/view/header.rs`](../../crates/tide-app/src/adapter/outward/view/header.rs), `editor_header_badges()` is already the shared source of truth for `EditorBadge` content across Pane headers and TabGroup chrome, and `reserve_title_before_badges()` already decides how much title width survives when chrome gets tight. In [`crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs`](../../crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs), focused and unfocused tab-bar backgrounds already diverge. In [`crates/tide-app/src/theme.rs`](../../crates/tide-app/src/theme.rs), [`crates/tide-app/src/adapter/outward/view/grid.rs`](../../crates/tide-app/src/adapter/outward/view/grid.rs), and [`crates/tide-app/src/domain/pane/editor_rendering.rs`](../../crates/tide-app/src/domain/pane/editor_rendering.rs), current-line and indent-guide colors already flow into the Editor Pane render path.

What is missing is a bounded contract that turns those hooks into verifiable editor UX rules. Without that, active-Pane prominence, mode clarity, badge priority, focus treatment, and narrow-width fallback all remain implementation details rather than protected behavior. The current shared badge order also lets the add-comment affordance displace the `plain` / `live` mode switch in a narrow active `Markdown Pane` tab, which makes the current authoring mode ambiguous in the chrome.

### To-Be
Editor polish becomes a bounded slice that applies `DESIGN.md` to Tide's existing `Editor Chrome` without changing `EditorState` semantics, preview routing, or the roadmap boundaries already defined in `docs/specs/editor-solidity.md`.

After this slice:

- the active Pane is visually obvious without depending on a pointer hover
- the active Editor Pane mode is explicit at a glance
- narrow headers preserve title legibility and critical state before optional chrome
- interactive `EditorBadge` affordances are visible and keyboard-focusable
- current-line, gutter, and prose readability hierarchy feel more deliberate without changing layout semantics

### Approach
1. Treat `DESIGN.md` as the visual contract for this slice and keep all spec language consistent with the glossary.
2. Add glossary entries for any missing UI terms needed to describe the work precisely.
3. Add behavior and renderer-level tests before implementation so the polish rules are protected as business rules.
4. Implement the polish only through the existing Editor Pane chrome and render paths.
5. Verify that hover and click affordances still match the rendered `Editor Chrome`.

## Bounded Contexts

| Context | Responsibility |
|---------|----------------|
| `adapter/outward/view/header` | Builds and renders `EditorBadge` content, title reservation, and Pane-header hit targets. |
| `adapter/outward/view/chrome` | Draws TabGroup chrome and active/inactive Pane chrome backgrounds. |
| `theme` | Defines the color roles that map `DESIGN.md` tokens into the existing runtime palette. |
| `adapter/outward/view/grid` | Routes theme colors for current-line and indent-guide emphasis into the Editor Pane render path. |
| `domain/pane/editor_rendering` | Applies current-line, gutter, indent-guide, and document-surface styling without changing editor semantics. |
| `adapter/inward` | Preserves click and hover alignment for interactive `Editor Chrome` affordances after geometry changes. |

## Use Cases

### UC-1: SurfaceActivePaneAndModeInEditorChrome
- **Actor**: User
- **Trigger**: Focus changes to an Editor Pane, or the active Editor Pane changes mode or file state
- **Precondition**: At least one Editor Pane is visible
- **Flow**:
  1. Tide renders Pane headers and any visible TabGroup chrome.
  2. The focused Pane receives the active chrome treatment.
  3. The active Editor Pane renders its mode and file state through `EditorBadge` content.
  4. Inactive Pane chrome remains readable but visually recessive.
- **Postcondition**: The user can identify the active Pane, the active Editor Pane mode, and any file-attention state at a glance.
- **Business Rules**:
  - BR-1: The active Pane must be visually stronger than inactive Panes through `Editor Chrome`, not only through text weight.
  - BR-2: The active Markdown Pane must expose explicit mode information through visible `EditorBadge` chrome.
  - BR-3: File-attention state remains visible, but does not outrank title legibility in the active Pane.

### UC-2: PreserveCriticalChromeAtNarrowWidths
- **Actor**: User
- **Trigger**: An Editor Pane header or TabGroup chrome becomes narrow
- **Precondition**: The visible title and `EditorBadge` content compete for horizontal space
- **Flow**:
  1. Tide computes title and badge layout for the visible header.
  2. The chrome drops optional content before critical content.
  3. Title text remains legible before optional metadata is shown.
- **Postcondition**: Narrow editor chrome stays readable and mode-safe instead of collapsing into ambiguous badges.
- **Business Rules**:
  - BR-4: Title legibility outranks optional chrome when width is constrained.
  - BR-5: Attention state outranks secondary metadata when not all chrome can fit.
  - BR-6: A narrow active `Markdown Pane` must preserve its visible `plain` / `live` mode badge ahead of contextual secondary affordances such as add-comment.

### UC-3: KeepEditorChromeInteractiveAndReliable
- **Actor**: User
- **Trigger**: Hover, keyboard focus, or pointer interaction reaches interactive `Editor Chrome`
- **Precondition**: The visible chrome contains interactive badges or controls
- **Flow**:
  1. Tide renders the interactive `EditorBadge` or control.
  2. Hover and focus clarify affordance without repainting unrelated chrome.
  3. Click or keyboard activation lands on the intended hit zone.
- **Postcondition**: Interactive editor chrome remains compact but reliable.
- **Business Rules**:
  - BR-7: Keyboard-reachable interactive editor chrome must show a visible focus state.
  - BR-8: Interactive `EditorBadge` affordances must differentiate default, hover, and focus states.
  - BR-9: Visible editor-chrome geometry and its click hit zones must stay aligned.

### UC-4: ImproveReadabilityWithoutChangingEditorSemantics
- **Actor**: User
- **Trigger**: Authoring or reading in an Editor Pane after the polish slice lands
- **Precondition**: The Editor Pane renders through the existing grid and editor-rendering path
- **Flow**:
  1. Tide applies the polished current-line, gutter, and indent-guide emphasis.
  2. The document surface keeps the existing layout model.
  3. Prose authoring and code authoring both benefit from clearer hierarchy.
- **Postcondition**: The editor feels calmer and more deliberate without changing buffer behavior.
- **Business Rules**:
  - BR-10: Current-line emphasis must stay visible without becoming a bright stripe.
  - BR-11: Gutter and indent guides must support structure while remaining quieter than document text.
  - BR-12: Readability tuning must not change `EditorState`, preview semantics, or the existing layout model.

## Invariants

1. This slice changes `Editor Chrome` and readability treatment inside the existing render paths; it does not replace the editor core.
2. `EditorBadge` content remains shared between Pane headers and TabGroup chrome so badge semantics do not diverge.
3. Title legibility outranks optional chrome in narrow editor headers.
4. Mode and state meaning must not depend on color alone.
5. Hover and focus visuals must continue to match actual click and keyboard targets.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1 | BR-1 | `editor_polish_behavior` | `active_editor_pane_chrome_is_stronger_than_inactive_pane_chrome` |
| UC-1 | BR-2 | `editor_polish_behavior` | `active_markdown_pane_shows_explicit_mode_badge` |
| UC-1 | BR-3 | `header` | `file_attention_badges_remain_secondary_to_title_legibility` |
| UC-2 | BR-4 | `header` | `narrow_editor_header_preserves_title_before_optional_badges` |
| UC-2 | BR-5 | `header` | `attention_state_outranks_secondary_metadata_in_narrow_headers` |
| UC-2 | BR-6 | `editor_polish_behavior` | `focused_markdown_pane_keeps_mode_badge_visible_ahead_of_add_comment_when_width_is_tight` |
| UC-3 | BR-7 | `editor_polish_behavior` | `keyboard_reachable_editor_chrome_shows_visible_focus_state` |
| UC-3 | BR-8 | `editor_polish_behavior` | `interactive_editor_badges_differentiate_default_hover_and_focus_states` |
| UC-3 | BR-9 | `editor_polish_behavior` | `editor_header_hit_zones_remain_aligned_with_visible_chrome` |
| UC-4 | BR-10 | `editor_polish_behavior` | `current_line_emphasis_stays_visible_without_becoming_dominant` |
| UC-4 | BR-11 | `editor_polish_behavior` | `gutter_and_indent_guides_support_structure_without_competing_with_content` |
| UC-4 | BR-12 | `editor_polish_behavior` | `editor_polish_preserves_existing_editor_semantics` |

## Location

| What | Location |
|------|----------|
| Design contract | `DESIGN.md` |
| Roadmap anchor | `docs/specs/editor-solidity.md` |
| Editor polish spec | `docs/specs/editor-polish.md` |
| Glossary terms | `docs/glossary.md` |
| Pane header chrome | `crates/tide-app/src/adapter/outward/view/header.rs` |
| TabGroup chrome | `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs` |
| Theme tokens | `crates/tide-app/src/theme.rs` |
| Editor render path | `crates/tide-app/src/domain/pane/editor_rendering.rs` |
