// Spec: docs/specs/open-terminal-codex-app.md
use crate::adapter::inward::drag_drop_adapter::ws_sidebar_geometry;
use crate::adapter::inward::mouse_adapter::drag::{
    dock_width_from_border_drag, file_tree_width_from_border_drag,
};
use crate::adapter::outward::view::{titlebar_workspace_meta_text, titlebar_workspace_title};
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::{FocusArea, ViewMode};
use crate::theme::PANE_GAP;
use crate::tide_core::LayoutEngine;
use crate::tide_input::GlobalAction;
use crate::ActionPort;
use crate::App;
use crate::AppCorePort;
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

fn app_with_real_terminal() -> (App, u64) {
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    (app, terminal_id)
}

fn app_with_two_real_terminals() -> (App, u64, u64) {
    let (mut app, first) = app_with_real_terminal();
    let second = app
        .layout
        .split(first, crate::tide_core::SplitDirection::Vertical);
    let terminal = TerminalPane::with_cwd(second, 80, 24, None, true).unwrap();
    app.panes.insert(second, PaneKind::Terminal(terminal));
    (app, first, second)
}

fn add_editor_context_tab(app: &mut App, terminal_id: u64) -> u64 {
    let pane_id = app.layout.alloc_id();
    app.panes
        .insert(pane_id, PaneKind::Editor(EditorPane::new_empty(pane_id)));
    app.add_pane_to_dock(pane_id, Some(terminal_id));
    pane_id
}

// --- UC-4: AttachContextToTerminal ---

#[test]
fn terminal_context_surface_split_view_allows_context_splits() {
    // UC-4 BR-2: Terminal Context Surface Split view must allow visible context splits.
    let (mut app, terminal_id) = app_with_real_terminal();
    app.set_dock_zoomed(false);

    let first = add_editor_context_tab(&mut app, terminal_id);
    let second = add_editor_context_tab(&mut app, terminal_id);

    let terminal = match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => terminal,
        _ => panic!("expected real Terminal pane"),
    };

    assert_eq!(
        terminal.dock_layout.all_pane_ids().len(),
        2,
        "both context panes should remain attached to the Terminal"
    );
    assert_eq!(
        terminal.dock_layout.pane_ids().len(),
        2,
        "Split view should expose both context Panes as visible split leaves"
    );
    assert!(terminal.dock_layout.pane_ids().contains(&first));
    assert!(terminal.dock_layout.pane_ids().contains(&second));
}

#[test]
fn terminal_context_split_action_creates_context_split() {
    // UC-4 BR-7: Split actions invoked for Dock must split the Terminal Context Surface.
    let (mut app, terminal_id) = app_with_real_terminal();
    let context_pane = add_editor_context_tab(&mut app, terminal_id);
    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(context_pane);

    app.handle_global_action(GlobalAction::SplitVertical);

    let focused = app
        .focus
        .focused
        .expect("new context Pane should be focused");
    let terminal = match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => terminal,
        _ => panic!("expected real Terminal pane"),
    };
    assert_eq!(
        terminal.dock_layout.all_pane_ids().len(),
        2,
        "split action in Dock should create a new context Pane"
    );
    assert_eq!(
        terminal.dock_layout.pane_ids().len(),
        2,
        "split action in Dock should create a second visible context slot"
    );
    assert!(terminal.dock_layout.all_pane_ids().contains(&context_pane));
    assert!(terminal.dock_layout.all_pane_ids().contains(&focused));
}

#[test]
fn terminal_context_stacked_view_hides_sibling_splits_without_flattening_layout() {
    // UC-4 BR-4: Stacked view shows one active context Pane without flattening the stored SplitLayout.
    let (mut app, terminal_id) = app_with_real_terminal();
    app.set_dock_zoomed(false);
    let first = add_editor_context_tab(&mut app, terminal_id);
    let second = add_editor_context_tab(&mut app, terminal_id);
    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(second);

    app.handle_global_action(GlobalAction::ToggleDockPin);
    app.handle_global_action(GlobalAction::DockToggleStacked);
    app.compute_layout();

    let terminal = match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => terminal,
        _ => panic!("expected real Terminal pane"),
    };
    assert_eq!(terminal.dock_layout.all_pane_ids(), vec![first, second]);
    assert_eq!(
        terminal.dock_layout.pane_ids().len(),
        2,
        "Stacked view should not flatten the stored context SplitLayout"
    );
    assert!(app.dock.pinned_dock_layout.all_pane_ids().is_empty());
    assert_eq!(app.dock_zoomed_pane(), Some(second));
    let visible_ids: Vec<u64> = app.pane_rects.iter().map(|(id, _)| *id).collect();
    assert!(visible_ids.contains(&second));
    assert!(
        !visible_ids.contains(&first),
        "Stacked view should render only the active context Pane"
    );
}

