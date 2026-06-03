// Spec: docs/specs/visual-hierarchy.md

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::adapter::outward::clock_adapter::FixedClock;
use crate::adapter::outward::view::{
    browser_nav_icon_for_target, browser_nav_icon_text_glyph, context_menu_icon,
    context_menu_icon_text_glyph, file_tree_row_slab_clip, region_header_anchor_pane_id,
    search_bar_close_icon_text_glyph, titlebar_action_button_icon, titlebar_action_icon_text_glyph,
    titlebar_button_backdrop_level, titlebar_identity_origin_x,
    titlebar_identity_origin_x_for_window, titlebar_surface_button_icon,
    titlebar_surface_icon_text_glyph, titlebar_toggle_button_draws_hotkey_hint,
    titlebar_toggle_button_height, titlebar_toggle_button_width, titlebar_workspace_meta_text,
    titlebar_workspace_title, BrowserNavIcon, ContextMenuIcon, TitlebarActionIcon,
    TitlebarSurfaceIcon,
};
use crate::event_loop::handle_platform_event;
use crate::header::{
    header_action_icon, header_action_icon_text_glyph, header_close_icon_text_glyph,
    header_leading_view_mode_width, single_pane_header_action_specs_for_surface,
    single_pane_header_chrome, single_pane_header_layout, single_pane_header_paint_steps,
    stacked_tab_bar_header_action_specs_for_surface, HeaderActionIcon, HeaderHitAction,
    HeaderHitZone, HeaderSurfaceKind, SinglePaneHeaderPaintStep,
};
use crate::outward::{ClockPort, TerminalFactoryPort};
use crate::pane::{PaneKind, TerminalPane};
use crate::state::{
    drag_types::HoverTarget, SplitTransitionAnimation, SplitTransitionScope,
    SurfaceVisibilityAnimation, ViewMode, SPLIT_TRANSITION_ANIMATION_DURATION,
    SURFACE_VISIBILITY_ANIMATION_DURATION,
};
use crate::theme::{
    FILE_TREE_MIN_WIDTH, FILE_TREE_WIDTH, PANE_PADDING, TERMINAL_CONTEXT_SURFACE_MIN_WIDTH,
    TITLEBAR_BUTTON_GAP, TITLEBAR_HEIGHT, TITLEBAR_ICON_BUTTON_PAD_H, TITLEBAR_ICON_BUTTON_PAD_V,
    TITLEBAR_ICON_SCALE,
};
use crate::tide_core::{LayoutEngine, MouseButton, Rect, SplitDirection, Vec2};
use crate::tide_input::GlobalAction;
use crate::tide_platform::{PlatformEvent, WindowProxy};
use crate::ui::{file_icon, file_icon_kind, file_tree_disclosure, FileIconKind};
use crate::ActionPort;
use crate::App;
use crate::AppCorePort;
use crate::ContextMenuAction;
use crate::DockPort;
use crate::LayoutPort;
use crate::PaneLifecyclePort;
use crate::WorkspaceNavPort;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn test_window_proxy() -> WindowProxy {
    let (tx, _rx) = std::sync::mpsc::channel();
    WindowProxy::new(tx, std::sync::Arc::new(|| {}))
}

enum TitlebarSurfaceButton {
    FileTree,
    Dock,
    Workspace,
}

fn titlebar_surface_button_center(app: &App, button: TitlebarSurfaceButton) -> Vec2 {
    let logical = app.window.logical_size();
    let cs = app.window.cached_cell_size;
    let btn_w = cs.width * TITLEBAR_ICON_SCALE + TITLEBAR_ICON_BUTTON_PAD_H * 2.0;
    let gear_x = logical.width - PANE_PADDING - btn_w;
    let integ_x = gear_x - btn_w - TITLEBAR_BUTTON_GAP;
    let mut cur_right = integ_x - TITLEBAR_BUTTON_GAP;
    let index = match button {
        TitlebarSurfaceButton::FileTree => 0,
        TitlebarSurfaceButton::Dock => 1,
        TitlebarSurfaceButton::Workspace => 2,
    };
    for _ in 0..index {
        cur_right -= btn_w + TITLEBAR_BUTTON_GAP;
    }
    let btn_x = cur_right - btn_w;
    Vec2::new(btn_x + btn_w / 2.0, app.window.top_inset / 2.0)
}

fn titlebar_settings_button_center(app: &App) -> Vec2 {
    let logical = app.window.logical_size();
    let cs = app.window.cached_cell_size;
    let btn_w = cs.width * TITLEBAR_ICON_SCALE + TITLEBAR_ICON_BUTTON_PAD_H * 2.0;
    let btn_x = logical.width - PANE_PADDING - btn_w;
    Vec2::new(btn_x + btn_w / 2.0, app.window.top_inset / 2.0)
}

fn app_with_context_pane() -> (App, u64) {
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);

    let context_id = app.layout.alloc_id();
    app.panes.insert(
        context_id,
        PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(context_id)),
    );
    app.add_pane_to_dock(context_id, Some(terminal_id));
    (app, terminal_id)
}

fn app_with_stage_terminal_only() -> (App, u64) {
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    (app, terminal_id)
}

