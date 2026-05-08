# Spec: Visual Hierarchy

## Overview

### As-Is
`docs/specs/open-terminal-codex-app.md` defines the product hierarchy as `Workspace` navigation, Stage execution, Terminal Context Surface support, and FileTree View navigation. Current source includes `HeaderSurfaceKind` in `crates/tide-app/src/adapter/outward/view/header.rs`, `FileIconKind` in `crates/tide-app/src/adapter/outward/view/ui.rs`, and `SurfaceVisibilityAnimation` paths covered by `crates/tide-app/src/application/behavior_tests/visual_hierarchy.rs`.

The visual hierarchy work separates Stage and Terminal Context Surface header weight, gives FileTree View layered icon grammar, and animates Dock, FileTree View, and Workspace rail visibility while preserving Stage split ratios during side-surface motion.
`crates/tide-app/src/layout_compute.rs` also derives Stage rects by snapping `SplitLayout` ratios to terminal `Cell Size` boundaries before computing Pane rects. Because that snap writes back into the Stage `SplitLayout`, a Tide Window resize can move the stored `Ratio` toward the current pixel width and away from the user's chosen proportional split.

Remaining polish in this area should preserve the same product hierarchy: Workspace rail for task navigation, Stage for primary execution, Terminal Context Surface for support context, and FileTree View for filesystem navigation.

### To-Be
Stage, Terminal Context Surface, and FileTree View use different visual grammars:

1. Stage single `Pane` headers are quiet session chrome. They preserve title, close, Stage-terminal attention dots, and mouse-first creation controls, but do not draw the full active tab slab or top active-tab accent.
2. Terminal Context Surface keeps context chrome. Single context `Pane`s may use tab backgrounds, active indicators, comment badges, and context creation or split actions. Focused single context `Pane` headers keep the region `ViewMode` control visible above active header chrome. Stacked mode tab bars use add-pane creation affordances instead of split-direction affordances.
3. FileTree View uses layered icon grammar: disclosure chevrons are separate from folder/file glyphs, and special project files classify to stable icon kinds before rendering.
4. Dock, FileTree View, and Workspace rail toggles animate width over a short ease-out transition while keeping layout and hit-test state coherent.
5. Titlebar surface toggles use larger icon-only controls with distinct hover and active backdrops. Keyboard shortcuts stay in input behavior and are not rendered as persistent hotkey hints in the titlebar.
6. While a side surface is animating, Stage `SplitLayout` proportions remain stable until the surface reaches its settled width.
7. A `Full-Screen Space` keeps Tide's own titlebar surface visible so Workspace rail, Dock, FileTree View, theme, settings, and integration controls remain available without leaving fullscreen.
8. New Stage and Terminal Context Surface splits reveal through a short `SplitTransitionAnimation` instead of snapping both panes to the final ratio in one frame.
9. Closing a visible split in Stage or Terminal Context Surface Split mode collapses through the same transition grammar before removing the closed `Pane`.
10. Tide Window resize preserves stored Stage `SplitLayout` `Ratio`; terminal `Cell Size` alignment is derived from transient layout state that leaves the saved split proportion unchanged.

### Approach
1. Add a `HeaderSurfaceKind` decision to header chrome so Stage and Terminal Context Surface can share layout primitives without sharing visual weight.
2. Add pure header-surface helpers for behavior tests before changing renderer paths.
3. Add `FileIconKind` and disclosure helpers in `ui.rs`, while keeping `file_icon()` as a compatibility wrapper.
4. Render FileTree rows with separate disclosure and icon columns.
5. Add `SurfaceVisibilityAnimation` as pure state used by Dock, FileTree View, and Workspace rail.
6. Drive visibility animations from the event loop by keeping redraws alive while an animation is active.
7. Normalize chrome icon glyphs around a small quiet set: lightweight FileTree chevrons, restrained document glyphs for project-special files, icon-only titlebar toggles, vector titlebar action icons, Browser Pane navigation icons, and requested Flaticon chrome roles backed by exact `RasterIconAsset` PNG sources instead of hand-authored replacement SVG.
8. Treat side-surface visibility animation like an active border drag for Stage ratio snapping so intermediate animated widths do not rewrite `SplitLayout` ratios.
9. Keep the Tide-rendered titlebar inset during `Full-Screen Space` transitions instead of collapsing it to zero.
10. Compute terminal-cell-snapped Stage rects from transient layout state so stable layout passes can align rendered panes without mutating the stored Stage `SplitLayout` `Ratio`.

