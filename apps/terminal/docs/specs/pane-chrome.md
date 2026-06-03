# Spec: Pane Chrome

## Overview

### As-Is

`render_pane_chrome()` in `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs`, `render_pane_header_inner()` in `crates/tide-app/src/adapter/outward/view/header.rs`, and the Workspace rail rendering in `titlebar.rs` already project Wrapped Agent lifecycle into Tide chrome, but the attention signal still splits between multiple visual paths. Stage `Terminal` dots, pane-surface fill, pane-surface underline, inactive `Workspace` indicators, and overflow edge cues do not all come from the same `Terminal-Owned Attention` model, so the user can see an inactive `Workspace` alert without an equally obvious Stage `Terminal` alert source after switching into that `Workspace`. The recent Stage/Dock ownership fix already prevents file tabs from inheriting wrapped-agent chrome through `Associated Terminal`, but the chrome still needs a simpler dot-only attention model on Workspace items and direct Stage `Terminal`s only. Launch-time wrapper integration also still reports `Running`, which makes an idle wrapped-agent prompt appear green before the first turn starts. Terminal git badge refresh already uses a frame-scale badge timer, and a `cwd` transition already clears stale repo chrome before the next git poll result arrives, but the background git poller still processes queued `cwd` refresh requests in arrival order. Fast repo-to-repo `cd` sequences can therefore spend time polling an obsolete repo before the latest repo gets a fresh branch and worktree badge.

Dock split chrome also still over-uses the shared tab bar. `render_pane_chrome()` currently inserts every Dock `TabGroup` into `dock_tab_groups`, and the Dock branch then renders `render_dock_tab_bar()` for that pane even when the `TabGroup` has exactly one `Pane`. That makes a single Dock `Pane` read like a stretched one-tab tab strip, with the close affordance pushed to the far-right tab edge instead of living in the trailing utility lane used by single-`Pane` headers elsewhere in Tide.

### To-Be

Focused `Pane`s stay easy to identify in both Stage and Dock through the current brighter active header/tab treatment, without adding a new full-pane outline around the terminal body. `Terminal-Owned Attention` is dot-only: it renders only on `Workspace` list items and on direct wrapped-agent owner `Terminal`s in Stage. A direct wrapped-agent Stage `Terminal` with `Running` shows a solid green dot. A direct wrapped-agent Stage `Terminal` with unresolved `Idle` or `NeedsInput` shows the same orange blinking dot family, and that blink must follow a stable clock that does not depend on frame-to-frame render cadence. A direct wrapped-agent Stage `Terminal` with `Wrapped Agent Presence` but no active `AgentStatus` shows a solid idle-presence dot in a muted cool color. Tide does not add wrapped-agent fill or underline to the entire Stage `Pane` surface. Non-terminal `Pane`s never inherit wrapped-agent dots through `Associated Terminal`, and Dock chrome never renders a wrapped-agent dot. If an alerting Stage `Terminal` is clipped out of the `ViewMode::Stacked` flat Stage tab strip, the tab-strip edge in the hidden direction shows the same orange blinking dot. Workspace items show the strongest direct Stage-terminal state for that `Workspace`, regardless of whether the `Workspace` is active or inactive: orange blinking alert takes precedence over green running, which takes precedence over idle-presence. Active headers, active stacked Stage tabs, and busy `Terminal Pane` headers preserve readable labels before optional git badges consume the remaining width. A Dock `TabGroup` with one `Pane` uses the single-`Pane` header chrome instead of a shared tab bar, so the title and close affordance sit in the same layout family as the rest of Tide. A Stacked Terminal Context Surface with one `Pane` follows the same rule so the active file or surface name remains visible. The shared active-tab width budget continues to reserve space for the Stage-terminal dot, shared tab scrolling remains stable and directionally consistent, and git badges continue to refresh on a near-immediate frame-scale delay. When repo-to-repo navigation queues multiple git refreshes, the background poller must prefer the latest pending `cwd` request instead of spending extra time publishing obsolete repo results first.

### Approach