fn app_with_two_stage_terminals() -> (App, u64, u64) {
    let mut app = test_app();
    let (layout, first_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let second_id = app
        .layout
        .split(first_id, crate::tide_core::SplitDirection::Vertical);
    app.panes.insert(
        first_id,
        PaneKind::Terminal(TerminalPane::with_cwd(first_id, 80, 24, None, true).unwrap()),
    );
    app.panes.insert(
        second_id,
        PaneKind::Terminal(TerminalPane::with_cwd(second_id, 80, 24, None, true).unwrap()),
    );
    app.focus.focused = Some(first_id);
    app.focus.stage_focused = Some(first_id);
    app.layout.set_split_ratio(first_id, 0.35);
    (app, first_id, second_id)
}

struct SharedTestClock {
    instant: Arc<Mutex<Instant>>,
}

impl ClockPort for SharedTestClock {
    fn now(&self) -> Instant {
        *self
            .instant
            .lock()
            .expect("test clock lock should be available")
    }
}

struct DelayedTerminalFactory {
    instant: Arc<Mutex<Instant>>,
    delay: Duration,
}

impl TerminalFactoryPort for DelayedTerminalFactory {
    fn create_terminal(
        &self,
        id: crate::tide_core::PaneId,
        cols: u16,
        rows: u16,
        cwd: Option<&std::path::Path>,
        dark_mode: bool,
        _tide_window_id: crate::tide_core::TideWindowId,
        _workspace_name: Option<&str>,
    ) -> Result<TerminalPane, Box<dyn std::error::Error>> {
        {
            let mut instant = self
                .instant
                .lock()
                .expect("test clock lock should be available");
            *instant = *instant + self.delay;
        }
        TerminalPane::with_cwd(
            id,
            cols,
            rows,
            cwd.map(|path| path.to_path_buf()),
            dark_mode,
        )
    }

    fn pre_spawn_terminal(
        &self,
        _cols: u16,
        _rows: u16,
        _dark_mode: bool,
        _pane_id: Option<crate::tide_core::PaneId>,
        _tide_window_id: crate::tide_core::TideWindowId,
        _workspace_name: Option<&str>,
    ) -> Result<crate::tide_terminal::Terminal, Box<dyn std::error::Error>> {
        Err("delayed terminal factory does not pre-spawn terminals".into())
    }
}

fn root_split_ratio(app: &App) -> f32 {
    match app
        .layout_snapshot()
        .expect("Stage SplitLayout should exist")
    {
        crate::tide_layout::LayoutSnapshot::Split { ratio, .. } => ratio,
        other => panic!("expected Stage root split, got {other:?}"),
    }
}

// --- UC-1: RenderQuietStageHeader ---

#[test]
fn stage_single_pane_header_uses_quiet_session_chrome_with_actions() {
    // UC-1 BR-1/BR-2: Stage single Pane headers do not draw active tab chrome, but still expose mouse-first HeaderActionStrip actions.
    let chrome = single_pane_header_chrome(HeaderSurfaceKind::Stage, true);
    let actions = single_pane_header_action_specs_for_surface(HeaderSurfaceKind::Stage);
    let action_kinds: Vec<HeaderHitAction> =
        actions.iter().map(|spec| spec.action.clone()).collect();

    assert!(!chrome.draw_active_background);
    assert!(!chrome.draw_active_indicator);
    assert!(chrome.show_header_action_strip);
    assert!(!action_kinds.contains(&HeaderHitAction::AddPane));
    assert!(action_kinds.contains(&HeaderHitAction::SplitHorizontal));
    assert!(action_kinds.contains(&HeaderHitAction::SplitVertical));
    assert!(!action_kinds.contains(&HeaderHitAction::OpenBrowser));
}

#[test]
fn stage_single_pane_header_still_reserves_title_and_close() {
    // UC-1 BR-3: Stage single Pane headers still reserve title and close hit zones.
    let layout = single_pane_header_layout(240.0, 0.0, 96.0, &[], false, 0.0);

    assert!(layout.title_layout.title_w > 0.0);
    assert!(layout.close_hit_x > layout.title_layout.title_w);
}

// --- UC-2: RenderContextHeader ---

#[test]
fn terminal_context_surface_header_keeps_context_tab_chrome() {
    // UC-2 BR-4/BR-5: Terminal Context Surface headers keep active tab chrome and context HeaderActionStrip controls.
    let chrome = single_pane_header_chrome(HeaderSurfaceKind::TerminalContextSurface, true);
    let actions =
        single_pane_header_action_specs_for_surface(HeaderSurfaceKind::TerminalContextSurface);
    let action_kinds: Vec<HeaderHitAction> =
        actions.iter().map(|spec| spec.action.clone()).collect();

    assert!(chrome.draw_active_background);
    assert!(chrome.draw_active_indicator);
    assert!(chrome.show_header_action_strip);
    assert!(action_kinds.contains(&HeaderHitAction::SplitHorizontal));
    assert!(action_kinds.contains(&HeaderHitAction::SplitVertical));
    assert!(!action_kinds.contains(&HeaderHitAction::AddPane));
    assert!(!action_kinds.contains(&HeaderHitAction::OpenBrowser));
}

#[test]
fn stacked_tab_bar_header_uses_plus_instead_of_split_actions() {
    // UC-2 BR-21: Stage and Terminal Context Surface stacked tab bars use add-pane plus affordance instead of split-direction icons.
    for surface in [
        HeaderSurfaceKind::Stage,
        HeaderSurfaceKind::TerminalContextSurface,
    ] {
        let actions = stacked_tab_bar_header_action_specs_for_surface(surface);
        let action_kinds: Vec<HeaderHitAction> =
            actions.iter().map(|spec| spec.action.clone()).collect();

        assert_eq!(action_kinds, vec![HeaderHitAction::AddPane]);
        assert_eq!(
            header_action_icon(&HeaderHitAction::AddPane),
            Some(HeaderActionIcon::AddPane)
        );
        assert!(!action_kinds.contains(&HeaderHitAction::SplitHorizontal));
        assert!(!action_kinds.contains(&HeaderHitAction::SplitVertical));
    }
}

// --- UC-3: RenderLayeredFileTreeIcons ---

#[test]
fn directory_file_tree_rows_have_separate_disclosure_and_icon() {
    // UC-3 BR-6: Directory rows expose a disclosure chevron separate from the folder glyph.
    assert_eq!(file_tree_disclosure(true, true), Some('\u{2304}'));
    assert_eq!(file_tree_disclosure(true, false), Some('\u{203A}'));
    assert_eq!(file_tree_disclosure(false, false), None);
    assert_eq!(file_icon_kind("docs", true, true), FileIconKind::FolderOpen);
}

#[test]
fn project_special_files_map_to_stable_icon_kinds() {
    // UC-3 BR-7: Project-special files map to stable FileIconKinds before rendering.
    assert_eq!(
        file_icon_kind("README.md", false, false),
        FileIconKind::Readme
    );
    assert_eq!(
        file_icon_kind("AGENTS.md", false, false),
        FileIconKind::AgentInstruction
    );
    assert_eq!(
        file_icon_kind(".gitignore", false, false),
        FileIconKind::Git
    );
    assert_eq!(
        file_icon_kind("Cargo.toml", false, false),
        FileIconKind::RustConfig
    );
}

#[test]
fn file_icon_uses_file_icon_kind_as_compatibility_wrapper() {
    // UC-3 BR-8: file_icon() remains a compatibility wrapper over FileIconKind.
    assert_eq!(
        file_icon("README.md", false, false),
        FileIconKind::Readme.glyph()
    );
    assert_eq!(
        file_icon("src", true, false),
        FileIconKind::FolderClosed.glyph()
    );
}

#[test]
fn file_tree_view_default_width_is_compact() {
    // UC-3 BR-52: FileTree View defaults to a compact 200px width with a 160px minimum resize width.
    assert_eq!(FILE_TREE_WIDTH.to_bits(), 200.0_f32.to_bits());
    assert_eq!(FILE_TREE_MIN_WIDTH.to_bits(), 160.0_f32.to_bits());
}

#[test]
fn file_tree_row_highlight_clips_to_entries_below_header() {
    // UC-3 BR-53: FileTree View row highlights and expanded directory slabs are clipped to the entries area below the header before rendering.
    let entries_clip = Rect::new(100.0, 148.0, 200.0, 300.0);
    let row_rect = Rect::new(104.0, 132.0, 192.0, 32.0);

    let clipped =
        file_tree_row_slab_clip(row_rect, entries_clip).expect("row should overlap entries area");

    assert_eq!(clipped.x.to_bits(), row_rect.x.to_bits());
    assert_eq!(clipped.width.to_bits(), row_rect.width.to_bits());
    assert_eq!(clipped.y.to_bits(), entries_clip.y.to_bits());
    assert_eq!(clipped.height.to_bits(), 16.0_f32.to_bits());
}

// --- UC-4: AnimateSideSurfaceVisibility ---

#[test]
fn surface_visibility_animation_eases_width_to_target() {
    // UC-4 BR-9: SurfaceVisibilityAnimation uses a bounded ease-out transition from current width to target width.
    let started_at = Instant::now();
    let animation = SurfaceVisibilityAnimation::new(0.0, 400.0, started_at);
    assert!(SURFACE_VISIBILITY_ANIMATION_DURATION >= Duration::from_millis(220));
    let midpoint = started_at + SURFACE_VISIBILITY_ANIMATION_DURATION / 2;
    let finished = started_at + SURFACE_VISIBILITY_ANIMATION_DURATION;

    assert_eq!(animation.width_at(started_at).to_bits(), 0.0f32.to_bits());
    assert!(animation.width_at(midpoint) > 200.0);
    assert!(animation.width_at(midpoint) < 400.0);
    assert_eq!(animation.width_at(finished).to_bits(), 400.0f32.to_bits());
    assert!(animation.is_complete_at(finished));
}

#[test]
fn toggle_dock_starts_surface_visibility_animation() {
    // UC-4 BR-10: Toggling Dock starts a width animation.
    let (mut app, _terminal_id) = app_with_context_pane();
    app.dock.dock_open = false;
    app.dock.visibility_animation = None;

    app.handle_global_action(GlobalAction::ToggleDock);

    assert!(app.dock.dock_open);
    assert!(app.dock.visibility_animation.is_some());
}

#[test]
fn toggle_file_tree_starts_surface_visibility_animation() {
    // UC-4 BR-11: Toggling FileTree View starts a width animation.
    let (mut app, _terminal_id) = app_with_context_pane();

    app.handle_global_action(GlobalAction::ToggleFileTree);

    assert!(app.ft.visible);
    assert!(app.ft.visibility_animation.is_some());
}

#[test]
fn active_surface_visibility_animation_keeps_redraw_scheduled() {
    // UC-4 BR-12: Active surface visibility animations keep the event loop scheduling redraws.
    let (mut app, _terminal_id) = app_with_context_pane();
    app.handle_global_action(GlobalAction::ToggleFileTree);

    assert!(app.surface_visibility_animation_active());
    assert!(app.surface_visibility_animation_frame_due());
}

#[test]
fn first_dock_toggle_with_empty_context_starts_surface_visibility_animation() {
    // UC-4 BR-17: The first Dock open animates even when it creates the initial Launcher context Pane.
    let (mut app, _terminal_id) = app_with_stage_terminal_only();
    app.dock.dock_open = false;
    app.dock.visibility_animation = None;

    app.handle_global_action(GlobalAction::ToggleDock);

    assert!(app.dock.dock_open);
    assert!(app.dock.visibility_animation.is_some());
}

#[test]
fn toggle_workspace_rail_starts_surface_visibility_animation() {
    // UC-4 BR-18: Toggling Workspace rail starts a width animation.
    let mut app = test_app();
    app.ws.show_sidebar = false;
    app.ws.visibility_animation = None;

    app.handle_global_action(GlobalAction::ToggleWorkspaceSidebar);

    assert!(app.ws.show_sidebar);
    assert!(app.ws.visibility_animation.is_some());
    assert!(app.surface_visibility_animation_active());
    assert!(app.surface_visibility_animation_frame_due());
}

#[test]
fn adding_pane_to_closed_dock_starts_surface_visibility_animation() {
    // UC-4 BR-22: Adding a Pane to a closed Terminal Context Surface uses the animated visibility path.
    let (mut app, terminal_id) = app_with_stage_terminal_only();
    app.dock.dock_open = false;
    app.dock.visibility_animation = None;

    let context_id = app.layout.alloc_id();
    app.panes.insert(
        context_id,
        PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(context_id)),
    );

    app.add_pane_to_dock(context_id, Some(terminal_id));

    assert!(app.dock.dock_open);
    assert!(app.dock.visibility_animation.is_some());
    assert!(app.surface_visibility_animation_active());
}

