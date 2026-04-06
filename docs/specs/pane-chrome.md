# Spec: Pane Chrome

## Overview

### As-Is

`render_pane_chrome()` in `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs` gives unfocused `Pane`s with `AgentStatus::NeedsInput` a blinking orange border and shadow, but ordinary focused `Pane`s still render with `border_subtle` and mostly rely on header background changes for emphasis. In `crates/tide-app/src/adapter/outward/view/header.rs`, the active-header layout computes compact tab width from the full title plus the full git badge width, then clamps the overall tab width and only afterwards caps the title region. The shared header and tab-bar paths also use a very tight `TAB_BAR_HEIGHT` / `TAB_H_PAD` / `TAB_CONTENT_SPACING` budget, and the busy `Terminal Pane` label path still falls back to `badge_text_dimmed`, which makes the label read too dark.

### To-Be

Focused `Pane`s are easy to identify in both Stage and Dock through stronger active header/tab treatment and a slightly brighter focused tint, without adding a new full-pane outline around the terminal body. All tabs and headers gain a small shared increase in breathing room so the chrome feels a little less cramped. Wrapper-managed `NeedsInput` attention remains a stronger and clearly different signal. Active headers, active Stage tabs, and busy `Terminal Pane` headers preserve readable labels before optional git badges consume the remaining width.

### Approach

1. Strengthen the active header/tab treatment for focused `Pane`s so focus does not depend on subtle background shifts alone, without introducing a new full-pane outline.
2. Slightly increase the shared tab sizing budget so Stage tabs, Dock tabs, and single-Pane headers all gain the same extra breathing room.
3. Keep wrapper-managed `NeedsInput` attention stronger than focus chrome and visually distinct from it.
4. Reserve a minimum title region in active headers and active tabs, eliding optional git badges before the title disappears.
5. Use a readable shared label color path for busy `Terminal Pane` headers so terminal names do not fall back to a dimmed badge color.
6. Apply the same title-preservation and shared sizing rules to the shared header and tab-bar rendering paths so Stage tabs, Dock tabs, and single-Pane headers stay consistent.

## Bounded Contexts

| Context | Role |
|---------|------|
| `renderer` | Draws pane borders, tab bars, headers, and badge layout |
| `theme` | Supplies the colors and spacing tokens used by focus chrome, shared tab sizing, and badge chrome |
| `gateway` | Provides wrapper-managed `AgentStatus` used to distinguish `NeedsInput` attention from normal focus |

## Use Cases

### UC-1: RenderFocusedPaneChrome

- **Actor**: System
- **Trigger**: Chrome rendering for a focused `Pane`
- **Precondition**: The focused `Pane` is in Stage or Dock
- **Flow**:
  1. Tide resolves whether the current `Pane` is the focused `Pane`
  2. Tide draws a dedicated focused header/tab chrome treatment for that `Pane`
  3. Tide keeps the focused `Pane` cue visible even when the `Pane` has no wrapper-managed agent status
- **Postcondition**: The focused `Pane` is visually obvious in chrome
- **Business Rules**:
  - BR-1: Focused Stage and Dock `Pane`s use a dedicated active header/tab cue that is stronger than unfocused header chrome
  - BR-2: Focus chrome remains visible when the focused `Pane` has no wrapper-managed agent state, without adding a new full-pane outline

### UC-2: RenderNeedsInputAttentionChrome

- **Actor**: System
- **Trigger**: Chrome rendering for an unfocused `Pane` with wrapper-managed `AgentStatus::NeedsInput`
- **Precondition**: The source `Pane` is unfocused and has wrapper-managed `NeedsInput`
- **Flow**:
  1. Tide resolves the wrapper-managed agent status for the source `Pane`
  2. Tide draws the stronger attention chrome treatment for `NeedsInput`
  3. Tide avoids reusing the ordinary focused-`Pane` treatment for wrapper-managed attention