1. Keep the dedicated focused header/tab treatment for Stage and Dock `Pane`s.
2. Limit wrapped-agent chrome to `Terminal-Owned Attention` on the direct wrapped-agent owner `Terminal`; do not inherit dots through `Associated Terminal`.
3. Remove wrapper-managed pane-surface fill and underline from Stage `Pane` chrome.
4. Map direct Stage-terminal `Running` to a solid green dot.
5. Map direct Stage-terminal `Idle` and `NeedsInput` to the same orange blinking alert dot family, driven by a stable blink clock instead of frame delta.
6. Map `Wrapped Agent Presence` plus `AgentStatus = None` to a solid idle-presence dot on direct Stage `Terminal`s.
7. Project Workspace list-item dots from Stage terminals only: orange blinking for alert, green for running, idle-presence color for connected idle, using the same stable blink clock and the same strongest-state precedence for active and inactive `Workspace`s.
8. Keep the `Workspace` item synchronized with the strongest visible Stage-terminal state instead of suppressing active-Workspace alerts.
9. When an alerting Stage-terminal tab is scrolled outside the visible shared-tab range, render the orange blinking indicator on the corresponding tab-strip edge.
9. Reserve a minimum title region in active headers and active tabs, eliding optional git badges before the title disappears.
10. Use a readable shared label color path for busy `Terminal Pane` headers so terminal names do not fall back to a dimmed badge color.
11. Apply the same title-preservation and shared sizing rules to the shared header and tab-bar rendering paths so stacked Stage tabs, Dock tabs, and single-Pane headers stay consistent.
12. Reserve shared-tab width for the Stage-terminal dot whenever a visible Stage `Terminal` has direct wrapper-managed lifecycle state.
13. Keep explicit horizontal tab scrolling stable by auto-fitting the active tab only on active-tab changes, not on every render while the user is manually browsing overflowed tabs.
14. Make shared tab bars treat horizontal precise delta as the primary gesture signal, leaving vertical fallback for wheel-style scrolling when no horizontal delta is present.
15. Give shared tab bars a modest starter step only on a fresh precise stroke or an immediate direction change, then fall back to lighter continuous motion so tab scrolling feels responsive without becoming over-sensitive.
16. Use the same horizontal delta sign convention for shared tab bars that editor and diff panes already use, so horizontal scroll direction stays consistent across Tide.
17. Clamp stored shared-tab scroll offset to the visible bounds at input time, not only during render, so edge overscroll never creates hidden reverse-scroll debt.
18. Schedule PTY-driven terminal badge refresh on a near-immediate frame-scale delay instead of a long fixed delay.
19. Only consume header-area scroll for shared tab bars that actually have horizontal overflow; otherwise route the scroll to the pane content below.
20. Clear stale terminal git and worktree badge state as soon as cached `cwd` changes, before the next background git poll result arrives.
21. Collapse queued git-poll `cwd` refresh requests to the latest pending request before publishing results, so repo chrome repopulates promptly after repo-to-repo navigation.
22. Render Dock shared tab bar chrome only when the Dock `TabGroup` or Stacked Terminal Context Surface actually has multiple tabs; a single Dock `Pane` falls back to the normal single-`Pane` header.

## Bounded Contexts

| Context | Role |
|---------|------|
| `renderer` | Draws pane headers, shared tab bars, Workspace items, and overflow edge indicators |
| `theme` | Supplies the colors and spacing tokens used by Stage-terminal dots, Workspace dots, and shared-tab sizing |
| `gateway` | Provides wrapper-managed `AgentStatus` used to project running and alert dots from direct wrapped-agent Stage terminals |
| `gateway` | Provides `Wrapped Agent Presence` through `wrapper_managed` plus `gateway_connected` for idle-presence dots |

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

### UC-2: RenderTerminalOwnedAttention

- **Actor**: System
- **Trigger**: Chrome rendering for a direct wrapped-agent Stage `Terminal`
- **Precondition**: The direct wrapped-agent owner `Terminal` is in Stage
- **Flow**:
  1. Tide resolves the direct wrapped-agent status for the Stage `Terminal`
  2. Tide renders only the direct Stage-terminal dot for wrapper-managed attention
  3. Tide avoids projecting wrapped-agent pane chrome onto non-terminal `Pane`s or the full `Pane` surface
- **Postcondition**: Wrapped-agent attention stays attached to the owning Stage `Terminal`
- **Business Rules**:
  - BR-3: Wrapper-managed attention does not add fill or underline to the Stage `Pane` surface
  - BR-4: `Idle` and `NeedsInput` share the same orange blinking Stage-terminal alert dot family
  - BR-5: A non-terminal `Pane` never inherits wrapped-agent pane chrome from its `Associated Terminal`
  - BR-6: A focused direct wrapped-agent Stage `Terminal` keeps its alert dot while the alert remains unresolved

### UC-3: RenderStageTerminalDot