#[test]
fn closing_dock_animation_does_not_overlap_file_tree_view() {
    // UC-4 BR-25: Closing Terminal Context Surface animation must not keep a minimum-width Pane visual rect alive past the Terminal Context Surface bounds into FileTree View.
    let (mut app, _terminal_id) = app_with_context_pane();
    app.ft.visible = true;
    app.ft.width = 220.0;
    app.ft.visibility_animation = None;
    app.dock.dock_open = false;
    app.dock.dock_width = 320.0;

    let started_at = Instant::now();
    app.dock.begin_visibility_animation(320.0, 0.0, started_at);
    app.ports.clock = Box::new(FixedClock {
        instant: started_at + SURFACE_VISIBILITY_ANIMATION_DURATION - Duration::from_millis(1),
    });

    app.compute_layout();

    let file_tree = app.ft.rect.expect("FileTree View rect should be computed");
    let dock_visual_rects: Vec<_> = app
        .visual_pane_rects
        .iter()
        .copied()
        .filter(|(pane_id, _)| app.is_pane_in_dock(*pane_id))
        .collect();

    for (_, rect) in dock_visual_rects {
        assert!(
            rect.x + rect.width <= file_tree.x,
            "Terminal Context Surface visual rect should stay left of FileTree View while closing"
        );
    }
}

#[test]
fn stage_split_ratio_stays_stable_during_side_surface_visibility_animation() {
    // UC-4 BR-26: Active side-surface visibility animation must not mutate Stage SplitLayout ratios from their pre-animation values.
    let (mut app, first_id, second_id) = app_with_two_stage_terminals();
    app.compute_layout();
    let initial_ratio = root_split_ratio(&app);
    let initial_first_rect = app
        .pane_rects
        .iter()
        .find(|(pane_id, _)| *pane_id == first_id)
        .expect("first Stage Pane rect should exist")
        .1;
    let initial_second_rect = app
        .pane_rects
        .iter()
        .find(|(pane_id, _)| *pane_id == second_id)
        .expect("second Stage Pane rect should exist")
        .1;

    app.handle_global_action(GlobalAction::ToggleFileTree);
    let started_at = app.ports.clock.now();
    app.ports.clock = Box::new(FixedClock {
        instant: started_at + SURFACE_VISIBILITY_ANIMATION_DURATION / 2,
    });
    app.compute_layout();

    let mid_ratio = root_split_ratio(&app);
    let mid_first_rect = app
        .pane_rects
        .iter()
        .find(|(pane_id, _)| *pane_id == first_id)
        .expect("first Stage Pane rect should exist during animation")
        .1;
    let mid_second_rect = app
        .pane_rects
        .iter()
        .find(|(pane_id, _)| *pane_id == second_id)
        .expect("second Stage Pane rect should exist during animation")
        .1;

    assert!(
        (mid_ratio - initial_ratio).abs() < f32::EPSILON,
        "side-surface animation should preserve the Stage root split ratio"
    );
    assert!(
        mid_first_rect.width < initial_first_rect.width,
        "first Stage Pane should visually shrink during FileTree View animation"
    );
    assert!(
        mid_second_rect.width < initial_second_rect.width,
        "second Stage Pane should visually shrink during FileTree View animation"
    );
}

#[test]
fn stage_split_ratio_stays_stable_during_tide_window_resize() {
    // UC-4 BR-54: Tide Window resize preserves Stage SplitLayout ratios from their pre-resize values.
    let (mut app, first_id, _second_id) = app_with_two_stage_terminals();
    app.compute_layout();
    let initial_ratio = root_split_ratio(&app);
    let initial_first_width = app
        .pane_rects
        .iter()
        .find(|(pane_id, _)| *pane_id == first_id)
        .expect("first Stage Pane rect should exist")
        .1
        .width;

    app.set_window_size(1200, 640);
    app.compute_layout();

    let resized_ratio = root_split_ratio(&app);
    let resized_first_width = app
        .pane_rects
        .iter()
        .find(|(pane_id, _)| *pane_id == first_id)
        .expect("first Stage Pane rect should exist after resize")
        .1
        .width;

    assert!(
        (resized_ratio - initial_ratio).abs() < f32::EPSILON,
        "Tide Window resize should preserve the Stage root split ratio"
    );
    assert!(
        resized_first_width > initial_first_width,
        "Stage Pane rects should still be recomputed for the wider Tide Window"
    );
}