## Bounded Contexts

| Context | Role |
|---------|------|
| `adapter/outward/view/header` | Resolves Stage vs Terminal Context Surface header chrome. |
| `adapter/outward/view/chrome/file_tree` | Renders FileTree disclosure, icon, and row text columns. |
| `adapter/outward/view/ui` | Classifies file icon kinds and compatibility glyphs. |
| `domain/state` | Stores pure `SurfaceVisibilityAnimation` and `SplitTransitionAnimation` state for layout animation. |
| `layout_compute` | Uses animated widths and split ratios when computing Workspace rail, Stage, Terminal Context Surface, and FileTree View rects. |
| `adapter/inward/event_loop_adapter` | Keeps redraw ticking while layout animation is active. |

## Use Cases

### UC-1: RenderQuietStageHeader

- **Actor**: System
- **Trigger**: Chrome rendering for a single Stage `Pane`
- **Precondition**: The `Pane` is visible in Stage and is not part of a stacked Stage tab bar
- **Flow**:
  1. Tide resolves `HeaderSurfaceKind::Stage`.
  2. Tide preserves title, close hit zone, and direct Stage `Terminal` attention dot.
  3. Tide skips the full-width active tab background and top active indicator.
  4. Tide renders a low-weight `HeaderActionStrip` for splitting the Stage `Pane`.
- **Postcondition**: Stage reads as the primary live surface rather than another context tab strip.
- **Business Rules**:
  - BR-1: Stage single `Pane` headers must not draw the active tab slab or top active indicator.
  - BR-2: Stage single `Pane` headers must expose SplitHorizontal and SplitVertical `HeaderActionStrip` actions without drawing active tab chrome.
  - BR-3: Stage single `Pane` headers must still reserve title and close hit zones.

### UC-2: RenderContextHeader

- **Actor**: System
- **Trigger**: Chrome rendering for a single Terminal Context Surface `Pane`
- **Precondition**: The `Pane` is visible inside the active Stage `Terminal`'s Terminal Context Surface
- **Flow**:
  1. Tide resolves `HeaderSurfaceKind::TerminalContextSurface`.
  2. Tide keeps the active tab background and top active indicator for focused context `Pane`s.
  3. Tide keeps context creation and split controls in the `HeaderActionStrip`.
- **Postcondition**: Terminal Context Surface still reads as a tabbed supporting context region.
- **Business Rules**:
  - BR-4: Terminal Context Surface single `Pane` headers keep active tab chrome when focused.
  - BR-5: Terminal Context Surface headers keep context `HeaderActionStrip` controls.
  - BR-21: Stage and Terminal Context Surface stacked mode tab bars use one AddPane `+` action instead of direct Browser Pane or split-direction icons.
  - BR-23: Titlebar surface toggles render right-to-left as FileTree View, Dock, Workspace rail, using vector `TitlebarSurfaceIcon` roles instead of font-dependent private glyphs.

### UC-3: RenderLayeredFileTreeIcons

- **Actor**: System
- **Trigger**: FileTree View row rendering
- **Precondition**: FileTree View has visible rows
- **Flow**:
  1. Tide classifies each row into a `FileIconKind`.
  2. Tide renders directory disclosure as a separate chevron.
  3. Tide renders folder/file glyphs after the disclosure column.
  4. Tide renders the file name after the icon column.
- **Postcondition**: FileTree View reads as structured navigation instead of one undifferentiated glyph list.
- **Business Rules**:
  - BR-6: Directory rows expose a disclosure chevron separate from the folder glyph.
  - BR-7: Project-special files such as `README.md`, `AGENTS.md`, `.gitignore`, and `Cargo.toml` map to stable `FileIconKind`s before rendering.
  - BR-8: `file_icon()` remains a compatibility wrapper over `FileIconKind`.
  - BR-52: FileTree View defaults to a compact 200px width with a 160px minimum resize width.
  - BR-53: FileTree View row highlights and expanded directory slabs are clipped to the entries area below the header before rendering.