- **Actor**: System
- **Trigger**: Header or tab chrome rendering for a direct wrapped-agent owner `Terminal` in Stage
- **Precondition**: The target `Pane` is a Stage `Terminal` with direct wrapper-managed lifecycle state
- **Flow**:
  1. Tide resolves the direct wrapper-managed lifecycle state for the Stage `Terminal`
  2. Tide reserves dot width in the Stage header or tab
  3. Tide renders the Stage-terminal dot with the color and animation for that state
- **Postcondition**: The Stage-terminal dot reflects the wrapped-agent state on the direct wrapped-agent owner
- **Business Rules**:
  - BR-7: Only a direct wrapped-agent owner `Terminal` in Stage may render the wrapped-agent dot
  - BR-8: `Running` renders a solid green Stage-terminal dot
  - BR-9: Dock chrome does not render the wrapped-agent dot, even when the docked `Pane` is a `Terminal`
  - BR-10: Unresolved `Idle` and `NeedsInput` render the same orange blinking Stage-terminal dot family from a stable blink clock that does not reset every frame

### UC-4: RenderWorkspaceIndicatorChrome

- **Actor**: System
- **Trigger**: Workspace rail chrome rendering when any Stage `Terminal` in that `Workspace` has direct wrapper-managed lifecycle state
- **Precondition**: The target `Workspace` contains at least one Stage `Terminal`
- **Flow**:
  1. Tide resolves the strongest Stage-terminal wrapped-agent state in the `Workspace`
  2. Tide maps the strongest Stage-terminal state to the Workspace item dot with alert precedence
  3. Tide renders the same strongest-state mapping for active and inactive `Workspace`s
- **Postcondition**: Workspace items reflect the strongest Stage-terminal wrapped-agent state with a dot-only indicator
- **Business Rules**:
  - BR-11: A `Workspace` item with unresolved Stage-terminal `Idle` or `NeedsInput` renders an orange blinking dot from the same stable blink clock
  - BR-12: A `Workspace` item with Stage-terminal `Running` and no alert renders a green dot
  - BR-13: A `Workspace` item with both running and alerting Stage terminals renders the orange alert state
  - BR-14: A `Workspace` item with only connected-idle Stage terminals renders the idle-presence dot

### UC-5: RenderOverflowedAlertEdgeIndicator

- **Actor**: System
- **Trigger**: Shared-tab rendering for a `ViewMode::Stacked` Stage tab strip with alert tabs outside the visible scroll region
- **Precondition**: At least one direct wrapped-agent Stage `Terminal` tab with unresolved `Idle` or `NeedsInput` is clipped by shared-tab scrolling
- **Flow**:
  1. Tide computes the visible shared-tab range after scroll offset and clipping
  2. Tide determines whether alert tabs exist left of the visible range, right of the visible range, or both
  3. Tide renders the orange blinking edge indicator on the corresponding tab-strip edge
- **Postcondition**: Hidden wrapped-agent alert tabs remain discoverable while scrolled out of view
- **Business Rules**:
  - BR-14: A hidden alert tab left of the visible range renders an orange blinking left-edge indicator
  - BR-15: A hidden alert tab right of the visible range renders an orange blinking right-edge indicator

### UC-6: PreserveHeaderTitleBesideGitBadges

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
  - BR-16: Active single-pane headers keep a readable title when git branch or git status badges are present
  - BR-17: Active stacked Stage tabs keep a readable title when git branch or git status badges are present
  - BR-18: Optional git badges yield space before the visible title disappears

