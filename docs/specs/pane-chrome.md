# Spec: Pane Chrome

## Overview

### As-Is

`render_pane_chrome()` in `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs` gives unfocused `Pane`s with `AgentStatus::NeedsInput` a blinking orange border and shadow, but ordinary focused `Pane`s still render with `border_subtle` and mostly rely on header background changes for emphasis. The current `NeedsInput` lookup reads `gateway.detected_agents` by the rendered `PaneId`, so non-terminal `Pane`s with an `Associated Terminal` can miss wrapper-managed attention even when their paired `Wrapped Agent` is reporting `NeedsInput`. In `crates/tide-app/src/adapter/outward/view/header.rs`, the active-header layout computes compact tab width from the full title plus the full git badge width, then clamps the overall tab width and only afterwards caps the title region. The shared header and tab-bar paths also use a very tight `TAB_BAR_HEIGHT` / `TAB_H_PAD` / `TAB_CONTENT_SPACING` budget, and the busy `Terminal Pane` label path still falls back to `badge_text_dimmed`, which makes the label read too dark. That same fixed active-tab width clamp is just tight enough that an active live-preview `Markdown Pane` can fit `live + comment` but lose `comment` when the mode badge widens to `plain`, even when the row still has room to stretch a bit. The same clamp can also hide a stacked Stage `Terminal Pane` git status badge even when sibling tabs still have spare width to yield, because the tab-width calculation does not reserve space for the connected-agent status dot before badge elision runs. Overflowed shared tab bars also auto-fit the active tab every render, so an explicit manual scroll offset in a shared Dock or Stage tab bar is immediately pulled back toward the active tab instead of behaving like a persistent horizontal browse position. On macOS, precise trackpad scroll deltas are normalized down before they reach the shared tab bar scroll path, and that path currently applies the same hard minimum step to every non-zero delta. Combined with `if dx.abs() > dy.abs() { dx } else { -dy }` in the shared tab scroll selection, diagonal precise gestures can be driven by vertical fallback instead of horizontal intent, which makes the tab strip feel over-sensitive. The shared tab bar also applies positive horizontal delta in the opposite direction from the editor and diff horizontal scroll paths, so left/right swipe intent feels reversed relative to the rest of Tide. Finally, shared tab scroll offset is only clamped during render, not when the offset is stored, so repeated strokes at the far edge accumulate hidden overscroll debt and the first reverse stroke has to burn through that debt before the visible tab strip moves back. Separately, PTY output currently schedules `badge_check_at` for `now + 150ms` before `update_terminal_badges()` and `trigger_git_poll()` run, so git branch and status badges can visibly lag behind terminal activity even when the app is otherwise idle. When `update_terminal_badges()` does notice a `Terminal Pane` `cwd` change, it swaps the cached `cwd` immediately but leaves the previous repo's `git_info`, `worktree_count`, and `current_worktree` in place until the next background git poll result arrives, so stale git badges can remain visible after a directory change.
`render_pane_chrome()` in `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs` gives unfocused `Pane`s with `AgentStatus::NeedsInput` a blinking orange border and shadow, but ordinary focused `Pane`s still render with `border_subtle` and mostly rely on header background changes for emphasis. The current `NeedsInput` lookup reads `gateway.detected_agents` by the rendered `PaneId`, so non-terminal `Pane`s with an `Associated Terminal` can miss wrapper-managed attention even when their paired `Wrapped Agent` is reporting `NeedsInput`. In `crates/tide-app/src/adapter/outward/view/header.rs`, the active-header layout computes compact tab width from the full title plus the full git badge width, then clamps the overall tab width and only afterwards caps the title region. The shared header and tab-bar paths also use a very tight `TAB_BAR_HEIGHT` / `TAB_H_PAD` / `TAB_CONTENT_SPACING` budget, and the busy `Terminal Pane` label path still falls back to `badge_text_dimmed`, which makes the label read too dark. That same fixed active-tab width clamp is just tight enough that an active live-preview `Markdown Pane` can fit `live + comment` but lose `comment` when the mode badge widens to `plain`, even when the row still has room to stretch a bit. The same clamp can also hide a stacked Stage `Terminal Pane` git status badge even when sibling tabs still have spare width to yield, because the tab-width calculation does not reserve space for the connected-agent status dot before badge elision runs. Overflowed shared tab bars also auto-fit the active tab every render, so an explicit manual scroll offset in a shared Dock or Stage tab bar is immediately pulled back toward the active tab instead of behaving like a persistent horizontal browse position. On macOS, precise trackpad scroll deltas are normalized down before they reach the shared tab bar scroll path, and that path currently applies the same hard minimum step to every non-zero delta. Combined with `if dx.abs() > dy.abs() { dx } else { -dy }` in the shared tab scroll selection, diagonal precise gestures can be driven by vertical fallback instead of horizontal intent, which makes the tab strip feel over-sensitive. The shared tab bar also applies positive horizontal delta in the opposite direction from the editor and diff horizontal scroll paths, so left/right swipe intent feels reversed relative to the rest of Tide. Finally, shared tab scroll offset is only clamped during render, not when the offset is stored, so repeated strokes at the far edge accumulate hidden overscroll debt and the first reverse stroke has to burn through that debt before the visible tab strip moves back. Shared tab scroll routing also claims any pane header before it knows whether that surface can actually scroll, so a single-pane header or a non-overflowing shared header can swallow wheel and trackpad input that should have fallen through to the underlying pane content. Separately, PTY output currently schedules `badge_check_at` for `now + 150ms` before `update_terminal_badges()` and `trigger_git_poll()` run, so git branch and status badges can visibly lag behind terminal activity even when the app is otherwise idle.