### UC-4: AnimateSideSurfaceVisibility

- **Actor**: User
- **Trigger**: User toggles Dock, FileTree View, or Workspace rail
- **Precondition**: A Workspace is active
- **Flow**:
  1. Tide starts a `SurfaceVisibilityAnimation` from the current rendered width to the target width.
  2. Tide computes layout from the animated width while the animation is active.
  3. Tide keeps redraw ticking until the animation reaches its target.
  4. Tide clears animation state after completion.
- **Postcondition**: Dock, FileTree View, and Workspace rail open and close as attached side surfaces instead of snapping.
- **Business Rules**:
  - BR-9: `SurfaceVisibilityAnimation` uses a bounded ease-out transition from current width to target width.
  - BR-10: Toggling Dock starts a width animation.
  - BR-11: Toggling FileTree View starts a width animation.
  - BR-12: Active surface visibility animations keep the event loop scheduling redraws.
  - BR-17: The first Dock open must animate even when Tide creates the initial Launcher context `Pane`.
  - BR-18: Toggling Workspace rail starts a width animation.
  - BR-22: Adding a Pane to a closed Terminal Context Surface through `add_pane_to_dock()` starts the same width animation as an explicit Dock toggle.
  - BR-25: Closing Terminal Context Surface animation must not keep a minimum-width `Pane` visual rect alive past the Terminal Context Surface bounds into FileTree View.
  - BR-26: Active side-surface visibility animation must not mutate Stage `SplitLayout` ratios from their pre-animation values.
  - BR-51: When FileTree View is visible, Terminal Context Surface visibility animation must target the same right-side support width as the settled layout so a short stored Terminal Context Surface width does not jump wider on the completion frame.
  - BR-44: Creating a Stage split starts a `SplitTransitionAnimation` from a narrow new Pane ratio toward the settled split ratio.
  - BR-44a: Stage split transition timing starts after Terminal creation completes, so Terminal startup latency cannot consume the `SplitTransitionAnimation` before the first rendered frame.
  - BR-45: Creating a Terminal Context Surface split starts a `SplitTransitionAnimation` from a narrow new Pane ratio toward the settled split ratio.
  - BR-46: Active split transition animation keeps the event loop scheduling redraws and is treated like transient layout motion for ratio snapping and terminal backend resize pacing.
  - BR-49: Closing a visible Stage or Terminal Context Surface split starts a closing `SplitTransitionAnimation` before removing the closing `Pane`.
  - BR-49a: `GlobalAction::ClosePane` and Pane close hit zones use the split close transition path for visible Stage or Terminal Context Surface splits.
  - BR-54: Tide Window resize preserves Stage `SplitLayout` ratios from their pre-resize values.

### UC-5: NormalizeChromeIcons

- **Actor**: System
- **Trigger**: Titlebar, Workspace navigation, and FileTree View chrome rendering
- **Precondition**: Tide is rendering persistent navigation chrome
- **Flow**:
  1. Tide renders directory disclosure with lightweight chevrons instead of filled triangle glyphs.
  2. Tide renders project-special files with a restrained document glyph set instead of mixed decorative Nerd Font glyphs.
  3. Tide renders titlebar surface toggles as larger icon-only controls.
  4. Tide keeps titlebar hit-testing aligned to the rendered icon-only control width.
  5. Tide renders titlebar buttons with separate rest, hover, active, and active-hover backdrop states.
  6. Tide renders the FileTree View titlebar toggle with the `TitlebarSurfaceIcon::FileTree` vector icon and no text glyph fallback.
  7. Tide renders Integration and settings actions through `TitlebarActionIcon` vector roles instead of font-dependent text glyphs.
  8. Tide moves theme switching out of titlebar icon chrome and into ConfigPage Appearance text.
  9. Tide uses the leading titlebar lane for active `Workspace` identity plus cwd metadata, leaving the center visually quiet.
  10. Tide renders Stage and Terminal Context Surface `ViewMode` controls inside the corresponding region header, not as titlebar controls and not as repeated actions on every `Pane`.
  11. Tide renders the repeated header creation action as AddPane for opening a Launcher Pane, not as direct Browser Pane creation.
  12. Tide renders Browser Pane OpenExternal and FileTree external handoff actions with a shared OpenExternal vector role instead of text glyphs.
  13. Tide renders close affordances as vector cancel marks instead of private font glyphs.
  14. Tide renders remaining icon diagonals, arrows, circular strokes, and outlines through the renderer `SVG Icon Renderer` instead of square-step rect fragments.
  15. Tide renders requested Flaticon chrome roles through `RasterIconAsset` source PNGs and the `Raster Icon Renderer`.