### UC-7: RenderSharedTabSizingAndReadableTerminalLabels

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
  - BR-19: Shared tab chrome uses a slightly larger height, padding, and row-aware active-tab width budget across stacked Stage tabs, Dock tabs, and single-Pane headers
  - BR-20: Focused tabs use a brighter tint than unfocused tabs in the shared header and tab-bar rendering paths
  - BR-21: Busy `Terminal Pane` headers use a readable label color instead of the dimmed badge color path
  - BR-22: The shared active-tab width budget stretches with the available row width after sibling tabs reserve their minimum width, enough to keep both `plain` and `comment` badges visible for an active live-preview `Markdown Pane` while preserving the minimum title region
  - BR-23: A stacked Stage active `Terminal Pane` keeps its git branch and git status badges visible when the row still has spare width after sibling tabs reserve their minimum width, including when the same tab renders a connected-agent status dot
  - BR-24: Overflowed shared tab bars preserve explicit horizontal scroll; active-tab auto-fit runs when the active `Pane` changes, but not on every render against a manual user scroll offset
  - BR-25: A precise shared-tab gesture uses horizontal delta before vertical fallback, so diagonal trackpad strokes follow horizontal intent instead of being steered by vertical fallback
  - BR-26: A fresh shared-tab trackpad stroke or immediate direction change produces a modest visible starter step, but continuous events use lighter motion instead of applying the same hard minimum step to every delta
  - BR-27: Shared tab bars use the same horizontal scroll direction convention as editor and diff panes
  - BR-28: Shared tab scroll offset is clamped to the visible bounds when input is applied, so reversing from the far edge does not wait for hidden overscroll debt to drain
  - BR-29: PTY output schedules terminal badge refresh on the next frame-scale delay rather than a 150ms timer, so git badges appear promptly after output settles
  - BR-30: Header-area scroll is only consumed by an overflowed shared tab bar; single-pane headers and non-overflowing shared headers fall through to pane scroll handling
  - BR-31: A `Terminal Pane` `cwd` change clears stale git branch, git status, and worktree chrome immediately before fresh poll results arrive
  - BR-32: The background git poller prefers the latest pending `cwd` refresh request before publishing repo chrome results, so fast repo-to-repo navigation does not wait behind obsolete polls
  - BR-37: Stacked Stage shared-tab scroll bounds must use the same leading `ViewMode` control and trailing header action reservations as rendering, so a visually clipped Stage tab bar accepts horizontal scroll just like Dock tab bars.
  - BR-38: Dock shared-tab scroll bounds must include the leading Terminal Context Surface `ViewMode` control when that control is rendered, so the tab strip can scroll far enough to reveal tabs hidden behind the leading control.

### UC-9: CollapseSingleDockTabGroupChrome

- **Actor**: System
- **Trigger**: Chrome rendering for a Dock `TabGroup` or Stacked Terminal Context Surface
- **Precondition**: The Dock `TabGroup` or Stacked Terminal Context Surface contains one or more tabs
- **Flow**:
  1. Tide resolves the Dock `TabGroup` size before choosing the chrome path.
  2. If the Dock `TabGroup` has two or more tabs, Tide renders the shared Dock tab bar.
  3. If the Dock `TabGroup` has exactly one tab, Tide renders the normal single-`Pane` header for that `Pane`.
  4. If Stacked Terminal Context Surface has exactly one `Pane`, Tide renders the normal single-`Pane` header for that active `Pane`.
- **Postcondition**: Single-tab Dock chrome no longer pretends to be a stretched shared tab bar.
- **Business Rules**:
  - BR-35: A Dock `TabGroup` with exactly one tab must use single-`Pane` header chrome instead of the shared Dock tab bar.
  - BR-36: A Stacked Terminal Context Surface with exactly one `Pane` must use single-`Pane` header chrome instead of the shared Dock stacked tab bar.

## Invariants