### To-Be

Focused `Pane`s are easy to identify in both Stage and Dock through stronger active header/tab treatment and a slightly brighter focused tint, without adding a new full-pane outline around the terminal body. All tabs and headers gain a small shared increase in breathing room so the chrome feels a little less cramped. Wrapper-managed `NeedsInput` attention remains a stronger and clearly different signal. Non-terminal `Pane`s inherit wrapper-managed `NeedsInput` attention from their paired `Wrapped Agent` through the `Associated Terminal`. Active headers, active Stage tabs, and busy `Terminal Pane` headers preserve readable labels before optional git badges consume the remaining width. The shared active-tab width budget also stretches with the available row width after sibling tabs reserve their minimum width, so active tabs can grow when they need badge space without filling the whole row, and a connected-agent status dot is counted in that width budget before git badge elision runs. Overflowed shared tab bars keep horizontal scroll, but Tide only auto-fits the active tab when the active `Pane` changes, so explicit manual tab scrolling remains stable instead of snapping back every frame. Precise trackpad gestures on shared tab bars prioritize horizontal delta when one is present, use only a modest starter step on a fresh stroke, continue with lighter continuous motion, follow the same horizontal direction convention as editor and diff panes, and clamp stored shared-tab offset to the visible scroll bounds so reversing from an edge starts moving immediately. Git branch and status badges also refresh on the next frame-scale check after PTY output instead of waiting a visibly long fixed delay. When a `Terminal Pane` `cwd` changes, Tide clears stale git branch, git status, and worktree chrome immediately and waits for the new background poll result to repopulate them.
Focused `Pane`s are easy to identify in both Stage and Dock through stronger active header/tab treatment and a slightly brighter focused tint, without adding a new full-pane outline around the terminal body. All tabs and headers gain a small shared increase in breathing room so the chrome feels a little less cramped. Wrapper-managed `NeedsInput` attention remains a stronger and clearly different signal. Non-terminal `Pane`s inherit wrapper-managed `NeedsInput` attention from their paired `Wrapped Agent` through the `Associated Terminal`. Active headers, active Stage tabs, and busy `Terminal Pane` headers preserve readable labels before optional git badges consume the remaining width. The shared active-tab width budget also stretches with the available row width after sibling tabs reserve their minimum width, so active tabs can grow when they need badge space without filling the whole row, and a connected-agent status dot is counted in that width budget before git badge elision runs. Overflowed shared tab bars keep horizontal scroll, but Tide only auto-fits the active tab when the active `Pane` changes, so explicit manual tab scrolling remains stable instead of snapping back every frame. Precise trackpad gestures on shared tab bars prioritize horizontal delta when one is present, use only a modest starter step on a fresh stroke, continue with lighter continuous motion, follow the same horizontal direction convention as editor and diff panes, and clamp stored shared-tab offset to the visible scroll bounds so reversing from an edge starts moving immediately. Header-area scroll is only consumed by a shared tab surface that can actually move horizontally; otherwise the input falls through to the underlying pane content. Git branch and status badges also refresh on the next frame-scale check after PTY output instead of waiting a visibly long fixed delay.