- **Postcondition**: Persistent chrome reads as a quiet control layer instead of a noisy icon sample sheet.
- **Business Rules**:
  - BR-13: FileTree disclosure glyphs must be lightweight chevrons, not filled triangle glyphs.
  - BR-14: Project-special files must resolve to stable `FileIconKind`s while sharing restrained document glyphs.
  - BR-15: Titlebar surface toggle buttons must not render persistent hotkey hint text.
  - BR-16: Titlebar surface toggle hit targets must use the same larger width as the rendered icon-only controls.
  - BR-19: Titlebar surface toggle glyphs must render above the base terminal cell size.
  - BR-20: Titlebar surface toggles must expose distinct backdrop levels for rest, hover, active, and active-hover states.
  - BR-23: Titlebar surface toggles render right-to-left as FileTree View, Dock, Workspace rail, using vector `TitlebarSurfaceIcon` roles instead of font-dependent private glyphs.
  - BR-24: The FileTree View titlebar toggle must use the `TitlebarSurfaceIcon::FileTree` vector icon with no font-dependent text glyph fallback.
  - BR-29: The titlebar must not reserve a right-edge swap control; settings is the rightmost titlebar button.
  - BR-30: Integration and settings titlebar actions must use `TitlebarActionIcon` vector roles with no font-dependent text glyph fallback.
  - BR-31: The titlebar identity must be leading-aligned and must expose the active `Workspace` title plus cwd metadata when available.
  - BR-50: In a `Full-Screen Space`, the titlebar identity origin must move to the left content inset instead of reserving the non-fullscreen macOS traffic-light lane.
  - BR-32: Theme switching must not be exposed as a titlebar icon action.
  - BR-33: Stage and Terminal Context Surface `ViewMode` controls must render through header vector icon roles with no font-dependent text glyph fallback.
  - BR-34: The Stage region header `ViewMode` control must target Stage Split/Stacked state, regardless of whether focus is currently in Dock.
  - BR-35: The Terminal Context Surface region header `ViewMode` control must target Terminal Context Surface Split/Stacked state without changing Stage `ViewMode`.
  - BR-36: Stage and Terminal Context Surface `ViewMode` controls must not be part of the default repeated Pane `HeaderActionStrip`.
  - BR-37: In stacked mode, the region `ViewMode` control must reuse the existing leading stack slot instead of adding a separate trailing control.
  - BR-38: In split mode, each region `ViewMode` control must follow that region's focused `Pane` instead of staying pinned to a fixed header.
  - BR-39: A focused single Terminal Context Surface `Pane` must paint its leading `ViewMode` control after the active header background so the Split/Stacked icon remains visible.
  - BR-40: AddPane, SplitHorizontal, SplitVertical, EnterStackMode, and EnterSplitMode controls must resolve to `HeaderActionIcon` vector roles with no font-dependent text glyph fallback.
  - BR-41: Browser Pane OpenExternal and FileTree external handoff actions must resolve to a shared OpenExternal vector role with no font-dependent text glyph fallback.
  - BR-42: Header, TabGroup, and Search close affordances must render vector cancel marks instead of private font glyphs.
  - BR-43: HeaderActionIcon, BrowserNavIcon, ContextMenuIcon, TitlebarSurfaceIcon, TitlebarActionIcon, and Search close icon rendering must use renderer icon paths and must not build diagonal marks by stacking square rect fragments.
  - BR-47: Requested Flaticon roles must map to exact `RasterIconAsset` source ids and URLs: SplitVertical `14096749`, SplitHorizontal `14096753`, Browser `2530583`, OpenExternal `8944297`, Close `659891`, EnterStackMode `10134300`, EnterSplitMode `3405258`, Settings `2040504`, Workspace rail `8379699`, FileTree View `8379768`, Dock `4225584`, and Integration `5089783`.
  - BR-48: Requested Flaticon roles must draw through the `Raster Icon Renderer`; hand-authored SVG constants must not be the rendering source for those roles.