1. Focus chrome does not depend on wrapper-managed agent state.
2. Wrapped-agent attention uses a dot-only projection on direct Stage `Terminal` chrome and `Workspace` items.
3. Wrapped-agent dots appear only on Workspace items and direct wrapped-agent Stage `Terminal` chrome.
4. Ordinary focus does not introduce a new full-pane outline around the terminal body.
5. Header title preservation rules apply consistently to single-pane headers and active tabs.
6. Shared tab sizing changes apply consistently to stacked Stage tabs, Dock tabs, and single-pane headers.
7. Wrapped-agent alert blink uses a stable timebase instead of per-frame elapsed time.
8. `Wrapped Agent Presence` may render an idle-presence dot, but it must not route macOS notifications by itself.
9. Dock shared tab chrome appears only for Dock `TabGroup`s with two or more tabs.

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-1 | BR-1 | `focused_header_accent_is_visually_distinct_from_unfocused_chrome` |
| UC-1 | BR-2 | `focused_header_accent_renders_without_agent_status` |
| UC-2 | BR-3 | `stage_terminal_attention_does_not_use_pane_surface_fill_or_underline` |
| UC-2 | BR-4 | `idle_and_needs_input_share_the_same_stage_terminal_alert_family` |
| UC-2 | BR-5 | `editor_does_not_inherit_wrapped_agent_chrome_from_associated_terminal` |
| UC-2 | BR-6 | `focused_stage_terminal_keeps_its_alert_dot_until_acknowledged` |
| UC-3 | BR-7 | `running_stage_terminal_renders_the_wrapped_agent_dot` |
| UC-3 | BR-8 | `running_stage_terminal_uses_a_green_dot_signal` |
| UC-3 | BR-9 | `dock_terminal_does_not_render_the_wrapped_agent_dot` |
| UC-3 | BR-10 | `attention_stage_terminal_renders_an_orange_blinking_dot` |
| UC-3 | BR-10 | `wrapped_agent_alert_blink_uses_a_stable_timebase` |
| UC-4 | BR-11 | `inactive_workspace_alert_renders_an_orange_blinking_dot` |
| UC-4 | BR-11 | `active_workspace_alert_renders_an_orange_blinking_dot` |
| UC-4 | BR-12 | `workspace_running_renders_a_green_dot` |
| UC-4 | BR-13 | `workspace_alert_takes_precedence_over_running` |
| UC-4 | BR-14 | `workspace_connected_idle_renders_an_idle_presence_dot` |
| UC-5 | BR-14 | `overflowed_alert_stage_tab_sets_the_left_edge_indicator` |
| UC-5 | BR-15 | `overflowed_alert_stage_tab_sets_the_right_edge_indicator` |
| UC-6 | BR-16 | `active_terminal_header_preserves_title_when_git_badges_are_present` |
| UC-6 | BR-17 | `active_stage_tab_preserves_title_when_git_badges_are_present` |
| UC-6 | BR-18 | `git_badges_yield_space_before_title_disappears` |
| UC-7 | BR-19 | `shared_tab_chrome_is_slightly_larger_across_all_surfaces` |
| UC-7 | BR-20 | `focused_tabs_use_a_brighter_tint_than_unfocused_tabs` |
| UC-7 | BR-21 | `busy_terminal_labels_use_a_readable_color_path` |
| UC-7 | BR-22 | `active_markdown_live_preview_chrome_keeps_plain_and_comment_badges_visible` |
| UC-7 | BR-23 | `stacked_stage_active_terminal_tab_keeps_git_status_badges_when_agent_dot_is_present` |
| UC-7 | BR-24 | `overflowed_shared_tab_bar_keeps_the_active_tab_visible` |
| UC-7 | BR-24 | `manual_shared_tab_scroll_does_not_snap_back_to_the_active_tab` |
| UC-7 | BR-25 | `shared_tab_scroll_prioritizes_horizontal_delta_before_vertical_fallback` |
| UC-7 | BR-26 | `shared_tab_scroll_uses_a_modest_starter_step_only_for_fresh_gestures` |
| UC-7 | BR-26 | `shared_tab_scroll_treats_direction_change_as_a_fresh_gesture` |
| UC-7 | BR-27 | `shared_tab_scroll_matches_editor_horizontal_direction` |
| UC-7 | BR-28 | `shared_tab_scroll_offset_clamps_at_visible_bounds` |
| UC-7 | BR-29 | `terminal_badge_refresh_delay_matches_a_single_frame_scale_budget` |
| UC-7 | BR-30 | `single_pane_header_scroll_falls_through_to_preview_content` |
| UC-7 | BR-31 | `terminal_cwd_change_clears_stale_git_badges_before_poll_results_arrive` |
| UC-7 | BR-32 | `git_poller_prefers_the_latest_cwd_request_after_quick_repo_switches` |
| UC-7 | BR-37 | `stacked_stage_tab_bar_scroll_uses_rendered_tab_bounds` |
| UC-7 | BR-38 | `dock_tab_bar_scroll_uses_rendered_view_mode_bounds` |
| UC-8 | BR-33 | `connected_wrapped_agent_without_active_status_renders_idle_presence_dot` |
| UC-8 | BR-34 | `workspace_connected_idle_renders_an_idle_presence_dot` |
| UC-9 | BR-35 | `dock_single_tab_group_uses_single_pane_header_chrome` |
| UC-9 | BR-36 | `dock_stacked_single_pane_uses_single_pane_header_chrome` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Action service | `crates/tide-app/src/application/services/action_service/mod.rs` | Direct wrapped-agent Stage-terminal status resolution for pane chrome |
| Chrome renderer | `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs` | Stage-terminal dot placement plus overflow edge indicators |
| Header renderer | `crates/tide-app/src/adapter/outward/view/header.rs` | Stage-terminal dot rendering plus title and git badge layout |
| Workspace rail renderer | `crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs` | Workspace item running/alert dot rendering |
| Theme palette | `crates/tide-app/src/theme.rs` | Colors and spacing tokens used by the new chrome treatment and shared tab sizing |
| Terminal badge updater | `crates/tide-app/src/application/services/file_tree_service/mod.rs` | Cached `cwd` and git chrome synchronization for `Terminal Pane` badges |
