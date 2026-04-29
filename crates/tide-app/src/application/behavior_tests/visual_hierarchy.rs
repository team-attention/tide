// Spec: docs/specs/visual-hierarchy.md

use std::time::{Duration, Instant};

use crate::adapter::outward::clock_adapter::FixedClock;
use crate::adapter::outward::view::{
    titlebar_button_backdrop_level, titlebar_surface_button_icon, titlebar_surface_icon_text_glyph,
    titlebar_toggle_button_draws_hotkey_hint, titlebar_toggle_button_height,
    titlebar_toggle_button_width, TitlebarSurfaceIcon,
};
use crate::event_loop::handle_platform_event;
use crate::header::{
    header_action_glyph, single_pane_header_action_specs_for_surface, single_pane_header_chrome,
    single_pane_header_layout, stacked_tab_bar_header_action_specs, HeaderHitAction,
    HeaderSurfaceKind,
};
use crate::pane::{PaneKind, TerminalPane};
use crate::state::{
    drag_types::HoverTarget, SurfaceVisibilityAnimation, SURFACE_VISIBILITY_ANIMATION_DURATION,
};
use crate::theme::{
    PANE_PADDING, TITLEBAR_BUTTON_GAP, TITLEBAR_HEIGHT, TITLEBAR_ICON_BUTTON_PAD_H,
    TITLEBAR_ICON_BUTTON_PAD_V, TITLEBAR_ICON_SCALE,
};
use crate::tide_core::{LayoutEngine, Vec2};
use crate::tide_input::GlobalAction;
use crate::tide_platform::{PlatformEvent, WindowProxy};
use crate::ui::{file_icon, file_icon_kind, file_tree_disclosure, FileIconKind};
use crate::ActionPort;
use crate::App;
use crate::DockPort;
use crate::LayoutPort;
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
    let theme_x = gear_x - btn_w - TITLEBAR_BUTTON_GAP;
    let integ_x = theme_x - btn_w - TITLEBAR_BUTTON_GAP;
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
    assert!(action_kinds.contains(&HeaderHitAction::OpenBrowser));
    assert!(action_kinds.contains(&HeaderHitAction::SplitHorizontal));
    assert!(action_kinds.contains(&HeaderHitAction::SplitVertical));
}

#[test]
fn stage_single_pane_header_still_reserves_title_and_close() {
    // UC-1 BR-3: Stage single Pane headers still reserve title and close hit zones.
    let layout = single_pane_header_layout(240.0, 0.0, 96.0, &[], false);

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
    assert!(action_kinds.contains(&HeaderHitAction::OpenBrowser));
    assert!(action_kinds.contains(&HeaderHitAction::SplitHorizontal));
    assert!(action_kinds.contains(&HeaderHitAction::SplitVertical));
}

#[test]
fn stacked_tab_bar_header_uses_plus_instead_of_split_actions() {
    // UC-2 BR-21: Stacked mode tab bars use add-pane plus affordance instead of split-direction icons.
    let actions = stacked_tab_bar_header_action_specs();
    let action_kinds: Vec<HeaderHitAction> =
        actions.iter().map(|spec| spec.action.clone()).collect();

    assert_eq!(
        action_kinds,
        vec![HeaderHitAction::OpenBrowser, HeaderHitAction::AddPane]
    );
    assert_eq!(
        header_action_glyph(&HeaderHitAction::AddPane),
        Some("\u{f067}")
    );
    assert!(!action_kinds.contains(&HeaderHitAction::SplitHorizontal));
    assert!(!action_kinds.contains(&HeaderHitAction::SplitVertical));
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