#[test]
fn dock_opening_animation_finishes_without_width_jump_when_file_tree_is_visible() {
    // UC-4 BR-51: Terminal Context Surface animation targets the settled right-side support width when FileTree View is visible.
    let (mut app, _terminal_id) = app_with_context_pane();
    app.ft.visible = true;
    app.ft.width = FILE_TREE_WIDTH;
    app.ft.visibility_animation = None;
    app.dock.dock_open = false;
    app.dock.visibility_animation = None;
    app.dock.dock_width = TERMINAL_CONTEXT_SURFACE_MIN_WIDTH;

    let started_at = app.ports.clock.now();
    app.set_dock_visible_with_animation(true);

    app.ports.clock = Box::new(FixedClock {
        instant: started_at + SURFACE_VISIBILITY_ANIMATION_DURATION - Duration::from_millis(1),
    });
    app.compute_layout();
    let almost_settled_width = app
        .dock_area_rect
        .expect("Terminal Context Surface rect should exist during opening animation")
        .width;

    app.ports.clock = Box::new(FixedClock {
        instant: started_at + SURFACE_VISIBILITY_ANIMATION_DURATION,
    });
    app.compute_layout();
    let settled_width = app
        .dock_area_rect
        .expect("Terminal Context Surface rect should exist after opening animation")
        .width;

    assert!(
        settled_width >= TERMINAL_CONTEXT_SURFACE_MIN_WIDTH,
        "Terminal Context Surface should settle at or above its minimum width"
    );
    assert!(
        (settled_width - almost_settled_width).abs() < 4.0,
        "Terminal Context Surface should not jump wider when visibility animation completes"
    );
}

#[test]
fn stage_split_with_launcher_starts_split_transition_animation() {
    // UC-4 BR-44: Creating a Stage split starts a SplitTransitionAnimation from a narrow new Pane ratio.
    let (mut app, first_id) = app_with_stage_terminal_only();
    app.compute_layout();

    app.split_with_launcher(SplitDirection::Vertical);

    let new_id = app
        .focus
        .focused
        .expect("new Stage split should be focused");
    let animation = app
        .split_transition_animation
        .expect("Stage split should start a split transition");
    assert_eq!(animation.scope, SplitTransitionScope::Stage);
    assert_eq!(animation.pane_id, new_id);
    assert!(app.layout_animation_active());

    let first_rect = app
        .pane_rects
        .iter()
        .find(|(pane_id, _)| *pane_id == first_id)
        .expect("first Stage Pane rect should exist")
        .1;
    let new_rect = app
        .pane_rects
        .iter()
        .find(|(pane_id, _)| *pane_id == new_id)
        .expect("new Stage Pane rect should exist")
        .1;
    assert!(
        new_rect.width < first_rect.width,
        "new Stage Pane should start narrower than the source Pane"
    );
}

#[test]
fn stage_split_transition_starts_after_terminal_creation_latency() {
    // UC-4 BR-44a: Terminal startup latency must not consume the Stage SplitTransitionAnimation before the first rendered frame.
    let started_at = Instant::now();
    let shared_clock = Arc::new(Mutex::new(started_at));
    let (mut app, first_id) = app_with_stage_terminal_only();
    app.ports.clock = Box::new(SharedTestClock {
        instant: Arc::clone(&shared_clock),
    });
    app.ports.terminal_factory = Box::new(DelayedTerminalFactory {
        instant: Arc::clone(&shared_clock),
        delay: SPLIT_TRANSITION_ANIMATION_DURATION + Duration::from_millis(20),
    });
    app.compute_layout();

    app.split_with_launcher(SplitDirection::Vertical);

    let new_id = app
        .focus
        .focused
        .expect("new Stage split should be focused");
    let animation = app
        .split_transition_animation
        .expect("Stage split should still be animating after Terminal creation");
    assert_eq!(animation.scope, SplitTransitionScope::Stage);
    assert_eq!(animation.pane_id, new_id);

    let first_rect = app
        .pane_rects
        .iter()
        .find(|(pane_id, _)| *pane_id == first_id)
        .expect("first Stage Pane rect should exist")
        .1;
    let new_rect = app
        .pane_rects
        .iter()
        .find(|(pane_id, _)| *pane_id == new_id)
        .expect("new Stage Pane rect should exist")
        .1;
    assert!(
        new_rect.width < first_rect.width,
        "new Stage Pane should still start narrow after Terminal creation latency"
    );
}

#[test]
fn dock_split_header_action_starts_split_transition_animation() {
    // UC-4 BR-45: Creating a Terminal Context Surface split starts a SplitTransitionAnimation from a narrow new Pane ratio.
    let (mut app, terminal_id) = app_with_context_pane();

    app.dock_split_new_tab_group(SplitDirection::Horizontal);

    let new_id = app
        .focus
        .focused
        .expect("new context split should be focused");
    let animation = app
        .split_transition_animation
        .expect("Terminal Context Surface split should start a split transition");
    assert_eq!(
        animation.scope,
        SplitTransitionScope::TerminalContextSurface { terminal_id }
    );
    assert_eq!(animation.pane_id, new_id);
    assert!(app.layout_animation_active());
}

#[test]
fn split_transition_animation_eases_ratio_to_target() {
    // UC-4 BR-46: SplitTransitionAnimation eases from a narrow new Pane ratio to the settled ratio.
    let started_at = Instant::now();
    let animation =
        SplitTransitionAnimation::new_trailing_pane(SplitTransitionScope::Stage, 42, started_at);
    let midpoint = started_at + SPLIT_TRANSITION_ANIMATION_DURATION / 2;
    let finished = started_at + SPLIT_TRANSITION_ANIMATION_DURATION;

    assert_eq!(animation.ratio_at(started_at).to_bits(), 0.9f32.to_bits());
    assert!(animation.ratio_at(midpoint) < 0.9);
    assert!(animation.ratio_at(midpoint) > 0.5);
    assert_eq!(animation.ratio_at(finished).to_bits(), 0.5f32.to_bits());
    assert!(animation.is_complete_at(finished));
}

#[test]
fn closing_stage_split_starts_split_transition_animation_before_removal() {
    // UC-4 BR-49: Closing a visible Stage split starts a closing SplitTransitionAnimation before removing the Pane.
    let (mut app, _first_id, second_id) = app_with_two_stage_terminals();
    app.compute_layout();

    app.close_specific_pane_with_split_animation(second_id);

    assert!(app.panes.contains_key(&second_id));
    let animation = app
        .split_transition_animation
        .expect("Stage close should start a split transition");
    assert!(animation.is_closing());
    assert_eq!(animation.scope, SplitTransitionScope::Stage);
    assert_eq!(animation.pane_id, second_id);
    assert!(app.layout_animation_active());

    let started_at = app.ports.clock.now();
    app.ports.clock = Box::new(FixedClock {
        instant: started_at + SPLIT_TRANSITION_ANIMATION_DURATION,
    });
    app.compute_layout();

    assert!(!app.panes.contains_key(&second_id));
    assert!(!app.layout.all_pane_ids().contains(&second_id));
    assert!(app.split_transition_animation.is_none());
}

#[test]
fn global_close_pane_starts_split_transition_animation_before_removal() {
    // UC-4 BR-49a: GlobalAction::ClosePane uses the split close transition path for visible Stage splits.
    let (mut app, _first_id, second_id) = app_with_two_stage_terminals();
    app.focus.focused = Some(second_id);
    app.router.set_focused(second_id);
    app.compute_layout();

    app.handle_global_action(GlobalAction::ClosePane);

    assert!(app.panes.contains_key(&second_id));
    let animation = app
        .split_transition_animation
        .expect("GlobalAction::ClosePane should start a split transition");
    assert!(animation.is_closing());
    assert_eq!(animation.scope, SplitTransitionScope::Stage);
    assert_eq!(animation.pane_id, second_id);
}

