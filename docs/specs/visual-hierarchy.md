# Spec: Visual Hierarchy

## Overview

### As-Is
`docs/specs/open-terminal-codex-app.md` defines the product hierarchy as `Workspace` navigation, Stage execution, Terminal Context Surface support, and FileTree View navigation. The current rendering path still makes Stage and Terminal Context Surface visually too similar because single `Pane` headers share the same active background, top accent, `HeaderActionStrip`, title, badge, and close-button grammar through `render_pane_header_inner()` in `crates/tide-app/src/adapter/outward/view/header.rs`.

FileTree View also uses a single `file_icon()` glyph path in `crates/tide-app/src/adapter/outward/view/ui.rs`. It has folder/file glyphs and extension glyphs, but it does not separate disclosure, icon kind, and special project files into distinct visual roles.

Dock, FileTree View, and Workspace rail visibility is currently boolean-first. `DockState.dock_open`, `FileTreeModel.visible`, and `WorkspaceManager.show_sidebar` can immediately change layout width, so opening and closing side surfaces may snap instead of reading as a native attached surface transition. The first Dock open path is especially brittle because creating the initial Launcher context `Pane` clears `DockState.visibility_animation`.

### To-Be
Stage, Terminal Context Surface, and FileTree View use different visual grammars:

1. Stage single `Pane` headers are quiet session chrome. They preserve title, close, Stage-terminal attention dots, and mouse-first creation controls, but do not draw the full active tab slab or top active-tab accent.
2. Terminal Context Surface keeps context chrome. Single context `Pane`s may use tab backgrounds, active indicators, comment badges, and context creation or split actions. Stacked mode tab bars use add-pane creation affordances instead of split-direction affordances.
3. FileTree View uses layered icon grammar: disclosure chevrons are separate from folder/file glyphs, and special project files classify to stable icon kinds before rendering.
4. Dock, FileTree View, and Workspace rail toggles animate width over a short ease-out transition while keeping layout and hit-test state coherent.
5. Titlebar surface toggles use larger icon-only controls with distinct hover and active backdrops. Keyboard shortcuts stay in input behavior and are not rendered as persistent hotkey hints in the titlebar.

### Approach
1. Add a `HeaderSurfaceKind` decision to header chrome so Stage and Terminal Context Surface can share layout primitives without sharing visual weight.
2. Add pure header-surface helpers for behavior tests before changing renderer paths.
3. Add `FileIconKind` and disclosure helpers in `ui.rs`, while keeping `file_icon()` as a compatibility wrapper.
4. Render FileTree rows with separate disclosure and icon columns.
5. Add `SurfaceVisibilityAnimation` as pure state used by Dock, FileTree View, and Workspace rail.
6. Drive visibility animations from the event loop by keeping redraws alive while an animation is active.
7. Normalize chrome icon glyphs around a small quiet set: lightweight FileTree chevrons, restrained document glyphs for project-special files, and icon-only titlebar toggles.

## Bounded Contexts

| Context | Role |
|---------|------|
| `adapter/outward/view/header` | Resolves Stage vs Terminal Context Surface header chrome. |
| `adapter/outward/view/chrome/file_tree` | Renders FileTree disclosure, icon, and row text columns. |
| `adapter/outward/view/ui` | Classifies file icon kinds and compatibility glyphs. |
| `domain/state` | Stores pure `SurfaceVisibilityAnimation` state for Dock, FileTree View, and Workspace rail. |
| `layout_compute` | Uses animated widths when computing Workspace rail, Stage, Terminal Context Surface, and FileTree View rects. |
| `adapter/inward/event_loop_adapter` | Keeps redraw ticking while surface visibility animation is active. |

## Use Cases

### UC-1: RenderQuietStageHeader

- **Actor**: System
- **Trigger**: Chrome rendering for a single Stage `Pane`
- **Precondition**: The `Pane` is visible in Stage and is not part of a stacked Stage tab bar
- **Flow**:
  1. Tide resolves `HeaderSurfaceKind::Stage`.
  2. Tide preserves title, close hit zone, and direct Stage `Terminal` attention dot.
  3. Tide skips the full-width active tab background and top active indicator.
  4. Tide renders a low-weight `HeaderActionStrip` so mouse users can open Browser Pane or split the Stage `Pane`.
- **Postcondition**: Stage reads as the primary live surface rather than another context tab strip.
- **Business Rules**:
  - BR-1: Stage single `Pane` headers must not draw the active tab slab or top active indicator.
  - BR-2: Stage single `Pane` headers must expose OpenBrowser, SplitHorizontal, and SplitVertical `HeaderActionStrip` actions without drawing active tab chrome.
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
  - BR-21: Stacked mode tab bars in Stage and Terminal Context Surface use an OpenBrowser action plus one add-pane `+` action instead of split-direction icons.
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
- **Postcondition**: Persistent chrome reads as a quiet control layer instead of a noisy icon sample sheet.
- **Business Rules**:
  - BR-13: FileTree disclosure glyphs must be lightweight chevrons, not filled triangle glyphs.
  - BR-14: Project-special files must resolve to stable `FileIconKind`s while sharing restrained document glyphs.
  - BR-15: Titlebar surface toggle buttons must not render persistent hotkey hint text.
  - BR-16: Titlebar surface toggle hit targets must use the same larger width as the rendered icon-only controls.
  - BR-19: Titlebar surface toggle glyphs must render above the base terminal cell size.
  - BR-20: Titlebar surface toggles must expose distinct backdrop levels for rest, hover, active, and active-hover states.
  - BR-24: The FileTree View titlebar toggle must use the `TitlebarSurfaceIcon::FileTree` vector icon with no font-dependent text glyph fallback.

## Invariants

- Stage remains the primary execution surface and does not inherit Terminal Context Surface tab weight.
- Terminal Context Surface remains attached support and keeps context tab affordances.
- FileTree View is not a `PaneKind`.
- Workspace rail is not a `PaneKind`.
- `SurfaceVisibilityAnimation` changes computed width only; it does not create or remove `PaneId`s.
- Animation completion must leave `dock_open`, `FileTreeModel.visible`, and `WorkspaceManager.show_sidebar` as the target visibility truth.

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
| UC-4 | BR-9 | `surface_visibility_animation_eases_width_to_target` |
| UC-4 | BR-10 | `toggle_dock_starts_surface_visibility_animation` |
| UC-4 | BR-11 | `toggle_file_tree_starts_surface_visibility_animation` |
| UC-4 | BR-12 | `active_surface_visibility_animation_keeps_redraw_scheduled` |
| UC-4 | BR-17 | `first_dock_toggle_with_empty_context_starts_surface_visibility_animation` |
| UC-4 | BR-18 | `toggle_workspace_rail_starts_surface_visibility_animation` |
| UC-4 | BR-22 | `adding_pane_to_closed_dock_starts_surface_visibility_animation` |
| UC-4 | BR-25 | `closing_dock_animation_does_not_overlap_file_tree_view` |
| UC-5 | BR-13 | `directory_file_tree_rows_use_lightweight_disclosure_chevrons` |
| UC-5 | BR-14 | `project_special_file_icons_share_restrained_document_glyphs` |
| UC-5 | BR-15/BR-16/BR-19 | `titlebar_surface_toggles_are_icon_only_larger_controls` |
| UC-5 | BR-20 | `titlebar_surface_toggles_have_distinct_backdrop_levels` |
| UC-5 | BR-23 | `titlebar_surface_toggles_use_dock_filetree_workspace_order_and_icons` |
| UC-5 | BR-24 | `titlebar_file_tree_toggle_uses_vector_icon_without_text_glyph` |

## Location

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