#[test]
fn dock_split_action_splits_terminal_context_surface_not_stage() {
    // UC-4 BR-7: DockSplit actions must split the Terminal Context Surface, not Stage.
    let (mut app, terminal_id) = app_with_real_terminal();
    let first = add_editor_context_tab(&mut app, terminal_id);

    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    let stage_panes_before = app.layout.pane_ids().len();

    app.handle_global_action(GlobalAction::DockSplitVertical);

    let focused = app
        .focus
        .focused
        .expect("new context Pane should be focused");
    let terminal = match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => terminal,
        _ => panic!("expected real Terminal pane"),
    };

    assert_eq!(
        app.layout.pane_ids().len(),
        stage_panes_before,
        "DockSplitVertical should not add panes to Stage layout"
    );
    assert_eq!(
        terminal.dock_layout.all_pane_ids().len(),
        2,
        "DockSplitVertical should add a context Pane"
    );
    assert!(terminal.dock_layout.all_pane_ids().contains(&first));
    assert!(terminal.dock_layout.all_pane_ids().contains(&focused));
    assert_eq!(
        app.focus.focus_area,
        FocusArea::Dock,
        "DockSplitVertical should focus the newly created context Pane"
    );
    assert!(
        !app.dock_zoomed(),
        "explicit Dock split action should switch the active Terminal Context Surface to Split view"
    );
}

#[test]
fn new_stage_terminal_defaults_terminal_context_surface_to_stacked_mode() {
    // UC-4 BR-8: A new Stage Terminal starts its Terminal Context Surface in Stacked view without resetting another Terminal's mode.
    let (mut app, first) = app_with_real_terminal();
    app.set_dock_zoomed(false);
    assert!(!app.dock_zoomed());

    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(first);
    app.focus.stage_focused = Some(first);
    app.new_terminal_tab();

    let second = app
        .focus
        .focused
        .expect("new Stage Terminal should be focused");
    assert_ne!(second, first);
    let second_terminal = match app.panes.get(&second) {
        Some(PaneKind::Terminal(terminal)) => terminal,
        _ => panic!("expected new Stage Terminal"),
    };
    assert_eq!(second_terminal.dock_view_mode, ViewMode::Stacked);
    assert!(app.dock_zoomed());

    app.focus_terminal(first);
    let first_terminal = match app.panes.get(&first) {
        Some(PaneKind::Terminal(terminal)) => terminal,
        _ => panic!("expected original Stage Terminal"),
    };
    assert_eq!(first_terminal.dock_view_mode, ViewMode::Split);
    assert!(
        !app.dock_zoomed(),
        "returning to the original Stage Terminal should restore its Split choice"
    );
}

#[test]
fn file_tree_view_uses_right_side_without_left_sidebar() {
    // UC-4 BR-6: FileTree View is independent from Terminal Context Surface and uses the outer-right region.
    let (mut app, _terminal_id) = app_with_real_terminal();
    app.ft.visible = true;
    app.focus.focus_area = FocusArea::FileTree;

    app.compute_layout();

    let pane_area = app.pane_area_rect.expect("Stage area should be computed");
    let file_tree_rect = app.ft.rect.expect("FileTree View rect should be computed");
    assert!(
        file_tree_rect.x >= pane_area.x + pane_area.width,
        "FileTree should be placed to the right of Stage"
    );
    assert_eq!(
        pane_area.x, 0.0,
        "FileTree View should not reserve a left global sidebar"
    );
}

#[test]
fn file_tree_view_coexists_with_terminal_context_surface() {
    // UC-4 BR-6: FileTree View and Terminal Context Surface are sibling right-side surfaces.
    let (mut app, terminal_id) = app_with_real_terminal();
    let context_pane = add_editor_context_tab(&mut app, terminal_id);
    app.ft.visible = true;
    app.focus.focus_area = FocusArea::FileTree;

    app.compute_layout();

    let visible_ids: Vec<u64> = app.pane_rects.iter().map(|(id, _)| *id).collect();
    assert!(
        visible_ids.contains(&context_pane),
        "Terminal Context Surface Pane should remain visible when FileTree View is visible"
    );
    let context_rect = app
        .pane_rects
        .iter()
        .find(|(id, _)| *id == context_pane)
        .map(|(_, rect)| *rect)
        .expect("context Pane rect should be computed");
    let file_tree_rect = app.ft.rect.expect("FileTree View rect should be computed");
    assert!(
        context_rect.x + context_rect.width <= file_tree_rect.x,
        "Terminal Context Surface should sit inside FileTree View, not behind or after it"
    );
    let terminal = match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => terminal,
        _ => panic!("expected real Terminal pane"),
    };
    assert!(
        terminal.dock_layout.all_pane_ids().contains(&context_pane),
        "hidden context Pane should stay attached to the owning Terminal"
    );
}