#[test]
fn closing_dock_split_starts_split_transition_animation_before_removal() {
    // UC-4 BR-49: Closing a visible Terminal Context Surface split starts a closing SplitTransitionAnimation before removing the Pane.
    let (mut app, terminal_id) = app_with_context_pane();
    app.dock_split_new_tab_group(SplitDirection::Vertical);
    let closing_id = app
        .focus
        .focused
        .expect("new Terminal Context Surface split should be focused");
    let opened_at = app.ports.clock.now();
    app.ports.clock = Box::new(FixedClock {
        instant: opened_at + SPLIT_TRANSITION_ANIMATION_DURATION,
    });
    app.compute_layout();

    app.close_specific_pane_with_split_animation(closing_id);

    assert!(app.panes.contains_key(&closing_id));
    let animation = app
        .split_transition_animation
        .expect("Terminal Context Surface close should start a split transition");
    assert!(animation.is_closing());
    assert_eq!(
        animation.scope,
        SplitTransitionScope::TerminalContextSurface { terminal_id }
    );
    assert_eq!(animation.pane_id, closing_id);

    let closing_started_at = app.ports.clock.now();
    app.ports.clock = Box::new(FixedClock {
        instant: closing_started_at + SPLIT_TRANSITION_ANIMATION_DURATION,
    });
    app.compute_layout();

    assert!(!app.panes.contains_key(&closing_id));
    let owner = app
        .panes
        .get(&terminal_id)
        .and_then(|pane| match pane {
            PaneKind::Terminal(terminal) => Some(terminal),
            _ => None,
        })
        .expect("owner terminal should exist");
    assert!(!owner.dock_layout.all_pane_ids().contains(&closing_id));
    assert!(app.split_transition_animation.is_none());
}

#[test]
fn titlebar_workspace_toggle_starts_surface_visibility_animation() {
    // UC-4 BR-18: Titlebar Workspace rail toggle uses the same animated visibility path.
    let mut app = test_app();
    app.ws.show_sidebar = false;
    app.ws.visibility_animation = None;

    app.set_ws_show_sidebar(true);

    assert!(app.ws.show_sidebar);
    assert!(app.ws.visibility_animation.is_some());
}

// --- UC-5: NormalizeChromeIcons ---

#[test]
fn directory_file_tree_rows_use_lightweight_disclosure_chevrons() {
    // UC-5 BR-13: FileTree disclosure glyphs are lightweight chevrons, not filled triangle glyphs.
    let expanded = file_tree_disclosure(true, true).expect("expanded directory disclosure");
    let collapsed = file_tree_disclosure(true, false).expect("collapsed directory disclosure");

    assert_eq!(expanded, '\u{2304}');
    assert_eq!(collapsed, '\u{203A}');
    assert_ne!(expanded, '\u{f0d7}');
    assert_ne!(collapsed, '\u{f0da}');
}

#[test]
fn project_special_file_icons_share_restrained_document_glyphs() {
    // UC-5 BR-14: Project-special files keep stable FileIconKinds while sharing restrained document glyphs.
    let document_glyph = FileIconKind::Generic.glyph();

    assert_eq!(
        file_icon_kind("AGENTS.md", false, false),
        FileIconKind::AgentInstruction
    );
    assert_eq!(
        file_icon_kind("README.md", false, false),
        FileIconKind::Readme
    );
    assert_eq!(
        file_icon_kind("LICENSE", false, false),
        FileIconKind::License
    );
    assert_eq!(
        file_icon_kind(".gitignore", false, false),
        FileIconKind::Git
    );
    assert_eq!(
        file_icon_kind("Cargo.toml", false, false),
        FileIconKind::RustConfig
    );
    assert_eq!(FileIconKind::AgentInstruction.glyph(), document_glyph);
    assert_eq!(FileIconKind::Readme.glyph(), document_glyph);
    assert_eq!(FileIconKind::License.glyph(), document_glyph);
    assert_eq!(FileIconKind::Git.glyph(), document_glyph);
    assert_eq!(FileIconKind::RustConfig.glyph(), document_glyph);
}

#[test]
fn titlebar_surface_toggles_are_icon_only_larger_controls() {
    // UC-5 BR-15/BR-16/BR-19: Titlebar surface toggles use larger icon-only controls without hotkey hints.
    let cell_w = 8.0;
    let cell_h = 16.0;
    let old_hint_button_w = cell_w * 4.0 + 12.0;

    assert!(!titlebar_toggle_button_draws_hotkey_hint());
    assert!(TITLEBAR_ICON_SCALE > 1.0);
    assert_eq!(
        titlebar_toggle_button_width(cell_w).to_bits(),
        (cell_w * TITLEBAR_ICON_SCALE + TITLEBAR_ICON_BUTTON_PAD_H * 2.0).to_bits()
    );
    assert_eq!(
        titlebar_toggle_button_height(cell_h).to_bits(),
        (cell_h * TITLEBAR_ICON_SCALE + TITLEBAR_ICON_BUTTON_PAD_V * 2.0).to_bits()
    );
    assert!(titlebar_toggle_button_width(cell_w) < old_hint_button_w);
}

#[test]
fn titlebar_surface_toggles_have_distinct_backdrop_levels() {
    // UC-5 BR-20: Titlebar surface toggles distinguish rest, hover, active, and active-hover backdrop states.
    assert_eq!(titlebar_button_backdrop_level(false, false), 0);
    assert_eq!(titlebar_button_backdrop_level(false, true), 1);
    assert_eq!(titlebar_button_backdrop_level(true, false), 2);
    assert_eq!(titlebar_button_backdrop_level(true, true), 3);
}

#[test]
fn titlebar_surface_toggles_use_dock_filetree_workspace_order_and_icons() {
    // UC-5 BR-23: Titlebar surface toggles use vector icon roles instead of font-dependent private glyphs.
    assert_eq!(
        titlebar_surface_button_icon(&HoverTarget::TitlebarFileTree),
        Some(TitlebarSurfaceIcon::FileTree)
    );
    assert_eq!(
        titlebar_surface_button_icon(&HoverTarget::TitlebarDock),
        Some(TitlebarSurfaceIcon::DockContext)
    );
    assert_eq!(
        titlebar_surface_button_icon(&HoverTarget::TitlebarWorkspace),
        Some(TitlebarSurfaceIcon::WorkspaceRail)
    );
}

#[test]
fn titlebar_file_tree_toggle_uses_vector_icon_without_text_glyph() {
    // UC-5 BR-24: The FileTree View titlebar toggle uses a vector icon with no font-dependent text glyph fallback.
    assert_eq!(
        titlebar_surface_button_icon(&HoverTarget::TitlebarFileTree),
        Some(TitlebarSurfaceIcon::FileTree)
    );
    assert_eq!(
        titlebar_surface_icon_text_glyph(TitlebarSurfaceIcon::FileTree),
        None
    );
    assert_eq!(
        titlebar_surface_icon_text_glyph(TitlebarSurfaceIcon::DockContext),
        None
    );
    assert_eq!(
        titlebar_surface_icon_text_glyph(TitlebarSurfaceIcon::WorkspaceRail),
        None
    );
}

#[test]
fn titlebar_actions_use_vector_icons_without_text_glyphs() {
    // UC-5 BR-30: Integration and settings titlebar actions use vector roles, not font-dependent glyphs.
    assert_eq!(
        titlebar_action_button_icon(&HoverTarget::TitlebarIntegration, true),
        Some(TitlebarActionIcon::Integration)
    );
    assert_eq!(
        titlebar_action_button_icon(&HoverTarget::TitlebarSettings, true),
        Some(TitlebarActionIcon::Settings)
    );
    assert_eq!(
        titlebar_action_icon_text_glyph(TitlebarActionIcon::Integration),
        None
    );
    assert_eq!(
        titlebar_action_icon_text_glyph(TitlebarActionIcon::Settings),
        None
    );
}