### Approach

1. Strengthen the active header/tab treatment for focused `Pane`s so focus does not depend on subtle background shifts alone, without introducing a new full-pane outline.
2. Slightly increase the shared tab sizing budget so Stage tabs, Dock tabs, and single-Pane headers all gain the same extra breathing room, including an active-tab cap that stretches with the available row width after sibling tabs reserve their minimum width.
3. Keep wrapper-managed `NeedsInput` attention stronger than focus chrome and visually distinct from it.
4. Resolve wrapper-managed `NeedsInput` through the source `Pane` or its `Associated Terminal` so non-terminal `Pane`s inherit paired-agent attention.
5. Reserve a minimum title region in active headers and active tabs, eliding optional git badges before the title disappears.
6. Use a readable shared label color path for busy `Terminal Pane` headers so terminal names do not fall back to a dimmed badge color.
7. Apply the same title-preservation and shared sizing rules to the shared header and tab-bar rendering paths so Stage tabs, Dock tabs, and single-Pane headers stay consistent.
8. Reserve shared-tab width for the connected-agent status dot before badge elision runs so git status survives the same row budget when agent presence turns on.
9. Keep explicit horizontal tab scrolling stable by auto-fitting the active tab only on active-tab changes, not on every render while the user is manually browsing overflowed tabs.
10. Make shared tab bars treat horizontal precise delta as the primary gesture signal, leaving vertical fallback for wheel-style scrolling when no horizontal delta is present.
11. Give shared tab bars a modest starter step only on a fresh precise stroke or an immediate direction change, then fall back to lighter continuous motion so tab scrolling feels responsive without becoming over-sensitive.
12. Use the same horizontal delta sign convention for shared tab bars that editor and diff panes already use, so horizontal scroll direction stays consistent across Tide.
13. Clamp stored shared-tab scroll offset to the visible bounds at input time, not only during render, so edge overscroll never creates hidden reverse-scroll debt.
14. Schedule PTY-driven terminal badge refresh on a near-immediate frame-scale delay instead of a long fixed delay.
15. Only consume header-area scroll for shared tab bars that actually have horizontal overflow; otherwise route the scroll to the pane content below.
16. Clear stale terminal git and worktree badge state as soon as cached `cwd` changes, before the next background git poll result arrives.

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
  - BR-5: A non-terminal `Pane` with an `Associated Terminal` inherits wrapper-managed `NeedsInput` chrome from the paired `Wrapped Agent`

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
  - BR-6: Active single-pane headers keep a readable title when git branch or git status badges are present
  - BR-7: Active Stage tabs keep a readable title when git branch or git status badges are present
  - BR-8: Optional git badges yield space before the visible title disappears

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
  - BR-9: Shared tab chrome uses a slightly larger height, padding, and row-aware active-tab width budget across Stage tabs, Dock tabs, and single-Pane headers
  - BR-10: Focused tabs use a brighter tint than unfocused tabs in the shared header and tab-bar rendering paths
  - BR-11: Busy `Terminal Pane` headers use a readable label color instead of the dimmed badge color path
  - BR-12: The shared active-tab width budget stretches with the available row width after sibling tabs reserve their minimum width, enough to keep both `plain` and `comment` badges visible for an active live-preview `Markdown Pane` while preserving the minimum title region
  - BR-13: A stacked Stage active `Terminal Pane` keeps its git branch and git status badges visible when the row still has spare width after sibling tabs reserve their minimum width, including when the same tab renders a connected-agent status dot
  - BR-14: Overflowed shared tab bars preserve explicit horizontal scroll; active-tab auto-fit runs when the active `Pane` changes, but not on every render against a manual user scroll offset
  - BR-15: A precise shared-tab gesture uses horizontal delta before vertical fallback, so diagonal trackpad strokes follow horizontal intent instead of being steered by vertical fallback
  - BR-16: A fresh shared-tab trackpad stroke or immediate direction change produces a modest visible starter step, but continuous events use lighter motion instead of applying the same hard minimum step to every delta
  - BR-17: Shared tab bars use the same horizontal scroll direction convention as editor and diff panes
  - BR-18: Shared tab scroll offset is clamped to the visible bounds when input is applied, so reversing from the far edge does not wait for hidden overscroll debt to drain
  - BR-19: PTY output schedules terminal badge refresh on the next frame-scale delay rather than a 150ms timer, so git badges appear promptly after output settles
  - BR-20: Header-area scroll is only consumed by an overflowed shared tab bar; single-pane headers and non-overflowing shared headers fall through to pane scroll handling
  - BR-21: A `Terminal Pane` `cwd` change clears stale git branch, git status, and worktree chrome immediately before fresh poll results arrive

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
| UC-2 | BR-5 | `dock_editor_inherits_needs_input_attention_from_paired_terminal` |
| UC-3 | BR-6 | `active_terminal_header_preserves_title_when_git_badges_are_present` |
| UC-3 | BR-7 | `active_stage_tab_preserves_title_when_git_badges_are_present` |
| UC-3 | BR-8 | `git_badges_yield_space_before_title_disappears` |
| UC-4 | BR-9 | `shared_tab_chrome_is_slightly_larger_across_all_surfaces` |
| UC-4 | BR-10 | `focused_tabs_use_a_brighter_tint_than_unfocused_tabs` |
| UC-4 | BR-11 | `busy_terminal_labels_use_a_readable_color_path` |
| UC-4 | BR-12 | `active_markdown_live_preview_chrome_keeps_plain_and_comment_badges_visible` |
| UC-4 | BR-13 | `stacked_stage_active_terminal_tab_keeps_git_status_badges_when_agent_dot_is_present` |
| UC-4 | BR-14 | `overflowed_shared_tab_bar_keeps_the_active_tab_visible` |
| UC-4 | BR-14 | `manual_shared_tab_scroll_does_not_snap_back_to_the_active_tab` |
| UC-4 | BR-15 | `shared_tab_scroll_prioritizes_horizontal_delta_before_vertical_fallback` |
| UC-4 | BR-16 | `shared_tab_scroll_uses_a_modest_starter_step_only_for_fresh_gestures` |
| UC-4 | BR-16 | `shared_tab_scroll_treats_direction_change_as_a_fresh_gesture` |
| UC-4 | BR-17 | `shared_tab_scroll_matches_editor_horizontal_direction` |
| UC-4 | BR-18 | `shared_tab_scroll_offset_clamps_at_visible_bounds` |
| UC-4 | BR-19 | `terminal_badge_refresh_delay_matches_a_single_frame_scale_budget` |
| UC-4 | BR-20 | `single_pane_header_scroll_falls_through_to_preview_content` |
| UC-4 | BR-21 | `terminal_cwd_change_clears_stale_git_badges_before_poll_results_arrive` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Chrome renderer | `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs` | Focus and wrapper-managed attention border treatment |
| Header renderer | `crates/tide-app/src/adapter/outward/view/header.rs` | Title and git badge layout for active headers and active tabs |
| Theme palette | `crates/tide-app/src/theme.rs` | Colors and spacing tokens used by the new chrome treatment and shared tab sizing |
| Terminal badge updater | `crates/tide-app/src/application/services/file_tree_service/mod.rs` | Cached `cwd` and git chrome synchronization for `Terminal Pane` badges |