#[test]
fn file_tree_view_stays_right_side_when_stage_terminal_switches() {
    // UC-5 BR-4: FileTree View remains an outer-right view when the focused Stage Terminal changes.
    let (mut app, first, second) = app_with_two_real_terminals();
    let first_context = add_editor_context_tab(&mut app, first);
    app.ft.visible = true;
    app.focus.focus_area = FocusArea::FileTree;
    app.focus.stage_focused = Some(first);
    app.focus.focused = Some(first);
    app.compute_layout();

    app.focus_terminal(second);
    app.compute_layout();

    let pane_area = app.pane_area_rect.expect("Stage area should be computed");
    let file_tree_rect = app.ft.rect.expect("FileTree View rect should be computed");
    let visible_ids: Vec<u64> = app.pane_rects.iter().map(|(id, _)| *id).collect();
    assert!(app.ft.visible);
    assert!(
        file_tree_rect.x >= pane_area.x + pane_area.width,
        "FileTree should continue to occupy the outer-right region after Stage Terminal switch"
    );
    assert!(
        !visible_ids.contains(&first_context),
        "previous Terminal's context Pane should remain hidden after Stage Terminal switch"
    );
}

// --- UC-1: NavigateWorkspaceTasks ---

#[test]
fn workspace_rows_stay_compact_for_many_concurrent_tasks() {
    // UC-1 BR-5: Workspace rows must remain compact enough to monitor many tasks at once.
    let (mut app, _terminal_id) = app_with_real_terminal();
    app.ws.show_sidebar = true;
    app.compute_layout();

    let geometry = ws_sidebar_geometry(&app).expect("Workspace rail geometry should exist");

    assert!(
        geometry.item_h <= app.window.cached_cell_size.height + 12.0,
        "Workspace rows should be a dense one-line monitor, not a card list"
    );
}

#[test]
fn workspace_rows_do_not_render_large_terminal_previews() {
    // UC-1 BR-6: Workspace rows may summarize live task state, but must not become large embedded terminal previews.
    let (mut app, _terminal_id) = app_with_real_terminal();
    app.ws.show_sidebar = true;
    app.compute_layout();

    let geometry = ws_sidebar_geometry(&app).expect("Workspace rail geometry should exist");

    assert!(
        geometry.item_h < app.window.cached_cell_size.height * 2.0,
        "Workspace row height should leave no room for terminal preview cards"
    );
}