#[test]
fn titlebar_does_not_expose_theme_icon_action() {
    // UC-5 BR-32: Theme switching is not exposed as a titlebar icon action.
    let app = test_app();
    let logical = app.window.logical_size();
    let cs = app.window.cached_cell_size;
    let btn_w = cs.width * TITLEBAR_ICON_SCALE + TITLEBAR_ICON_BUTTON_PAD_H * 2.0;
    let settings_x = logical.width - PANE_PADDING - btn_w;
    let former_theme_x = settings_x - btn_w - TITLEBAR_BUTTON_GAP;
    let former_theme_center = Vec2::new(former_theme_x + btn_w / 2.0, app.window.top_inset / 2.0);

    assert_eq!(
        crate::adapter::inward::click_adapter::hit_test::compute_hover_target(
            &app,
            former_theme_center
        ),
        Some(HoverTarget::TitlebarIntegration)
    );
}

#[test]
fn region_header_view_mode_toggles_use_vector_icons_without_text_glyphs() {
    // UC-5 BR-33: Stage and Terminal Context Surface ViewMode controls use header vector roles, not font-dependent glyphs.
    assert_eq!(
        header_action_icon(&HeaderHitAction::ToggleStageViewMode(false)),
        Some(HeaderActionIcon::EnterStackMode)
    );
    assert_eq!(
        header_action_icon(&HeaderHitAction::ToggleStageViewMode(true)),
        Some(HeaderActionIcon::EnterSplitMode)
    );
    assert_eq!(
        header_action_icon(&HeaderHitAction::ToggleDockViewMode(false)),
        Some(HeaderActionIcon::EnterStackMode)
    );
    assert_eq!(
        header_action_icon(&HeaderHitAction::ToggleDockViewMode(true)),
        Some(HeaderActionIcon::EnterSplitMode)
    );
}

#[test]
fn header_action_icons_use_requested_vector_roles_without_text_glyphs() {
    // UC-5 BR-40: Header AddPane, split, and ViewMode controls use requested vector roles without text glyph fallback.
    let icon_cases = [
        (HeaderHitAction::AddPane, HeaderActionIcon::AddPane),
        (
            HeaderHitAction::SplitHorizontal,
            HeaderActionIcon::SplitHorizontal,
        ),
        (
            HeaderHitAction::SplitVertical,
            HeaderActionIcon::SplitVertical,
        ),
        (
            HeaderHitAction::ToggleStageViewMode(false),
            HeaderActionIcon::EnterStackMode,
        ),
        (
            HeaderHitAction::ToggleStageViewMode(true),
            HeaderActionIcon::EnterSplitMode,
        ),
    ];

    for (action, expected_icon) in icon_cases {
        assert_eq!(header_action_icon(&action), Some(expected_icon));
        assert_eq!(header_action_icon_text_glyph(expected_icon), None);
    }
}

#[test]
fn external_open_actions_share_vector_icon_without_text_glyphs() {
    // UC-5 BR-41: Browser Pane and FileTree external handoff actions share the OpenExternal vector role.
    assert_eq!(
        browser_nav_icon_for_target(&HoverTarget::BrowserOpenExternal, false),
        Some(BrowserNavIcon::OpenExternal)
    );
    assert_eq!(
        browser_nav_icon_text_glyph(BrowserNavIcon::OpenExternal),
        None
    );
    assert_eq!(
        context_menu_icon(ContextMenuAction::OpenApp),
        ContextMenuIcon::OpenExternal
    );
    assert_eq!(
        context_menu_icon(ContextMenuAction::RevealInFinder),
        ContextMenuIcon::OpenExternal
    );
    assert_eq!(
        context_menu_icon_text_glyph(ContextMenuIcon::OpenExternal),
        None
    );
}

#[test]
fn close_affordances_use_vector_icons_without_text_glyphs() {
    // UC-5 BR-42: Header, TabGroup, and Search close affordances render vector cancel marks, not private font glyphs.
    assert_eq!(header_close_icon_text_glyph(), None);
    assert_eq!(search_bar_close_icon_text_glyph(), None);
    assert_eq!(header_action_icon(&HeaderHitAction::Close), None);
}

#[test]
fn chrome_icons_use_svg_icon_renderer_instead_of_square_steps() {
    // UC-5 BR-43: Chrome icon marks use renderer icon paths instead of square-step rect fragments.
    let renderer = include_str!("../../adapter/outward/renderer_adapter/mod.rs");
    let overlay = include_str!("../../adapter/outward/renderer_adapter/overlay.rs");
    let svg_icon = include_str!("../../adapter/outward/renderer_adapter/svg_icon.rs");
    let header = include_str!("../../adapter/outward/view/header.rs");
    let browser_nav = include_str!("../../adapter/outward/view/chrome/tab_bar.rs");
    let titlebar = include_str!("../../adapter/outward/view/chrome/titlebar.rs");
    let context_menu = include_str!("../../adapter/outward/view/overlays/context_menu.rs");
    let search_bar = include_str!("../../adapter/outward/view/overlays/search_bar.rs");

    assert!(renderer.contains("chrome_vector_vertices"));
    assert!(overlay.contains("chrome_vector_count"));
    assert!(svg_icon.contains("draw_chrome_svg_icon"));
    assert!(svg_icon.contains("draw_top_svg_icon"));
    assert!(svg_icon.contains("lyon::tessellation"));
    assert!(svg_icon.contains("PathParser"));
    assert!(svg_icon.contains("roxmltree::Document"));

    for source in [header, browser_nav, titlebar, context_menu, search_bar] {
        assert!(
            source.contains("draw_chrome_svg_icon")
                || source.contains("draw_top_svg_icon")
                || source.contains("draw_chrome_raster_icon")
                || source.contains("draw_top_raster_icon")
        );
        assert!(!source.contains("for offset in [-3.0_f32"));
        assert!(!source.contains("for offset in [0.0_f32, 1.6, 3.2, 4.8]"));
        assert!(!source.contains("draw_browser_nav_diagonal"));
        assert!(!source.contains("draw_context_menu_icon_diagonal"));
        assert!(!source.contains("draw_icon_stroke"));
    }
}