### UC-6: PreserveTitlebarControlsInFullScreen

- **Actor**: User
- **Trigger**: A `Tide Window` enters a `Full-Screen Space`
- **Precondition**: Tide has an active Workspace and titlebar controls are available before fullscreen
- **Flow**:
  1. Tide receives the native fullscreen transition event.
  2. Tide records fullscreen state while keeping the Tide-rendered titlebar inset.
  3. Tide recomputes layout below that titlebar inset.
  4. Tide hit-tests titlebar controls using the same visible titlebar geometry.
- **Postcondition**: Fullscreen preserves app-level navigation and surface toggles.
- **Business Rules**:
  - BR-27: Entering a `Full-Screen Space` must keep the Tide-rendered titlebar inset nonzero.
  - BR-28: Titlebar surface toggle hit targets must remain available inside a `Full-Screen Space`.

## Invariants

- Stage remains the primary execution surface and does not inherit Terminal Context Surface tab weight.
- Terminal Context Surface remains attached support and keeps context tab affordances.
- FileTree View is not a `PaneKind`.
- Workspace rail is not a `PaneKind`.
- `SurfaceVisibilityAnimation` changes computed width only; it does not create or remove `PaneId`s.
- Opening `SplitTransitionAnimation` changes computed split ratio only; closing `SplitTransitionAnimation` defers existing `PaneId` removal until the transition completes.
- Animation completion must leave `dock_open`, `FileTreeModel.visible`, and `WorkspaceManager.show_sidebar` as the target visibility truth.
- Split transition completion must leave the affected `SplitLayout` at its settled ratio.

## Tests