- **Postcondition**: Wrapper-managed `NeedsInput` remains distinguishable from normal focus
- **Business Rules**:
  - BR-3: Wrapper-managed `NeedsInput` chrome remains stronger than ordinary focus chrome
  - BR-4: Focus chrome and wrapper-managed `NeedsInput` chrome are visually distinct signals

### UC-3: PreserveHeaderTitleBesideGitBadges

- **Actor**: System
- **Trigger**: Chrome rendering for an active header or active Stage tab with git badges
- **Precondition**: The visible `Pane` has a title and one or more optional git badges
- **Flow**:
  1. Tide computes the available header width
  2. Tide reserves a minimum width for the title region
  3. Tide renders optional git badges only if they fit after the title reservation
  4. Tide truncates or elides optional git badges before collapsing the visible title
- **Postcondition**: The active title remains readable beside optional git badges
- **Business Rules**:
  - BR-5: Active single-pane headers keep a readable title when git branch or git status badges are present
  - BR-6: Active Stage tabs keep a readable title when git branch or git status badges are present
  - BR-7: Optional git badges yield space before the visible title disappears

### UC-4: RenderSharedTabSizingAndReadableTerminalLabels

- **Actor**: System
- **Trigger**: Chrome rendering for a shared header or tab surface
- **Precondition**: The visible `Pane` uses the shared header or tab rendering path
- **Flow**:
  1. Tide applies the shared tab sizing budget to the header or tab surface
  2. Tide gives every tab slightly more breathing room without changing the overall chrome model
  3. Tide renders focused tabs with a brighter tint than unfocused tabs
  4. Tide renders busy `Terminal Pane` labels with a readable text color instead of the dimmed badge color path
- **Postcondition**: Tabs feel slightly larger, focused tabs feel more emphasized, and terminal labels remain readable
- **Business Rules**:
  - BR-8: Shared tab chrome uses a slightly larger height and padding budget across Stage tabs, Dock tabs, and single-Pane headers
  - BR-9: Focused tabs use a brighter tint than unfocused tabs in the shared header and tab-bar rendering paths
  - BR-10: Busy `Terminal Pane` headers use a readable label color instead of the dimmed badge color path

## Invariants

1. Focus chrome does not depend on wrapper-managed agent state.
2. Wrapper-managed `NeedsInput` attention remains visually stronger than ordinary focus chrome.
3. Ordinary focus does not introduce a new full-pane outline around the terminal body.
4. Header title preservation rules apply consistently to single-pane headers and active tabs.
5. Shared tab sizing changes apply consistently to Stage tabs, Dock tabs, and single-pane headers.

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-1 | BR-1 | `focused_header_accent_is_visually_distinct_from_unfocused_chrome` |
| UC-1 | BR-2 | `focused_header_accent_renders_without_agent_status` |
| UC-2 | BR-3 | `needs_input_attention_is_stronger_than_focus_chrome` |
| UC-2 | BR-4 | `needs_input_attention_is_visually_distinct_from_focus_chrome` |
| UC-3 | BR-5 | `active_terminal_header_preserves_title_when_git_badges_are_present` |
| UC-3 | BR-6 | `active_stage_tab_preserves_title_when_git_badges_are_present` |
| UC-3 | BR-7 | `git_badges_yield_space_before_title_disappears` |
| UC-4 | BR-8 | `shared_tab_chrome_is_slightly_larger_across_all_surfaces` |
| UC-4 | BR-9 | `focused_tabs_use_a_brighter_tint_than_unfocused_tabs` |
| UC-4 | BR-10 | `busy_terminal_labels_use_a_readable_color_path` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Chrome renderer | `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs` | Focus and wrapper-managed attention border treatment |
| Header renderer | `crates/tide-app/src/adapter/outward/view/header.rs` | Title and git badge layout for active headers and active tabs |
| Theme palette | `crates/tide-app/src/theme.rs` | Colors and spacing tokens used by the new chrome treatment and shared tab sizing |