#[test]
fn requested_flaticon_icons_resolve_to_exact_raster_assets() {
    // UC-5 BR-47: Requested Flaticon roles map to exact RasterIconAsset source ids and URLs.
    use crate::rendering::{
        browser_nav_raster_icon_asset, context_menu_raster_icon_asset,
        header_action_raster_icon_asset, header_close_raster_icon_asset,
        launcher_icon_raster_icon_asset, search_close_raster_icon_asset,
        titlebar_action_raster_icon_asset, titlebar_surface_raster_icon_asset,
    };

    let cases = [
        (
            header_action_raster_icon_asset(HeaderActionIcon::SplitVertical)
                .expect("SplitVertical must use requested Flaticon asset"),
            "14096749",
            "https://www.flaticon.com/free-icon/screen_14096749",
        ),
        (
            header_action_raster_icon_asset(HeaderActionIcon::SplitHorizontal)
                .expect("SplitHorizontal must use requested Flaticon asset"),
            "14096753",
            "https://www.flaticon.com/free-icon/stack_14096753",
        ),
        (
            header_action_raster_icon_asset(HeaderActionIcon::Browser)
                .expect("Browser must use requested Flaticon asset"),
            "2530583",
            "https://www.flaticon.com/free-icon/web_2530583",
        ),
        (
            browser_nav_raster_icon_asset(BrowserNavIcon::OpenExternal)
                .expect("OpenExternal must use requested Flaticon asset"),
            "8944297",
            "https://www.flaticon.com/free-icon/expand-arrows_8944297",
        ),
        (
            context_menu_raster_icon_asset(ContextMenuIcon::OpenExternal)
                .expect("OpenExternal must use requested Flaticon asset"),
            "8944297",
            "https://www.flaticon.com/free-icon/expand-arrows_8944297",
        ),
        (
            search_close_raster_icon_asset(),
            "659891",
            "https://www.flaticon.com/free-icon/cancel_659891",
        ),
        (
            header_close_raster_icon_asset(),
            "659891",
            "https://www.flaticon.com/free-icon/cancel_659891",
        ),
        (
            header_action_raster_icon_asset(HeaderActionIcon::EnterStackMode)
                .expect("EnterStackMode must use requested Flaticon asset"),
            "10134300",
            "https://www.flaticon.com/free-icon/window_10134300",
        ),
        (
            header_action_raster_icon_asset(HeaderActionIcon::EnterSplitMode)
                .expect("EnterSplitMode must use requested Flaticon asset"),
            "3405258",
            "https://www.flaticon.com/free-icon/dashboard_3405258",
        ),
        (
            titlebar_action_raster_icon_asset(TitlebarActionIcon::Settings),
            "2040504",
            "https://www.flaticon.com/free-icon/setting_2040504",
        ),
        (
            titlebar_surface_raster_icon_asset(TitlebarSurfaceIcon::WorkspaceRail),
            "8379699",
            "https://www.flaticon.com/free-icon/layouting_8379699",
        ),
        (
            titlebar_surface_raster_icon_asset(TitlebarSurfaceIcon::FileTree),
            "8379768",
            "https://www.flaticon.com/free-icon/layouting_8379768",
        ),
        (
            titlebar_surface_raster_icon_asset(TitlebarSurfaceIcon::DockContext),
            "4225584",
            "https://www.flaticon.com/free-icon/file_4225584",
        ),
        (
            titlebar_action_raster_icon_asset(TitlebarActionIcon::Integration),
            "5089783",
            "https://www.flaticon.com/free-icon/no-connection_5089783",
        ),
        (
            launcher_icon_raster_icon_asset(crate::rendering::launcher::LauncherIcon::Browser)
                .expect("Browser launcher choice must use requested Flaticon asset"),
            "2530583",
            "https://www.flaticon.com/free-icon/web_2530583",
        ),
    ];

    for (asset, expected_id, expected_source) in cases {
        assert_eq!(asset.flaticon_id, expected_id);
        assert_eq!(asset.source_url, expected_source);
        assert!(!asset.bytes.is_empty());
    }
}

#[test]
fn requested_flaticon_icons_use_raster_icon_renderer() {
    // UC-5 BR-48: Requested Flaticon roles draw through the Raster Icon Renderer, not hand-authored SVG constants.
    let renderer = include_str!("../../adapter/outward/renderer_adapter/mod.rs");
    let raster_icon = include_str!("../../adapter/outward/renderer_adapter/raster_icon.rs");
    let view_assets = include_str!("../../adapter/outward/view/raster_icons.rs");
    let header = include_str!("../../adapter/outward/view/header.rs");
    let browser_nav = include_str!("../../adapter/outward/view/chrome/tab_bar.rs");
    let titlebar = include_str!("../../adapter/outward/view/chrome/titlebar.rs");
    let context_menu = include_str!("../../adapter/outward/view/overlays/context_menu.rs");
    let search_bar = include_str!("../../adapter/outward/view/overlays/search_bar.rs");
    let grid = include_str!("../../adapter/outward/view/grid.rs");

    assert!(renderer.contains("raster_icon_pipeline"));
    assert!(raster_icon.contains("pub(crate) struct RasterIconAsset"));
    assert!(raster_icon.contains("image::load_from_memory"));
    assert!(raster_icon.contains("draw_chrome_raster_icon"));
    assert!(raster_icon.contains("draw_top_raster_icon"));
    assert!(view_assets.contains("include_bytes!"));

    for source in [
        header,
        browser_nav,
        titlebar,
        context_menu,
        search_bar,
        grid,
    ] {
        assert!(
            source.contains("draw_chrome_raster_icon") || source.contains("draw_top_raster_icon")
        );
    }
}

#[test]
fn stage_header_view_mode_click_targets_stage_from_dock_focus() {
    // UC-5 BR-34: Stage header ViewMode control targets Stage even when focus currently belongs to Dock.
    let (mut app, first_id, _second_id) = app_with_two_stage_terminals();
    let context_id = app.layout.alloc_id();
    app.panes.insert(
        context_id,
        PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(context_id)),
    );
    app.add_pane_to_dock(context_id, Some(first_id));
    app.set_active_terminal_context_stacked(false);
    app.dock.dock_open = true;
    app.focus.focus_area = crate::state::FocusArea::Dock;
    app.focus.focused = Some(context_id);

    app.header_hit_zones = vec![HeaderHitZone {
        pane_id: first_id,
        rect: crate::tide_core::Rect::new(20.0, 20.0, 18.0, 18.0),
        action: HeaderHitAction::ToggleStageViewMode(false),
    }];
    app.window.last_cursor_pos = Vec2::new(24.0, 24.0);

    let window = test_window_proxy();
    crate::adapter::inward::mouse_adapter::handle_mouse_down(&mut app, MouseButton::Left, &window);

    assert_eq!(app.dock.terminal_view_mode, ViewMode::Stacked);
    assert_eq!(app.focus.zoomed_pane, Some(first_id));
    assert!(!app.active_terminal_context_is_stacked());
}

#[test]
fn dock_header_view_mode_click_targets_terminal_context_surface_only() {
    // UC-5 BR-35: Terminal Context Surface header ViewMode control does not change Stage ViewMode.
    let (mut app, first_id, _second_id) = app_with_two_stage_terminals();
    let context_id = app.layout.alloc_id();
    app.panes.insert(
        context_id,
        PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(context_id)),
    );
    app.add_pane_to_dock(context_id, Some(first_id));
    app.set_active_terminal_context_stacked(false);
    app.dock.dock_open = true;
    app.dock.terminal_view_mode = ViewMode::Split;
    app.focus.zoomed_pane = None;

    app.header_hit_zones = vec![HeaderHitZone {
        pane_id: context_id,
        rect: crate::tide_core::Rect::new(20.0, 20.0, 18.0, 18.0),
        action: HeaderHitAction::ToggleDockViewMode(false),
    }];
    app.window.last_cursor_pos = Vec2::new(24.0, 24.0);

    let window = test_window_proxy();
    crate::adapter::inward::mouse_adapter::handle_mouse_down(&mut app, MouseButton::Left, &window);

    assert!(app.active_terminal_context_is_stacked());
    assert_eq!(app.dock.terminal_view_mode, ViewMode::Split);
    assert_eq!(app.focus.zoomed_pane, None);
}

#[test]
fn view_mode_controls_are_not_pane_header_actions() {
    // UC-5 BR-36: Region ViewMode controls stay out of the default repeated Pane HeaderActionStrip actions.
    let stage_actions: Vec<HeaderHitAction> =
        single_pane_header_action_specs_for_surface(HeaderSurfaceKind::Stage)
            .into_iter()
            .map(|spec| spec.action)
            .collect();
    let dock_actions: Vec<HeaderHitAction> =
        single_pane_header_action_specs_for_surface(HeaderSurfaceKind::TerminalContextSurface)
            .into_iter()
            .map(|spec| spec.action)
            .collect();
    let stacked_actions: Vec<HeaderHitAction> =
        stacked_tab_bar_header_action_specs_for_surface(HeaderSurfaceKind::TerminalContextSurface)
            .into_iter()
            .map(|spec| spec.action)
            .collect();

    assert_eq!(
        stage_actions,
        vec![
            HeaderHitAction::SplitHorizontal,
            HeaderHitAction::SplitVertical,
        ]
    );
    assert_eq!(
        dock_actions,
        vec![
            HeaderHitAction::SplitHorizontal,
            HeaderHitAction::SplitVertical,
        ]
    );
    assert_eq!(stacked_actions, vec![HeaderHitAction::AddPane]);
}