| UC | BR | Test function |
|----|----|---------------|
| UC-1 | BR-1/BR-2 | `stage_single_pane_header_uses_quiet_session_chrome_with_actions` |
| UC-1 | BR-3 | `stage_single_pane_header_still_reserves_title_and_close` |
| UC-2 | BR-4/BR-5 | `terminal_context_surface_header_keeps_context_tab_chrome` |
| UC-2 | BR-21 | `stacked_tab_bar_header_uses_plus_instead_of_split_actions` |
| UC-3 | BR-6 | `directory_file_tree_rows_have_separate_disclosure_and_icon` |
| UC-3 | BR-7 | `project_special_files_map_to_stable_icon_kinds` |
| UC-3 | BR-8 | `file_icon_uses_file_icon_kind_as_compatibility_wrapper` |
| UC-3 | BR-52 | `file_tree_view_default_width_is_compact` |
| UC-3 | BR-53 | `file_tree_row_highlight_clips_to_entries_below_header` |
| UC-4 | BR-9 | `surface_visibility_animation_eases_width_to_target` |
| UC-4 | BR-10 | `toggle_dock_starts_surface_visibility_animation` |
| UC-4 | BR-11 | `toggle_file_tree_starts_surface_visibility_animation` |
| UC-4 | BR-12 | `active_surface_visibility_animation_keeps_redraw_scheduled` |
| UC-4 | BR-17 | `first_dock_toggle_with_empty_context_starts_surface_visibility_animation` |
| UC-4 | BR-18 | `toggle_workspace_rail_starts_surface_visibility_animation` |
| UC-4 | BR-22 | `adding_pane_to_closed_dock_starts_surface_visibility_animation` |
| UC-4 | BR-25 | `closing_dock_animation_does_not_overlap_file_tree_view` |
| UC-4 | BR-26 | `stage_split_ratio_stays_stable_during_side_surface_visibility_animation` |
| UC-4 | BR-51 | `dock_opening_animation_finishes_without_width_jump_when_file_tree_is_visible` |
| UC-4 | BR-44 | `stage_split_with_launcher_starts_split_transition_animation` |
| UC-4 | BR-44a | `stage_split_transition_starts_after_terminal_creation_latency` |
| UC-4 | BR-45 | `dock_split_header_action_starts_split_transition_animation` |
| UC-4 | BR-46 | `split_transition_animation_eases_ratio_to_target` |
| UC-4 | BR-49 | `closing_stage_split_starts_split_transition_animation_before_removal` |
| UC-4 | BR-49 | `closing_dock_split_starts_split_transition_animation_before_removal` |
| UC-4 | BR-49a | `global_close_pane_starts_split_transition_animation_before_removal` |
| UC-4 | BR-54 | `stage_split_ratio_stays_stable_during_tide_window_resize` |
| UC-5 | BR-13 | `directory_file_tree_rows_use_lightweight_disclosure_chevrons` |
| UC-5 | BR-14 | `project_special_file_icons_share_restrained_document_glyphs` |
| UC-5 | BR-15/BR-16/BR-19 | `titlebar_surface_toggles_are_icon_only_larger_controls` |
| UC-5 | BR-20 | `titlebar_surface_toggles_have_distinct_backdrop_levels` |
| UC-5 | BR-23 | `titlebar_surface_toggles_use_dock_filetree_workspace_order_and_icons` |
| UC-5 | BR-24 | `titlebar_file_tree_toggle_uses_vector_icon_without_text_glyph` |
| UC-5 | BR-29 | `titlebar_controls_do_not_expose_titlebar_swap` |
| UC-5 | BR-30 | `titlebar_actions_use_vector_icons_without_text_glyphs` |
| UC-5 | BR-31 | `titlebar_identity_uses_leading_workspace_and_cwd_metadata` |
| UC-5 | BR-50 | `fullscreen_titlebar_identity_origin_uses_left_content_inset` |
| UC-5 | BR-32 | `titlebar_does_not_expose_theme_icon_action` |
| UC-5 | BR-33 | `region_header_view_mode_toggles_use_vector_icons_without_text_glyphs` |
| UC-5 | BR-34 | `stage_header_view_mode_click_targets_stage_from_dock_focus` |
| UC-5 | BR-35 | `dock_header_view_mode_click_targets_terminal_context_surface_only` |
| UC-5 | BR-36 | `view_mode_controls_are_not_pane_header_actions` |
| UC-5 | BR-37 | `region_header_view_mode_controls_use_the_leading_slot` |
| UC-5 | BR-38 | `stage_region_header_view_mode_control_follows_stage_focus` |
| UC-5 | BR-38 | `dock_region_header_view_mode_control_follows_terminal_context_surface_focus` |
| UC-5 | BR-39 | `focused_terminal_context_surface_view_mode_icon_paints_after_active_header_background` |
| UC-5 | BR-40 | `header_action_icons_use_requested_vector_roles_without_text_glyphs` |
| UC-5 | BR-41 | `external_open_actions_share_vector_icon_without_text_glyphs` |
| UC-5 | BR-42 | `close_affordances_use_vector_icons_without_text_glyphs` |
| UC-5 | BR-43 | `chrome_icons_use_svg_icon_renderer_instead_of_square_steps` |
| UC-5 | BR-47 | `requested_flaticon_icons_resolve_to_exact_raster_assets` |
| UC-5 | BR-48 | `requested_flaticon_icons_use_raster_icon_renderer` |
| UC-6 | BR-27/BR-28 | `fullscreen_keeps_titlebar_surface_toggles_visible_and_clickable` |

## Location

- `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs`
- `crates/tide-app/src/adapter/outward/view/header.rs`
- `crates/tide-app/src/adapter/outward/view/chrome/file_tree.rs`
- `crates/tide-app/src/adapter/outward/view/ui.rs`
- `crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs`
- `crates/tide-app/src/adapter/inward/click_adapter/hit_test.rs`
- `crates/tide-app/src/domain/state/surface_animation.rs`
- `crates/tide-app/src/domain/state/workspace_mgr.rs`
- `crates/tide-app/src/layout_compute.rs`
- `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs`
- `crates/tide-app/src/application/behavior_tests/visual_hierarchy.rs`