#[test]
fn inactive_workspace_rows_show_terminal_cwd_metadata() {
    // UC-1 BR-7: Inactive Workspace rows show stored Terminal CWD metadata when the rail has room.
    let mut app = test_app();
    let active_workspace = crate::Workspace {
        name: "Active".to_string(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: std::collections::HashMap::new(),
    };

    let (inactive_layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    let mut inactive_terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    inactive_terminal.context.cwd = Some(std::path::PathBuf::from("/tmp/tide-inactive"));
    let mut inactive_panes = std::collections::HashMap::new();
    inactive_panes.insert(terminal_id, PaneKind::Terminal(inactive_terminal));
    let inactive_workspace = crate::Workspace {
        name: "Review".to_string(),
        layout: inactive_layout,
        focused: Some(terminal_id),
        panes: inactive_panes,
    };

    app.ws.workspaces = vec![active_workspace, inactive_workspace];
    app.ws.workspace_extras = vec![crate::WorkspaceExtras::new(), {
        let mut extras = crate::WorkspaceExtras::new();
        extras.stage_focused = Some(terminal_id);
        extras
    }];
    app.ws.active = 0;

    assert_eq!(titlebar_workspace_meta_text(&app, 1), "/tmp/tide-inactive");
}

// --- UC-9: PreserveVisualHierarchy ---

#[test]
fn collapsed_workspace_rail_keeps_active_workspace_identity_visible() {
    // UC-9 BR-1: Workspace identity must be visible even when the rail is collapsed.
    let (mut app, _terminal_id) = app_with_real_terminal();
    if app.ws.workspaces.is_empty() {
        app.ws.workspaces.push(crate::Workspace {
            name: "Workspace 1".to_string(),
            layout: crate::tide_layout::SplitLayout::new(),
            focused: None,
            panes: std::collections::HashMap::new(),
        });
        app.ws.active = 0;
    }
    app.ws.show_sidebar = false;
    app.ws.workspaces[app.ws.active].name = "Review browser flow".to_string();

    let title = titlebar_workspace_title(&app);

    assert_eq!(title, "Review browser flow");
    assert!(
        !title.starts_with("Tide"),
        "titlebar should show active Workspace identity rather than app-only numbering"
    );
}

#[test]
fn major_region_seams_stay_compact() {
    // UC-9 BR-6: Major region seams must use compact spacing and thin hover/drop affordances.
    let (mut app, terminal_id) = app_with_real_terminal();
    add_editor_context_tab(&mut app, terminal_id);
    app.ws.show_sidebar = true;
    app.ft.visible = true;

    app.compute_layout();

    let pane_area = app.pane_area_rect.expect("Stage area should be computed");
    let dock_area = app
        .dock_area_rect
        .expect("Terminal Context Surface area should be computed");
    let file_tree = app.ft.rect.expect("FileTree View rect should be computed");
    let workspace = app
        .ws
        .sidebar_rect
        .expect("Workspace rail rect should be computed");

    assert!(PANE_GAP <= 2.0);
    assert_eq!(
        pane_area.x,
        workspace.x + workspace.width,
        "Workspace rail should touch Stage at the layout level"
    );
    assert_eq!(
        dock_area.x - (pane_area.x + pane_area.width),
        PANE_GAP,
        "Stage to Terminal Context Surface seam should use the compact Pane gap"
    );
    assert_eq!(
        file_tree.x,
        dock_area.x + dock_area.width,
        "Terminal Context Surface should touch FileTree View at the layout level"
    );
}

#[test]
fn region_border_drag_preserves_width_at_current_seams() {
    // UC-9 BR-7: Border resize must preserve current width when dragging starts on the rendered seam.
    let (mut app, terminal_id) = app_with_real_terminal();
    add_editor_context_tab(&mut app, terminal_id);
    app.ws.show_sidebar = true;
    app.ws.width = 160.0;
    app.dock.dock_width = 240.0;
    app.ft.visible = true;
    app.ft.width = 180.0;
    app.ws.visibility_animation = None;
    app.dock.visibility_animation = None;
    app.ft.visibility_animation = None;

    app.compute_layout();

    let logical = app.logical_size();
    let workspace = app
        .ws
        .sidebar_rect
        .expect("Workspace rail rect should be computed");
    let pane_area = app.pane_area_rect.expect("Stage area should be computed");
    let dock_area = app
        .dock_area_rect
        .expect("Terminal Context Surface area should be computed");
    let file_tree = app.ft.rect.expect("FileTree View rect should be computed");

    let workspace_width = pane_area.x - workspace.x;
    let dock_width = dock_width_from_border_drag(
        logical.width,
        Some(dock_area),
        pane_area.x + pane_area.width,
        PANE_GAP,
    );
    let file_tree_width = file_tree_width_from_border_drag(logical.width, file_tree.x, PANE_GAP);

    assert!(
        (workspace_width - app.ws.width).abs() < f32::EPSILON,
        "Workspace rail drag should not jump when started at the visible seam"
    );
    assert!(
        (dock_width - app.dock.dock_width).abs() < f32::EPSILON,
        "Terminal Context Surface drag should not jump when FileTree View is visible"
    );
    assert!(
        (file_tree_width - app.ft.width).abs() < f32::EPSILON,
        "FileTree View drag should not jump when started at its connected seam"
    );
}

#[test]
fn terminal_context_surface_seam_uses_single_hairline_without_shadow_strips() {
    // UC-9 BR-8: Terminal Context Surface seams must not draw multi-strip shadow gutters.
    let source = include_str!("../../adapter/outward/view/chrome/tab_bar.rs");

    assert!(source.contains("Stage<->Dock boundary with a single hairline"));
    assert!(!source.contains("sep_x - 3.0"));
    assert!(!source.contains("sep_x - 2.0"));
    assert!(!source.contains("sep_x - 1.0"));
    assert!(!source.contains("sep_x + 1.0"));
    assert!(!source.contains("sep_x + 2.0"));
    assert!(!source.contains("sep_x + 3.0"));
}