#[test]
fn region_header_view_mode_controls_use_the_leading_slot() {
    // UC-5 BR-37: Region ViewMode controls reuse the leading header slot instead of adding trailing strip width.
    let leading_w =
        header_leading_view_mode_width(Some(&HeaderHitAction::ToggleStageViewMode(true)));
    assert!(leading_w > 0.0);
    assert_eq!(header_leading_view_mode_width(None), 0.0);

    let without_leading = single_pane_header_layout(240.0, 0.0, 96.0, &[], false, 0.0);
    let with_leading = single_pane_header_layout(240.0, 0.0, 96.0, &[], false, leading_w);

    assert!(with_leading.close_hit_x > without_leading.close_hit_x);
    assert_eq!(
        with_leading.title_layout.title_w,
        without_leading.title_layout.title_w
    );
}

#[test]
fn focused_terminal_context_surface_view_mode_icon_paints_after_active_header_background() {
    // UC-5 BR-39: A focused single Terminal Context Surface Pane paints the leading ViewMode control after active header background.
    let steps = single_pane_header_paint_steps(false, true);
    let background_index = steps
        .iter()
        .position(|step| *step == SinglePaneHeaderPaintStep::Background)
        .expect("background step should be present");
    let view_mode_index = steps
        .iter()
        .position(|step| *step == SinglePaneHeaderPaintStep::LeadingViewModeAction)
        .expect("leading ViewMode action step should be present");

    assert!(background_index < view_mode_index);
    assert_eq!(
        single_pane_header_paint_steps(true, true),
        vec![
            SinglePaneHeaderPaintStep::Background,
            SinglePaneHeaderPaintStep::Dot,
            SinglePaneHeaderPaintStep::LeadingViewModeAction,
        ]
    );
}

#[test]
fn stage_region_header_view_mode_control_follows_stage_focus() {
    // UC-5 BR-38: Stage ViewMode control follows the focused Stage Pane, not the fixed rightmost header.
    let (mut app, first_id, second_id) = app_with_two_stage_terminals();
    let visual_rects = vec![
        (
            first_id,
            crate::tide_core::Rect::new(0.0, 0.0, 180.0, 120.0),
        ),
        (
            second_id,
            crate::tide_core::Rect::new(200.0, 0.0, 180.0, 120.0),
        ),
    ];

    app.focus.focused = Some(first_id);
    app.focus.stage_focused = Some(first_id);
    assert_eq!(
        region_header_anchor_pane_id(&app, &visual_rects, false),
        Some(first_id)
    );

    app.focus.focused = Some(second_id);
    app.focus.stage_focused = Some(second_id);
    assert_eq!(
        region_header_anchor_pane_id(&app, &visual_rects, false),
        Some(second_id)
    );
}

#[test]
fn dock_region_header_view_mode_control_follows_terminal_context_surface_focus() {
    // UC-5 BR-38: Terminal Context Surface ViewMode control follows the focused Dock Pane.
    let (mut app, terminal_id) = app_with_stage_terminal_only();
    let context_a = app.layout.alloc_id();
    let context_b = context_a + 1;
    app.panes.insert(
        context_a,
        PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(context_a)),
    );
    app.add_pane_to_dock(context_a, Some(terminal_id));
    app.panes.insert(
        context_b,
        PaneKind::Browser(crate::pane::browser::BrowserPane::new(context_b)),
    );
    app.add_pane_to_dock(context_b, Some(terminal_id));
    app.dock.dock_open = true;
    app.focus.focus_area = crate::state::FocusArea::Dock;

    let visual_rects = vec![
        (
            terminal_id,
            crate::tide_core::Rect::new(0.0, 0.0, 180.0, 120.0),
        ),
        (
            context_a,
            crate::tide_core::Rect::new(200.0, 0.0, 140.0, 120.0),
        ),
        (
            context_b,
            crate::tide_core::Rect::new(360.0, 0.0, 140.0, 120.0),
        ),
    ];

    app.focus.focused = Some(context_a);
    app.dock_layout_set_focused(terminal_id, context_a);
    assert_eq!(
        region_header_anchor_pane_id(&app, &visual_rects, true),
        Some(context_a)
    );

    app.focus.focused = Some(context_b);
    app.dock_layout_set_focused(terminal_id, context_b);
    assert_eq!(
        region_header_anchor_pane_id(&app, &visual_rects, true),
        Some(context_b)
    );
}

#[test]
fn titlebar_identity_uses_leading_workspace_and_cwd_metadata() {
    // UC-5 BR-31: Titlebar identity is leading-aligned and exposes active Workspace title plus cwd metadata.
    let (mut app, _terminal_id) = app_with_stage_terminal_only();
    if app.ws.workspaces.is_empty() {
        app.ws.workspaces.push(crate::Workspace {
            name: "Workspace 1".to_string(),
            layout: crate::tide_layout::SplitLayout::new(),
            focused: None,
            panes: std::collections::HashMap::new(),
        });
        app.ws.workspace_extras.push(crate::WorkspaceExtras::new());
        app.ws.active = 0;
    }
    app.ws.workspaces[app.ws.active].name = "Review browser flow".to_string();

    assert_eq!(titlebar_workspace_title(&app), "Review browser flow");
    assert!(!titlebar_workspace_meta_text(&app, app.ws.active).is_empty());
    assert!(titlebar_identity_origin_x() < 140.0);
}

#[test]
fn fullscreen_titlebar_identity_origin_uses_left_content_inset() {
    // UC-5 BR-50: Full-Screen Space titlebar identity does not reserve the non-fullscreen traffic-light lane.
    let normal_x = titlebar_identity_origin_x_for_window(false);
    let fullscreen_x = titlebar_identity_origin_x_for_window(true);

    assert_eq!(normal_x, titlebar_identity_origin_x());
    assert!(fullscreen_x < normal_x);
    assert_eq!(fullscreen_x, PANE_PADDING);
}

#[test]
fn titlebar_controls_do_not_expose_titlebar_swap() {
    // UC-5 BR-29: The titlebar does not reserve a right-edge swap control; settings is the rightmost titlebar button.
    let app = test_app();
    let pos = titlebar_settings_button_center(&app);

    assert_eq!(
        crate::adapter::inward::click_adapter::hit_test::compute_hover_target(&app, pos),
        Some(HoverTarget::TitlebarSettings)
    );
}

#[test]
fn fullscreen_keeps_titlebar_surface_toggles_visible_and_clickable() {
    // UC-6 BR-27/BR-28: Entering a Full-Screen Space keeps the Tide-rendered titlebar inset and hit targets.
    let mut app = test_app();
    let window = test_window_proxy();

    handle_platform_event(
        &mut app,
        PlatformEvent::Fullscreen {
            is_fullscreen: true,
            width: 960,
            height: 640,
        },
        &window,
    );

    assert!(app.window.is_fullscreen);
    assert_eq!(app.window.top_inset, TITLEBAR_HEIGHT);
    let pos = titlebar_surface_button_center(&app, TitlebarSurfaceButton::FileTree);
    assert_eq!(
        crate::adapter::inward::click_adapter::hit_test::compute_hover_target(&app, pos),
        Some(HoverTarget::TitlebarFileTree)
    );
}
