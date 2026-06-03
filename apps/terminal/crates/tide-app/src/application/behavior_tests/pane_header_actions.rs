// Spec: docs/specs/pane-header-actions.md

use std::path::PathBuf;

use crate::adapter::inward::click_adapter::header::check_header_click;
use crate::header::{HeaderHitAction, HeaderHitZone};
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::FocusArea;
use crate::tide_core::{LayoutEngine, Rect, SplitDirection, Vec2};
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

fn app_with_stage_terminal() -> (App, u64) {
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;

    let cwd = PathBuf::from(format!("/tmp/pane-header-actions-{}", terminal_id));
    std::fs::create_dir_all(&cwd).unwrap();
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, Some(cwd), true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    (app, terminal_id)
}

fn app_with_two_stage_terminals() -> (App, u64, u64) {
    let (mut app, first_id) = app_with_stage_terminal();
    let second_id = app.layout.split(first_id, SplitDirection::Vertical);
    let cwd = PathBuf::from(format!("/tmp/pane-header-actions-{}", second_id));
    std::fs::create_dir_all(&cwd).unwrap();
    let terminal = TerminalPane::with_cwd(second_id, 80, 24, Some(cwd), true).unwrap();
    app.panes.insert(second_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(first_id);
    app.focus.stage_focused = Some(first_id);
    (app, first_id, second_id)
}

fn app_with_dock_editor() -> (App, u64, u64) {
    let (mut app, terminal_id) = app_with_stage_terminal();
    let editor_id = app.layout.alloc_id();
    app.panes.insert(
        editor_id,
        PaneKind::Editor(EditorPane::new_empty(editor_id)),
    );
    app.add_pane_to_dock(editor_id, Some(terminal_id));
    app.focus_terminal(editor_id);
    (app, terminal_id, editor_id)
}

fn click_header_action(app: &mut App, pane_id: u64, action: HeaderHitAction) {
    app.window.last_cursor_pos = Vec2::new(12.0, 10.0);
    app.header_hit_zones = vec![HeaderHitZone {
        pane_id,
        rect: Rect::new(0.0, 0.0, 48.0, 20.0),
        action,
    }];
    assert!(
        check_header_click(app),
        "expected header click to be consumed"
    );
}

// --- UC-1: TriggerHeaderLauncherAction ---

#[test]
fn clicking_dock_add_pane_header_action_creates_launcher_pane() {
    // UC-1 BR-2: Clicking AddPane in a Terminal Context Surface creates a focused Launcher Pane instead of an immediate Terminal Pane.
    let (mut app, terminal_id, dock_pane_id) = app_with_dock_editor();
    app.set_active_terminal_context_stacked(true);
    let pane_count_before = app.panes.len();

    click_header_action(&mut app, dock_pane_id, HeaderHitAction::AddPane);

    let new_id = app
        .focus
        .focused
        .expect("new Launcher Pane should be focused");
    assert_ne!(new_id, dock_pane_id);
    assert_eq!(app.panes.len(), pane_count_before + 1);
    assert!(matches!(
        app.panes.get(&new_id),
        Some(PaneKind::Launcher(_))
    ));
    assert_eq!(app.focus.focus_area, FocusArea::Dock);
    assert_eq!(app.terminal_owning(new_id), Some(terminal_id));
    assert!(app.is_pane_in_dock(new_id));
}

#[test]
fn clicking_stage_stacked_add_pane_splits_the_last_stage_pane_vertically() {
    // UC-1 BR-2a: Stacked AddPane vertically splits the last Stage Pane so the Launcher becomes the final stacked tab.
    let (mut app, first_id, second_id) = app_with_two_stage_terminals();
    app.handle_toggle_stacked();
    assert_eq!(app.layout.pane_ids().last().copied(), Some(second_id));

    click_header_action(&mut app, first_id, HeaderHitAction::AddPane);

    let new_id = app
        .focus
        .focused
        .expect("new Stage Launcher Pane should be focused");
    assert!(matches!(
        app.panes.get(&new_id),
        Some(PaneKind::Launcher(_))
    ));
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert_eq!(app.focus.zoomed_pane, Some(new_id));
    assert_eq!(app.layout.pane_ids().last().copied(), Some(new_id));
    assert_eq!(app.layout.pane_ids(), vec![first_id, second_id, new_id]);
    match app
        .layout_snapshot()
        .expect("Stage layout snapshot should exist")
    {
        crate::tide_layout::LayoutSnapshot::Split { direction, .. } => {
            assert_eq!(direction, SplitDirection::Vertical);
        }
        other => panic!("expected vertical Stage split chain, got {other:?}"),
    }
}

#[test]
fn clicking_dock_stacked_add_pane_splits_the_last_context_pane_vertically() {
    // UC-1 BR-2a: Stacked AddPane vertically splits the last Terminal Context Surface Pane so the Launcher becomes the final stacked tab.
    let (mut app, terminal_id, first_context_id) = app_with_dock_editor();
    let second_context_id = app.layout.alloc_id();
    app.panes.insert(
        second_context_id,
        PaneKind::Editor(EditorPane::new_empty(second_context_id)),
    );
    app.add_pane_to_dock(second_context_id, Some(terminal_id));
    app.set_active_terminal_context_stacked(true);
    app.focus_terminal(first_context_id);

    click_header_action(&mut app, first_context_id, HeaderHitAction::AddPane);

    let new_id = app
        .focus
        .focused
        .expect("new context Launcher Pane should be focused");
    assert!(matches!(
        app.panes.get(&new_id),
        Some(PaneKind::Launcher(_))
    ));
    assert_eq!(app.focus.focus_area, FocusArea::Dock);
    assert_eq!(app.terminal_owning(new_id), Some(terminal_id));
    let owner = app
        .panes
        .get(&terminal_id)
        .and_then(|pane| match pane {
            PaneKind::Terminal(terminal) => Some(terminal),
            _ => None,
        })
        .expect("owner terminal should exist");
    assert_eq!(
        owner.dock_layout.all_tabs_flat(),
        vec![first_context_id, second_context_id, new_id]
    );
    assert_eq!(owner.dock_view_mode, crate::state::ViewMode::Stacked);
}

// --- UC-2: TriggerHeaderSplitActions ---

#[test]
fn clicking_stage_split_horizontal_header_action_creates_a_height_split() {
    // UC-2 BR-3: Clicking SplitHorizontal from a focused Stage header creates a new Stage split that divides height and focuses the new Terminal.
    let (mut app, terminal_id) = app_with_stage_terminal();

    click_header_action(&mut app, terminal_id, HeaderHitAction::SplitHorizontal);

    let new_id = app
        .focus
        .focused
        .expect("new split terminal should be focused");
    assert_ne!(new_id, terminal_id);
    assert!(matches!(
        app.panes.get(&new_id),
        Some(PaneKind::Terminal(_))
    ));
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert_eq!(app.layout.pane_ids().len(), 2);
    assert_eq!(app.layout.pane_ids().len(), app.layout.all_pane_ids().len());
    match app
        .layout_snapshot()
        .expect("split layout snapshot should exist")
    {
        crate::tide_layout::LayoutSnapshot::Split { direction, .. } => {
            assert_eq!(direction, SplitDirection::Horizontal);
        }
        other => panic!("expected split layout after horizontal header action, got {other:?}"),
    }
}

#[test]
fn clicking_stage_split_vertical_header_action_creates_a_width_split() {
    // UC-2 BR-4: Clicking SplitVertical from a focused Stage header creates a new Stage split that divides width and focuses the new Terminal.
    let (mut app, terminal_id) = app_with_stage_terminal();

    click_header_action(&mut app, terminal_id, HeaderHitAction::SplitVertical);

    let new_id = app
        .focus
        .focused
        .expect("new split terminal should be focused");
    assert_ne!(new_id, terminal_id);
    assert!(matches!(
        app.panes.get(&new_id),
        Some(PaneKind::Terminal(_))
    ));
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert_eq!(app.layout.pane_ids().len(), 2);
    assert_eq!(app.layout.pane_ids().len(), app.layout.all_pane_ids().len());
    match app
        .layout_snapshot()
        .expect("split layout snapshot should exist")
    {
        crate::tide_layout::LayoutSnapshot::Split { direction, .. } => {
            assert_eq!(direction, SplitDirection::Vertical);
        }
        other => panic!("expected split layout after vertical header action, got {other:?}"),
    }
}

#[test]
fn clicking_dock_split_header_action_creates_context_split() {
    // Spec: docs/specs/pane-header-actions.md
    // UC-2 BR-5: Clicking a split action from a focused Dock header must create a context split.
    let (mut app, terminal_id, dock_pane_id) = app_with_dock_editor();
    let pane_count_before = app.panes.len();

    click_header_action(&mut app, dock_pane_id, HeaderHitAction::SplitHorizontal);

    let new_id = app
        .focus
        .focused
        .expect("new context split should be focused");
    assert_eq!(app.panes.len(), pane_count_before + 1);
    assert!(matches!(
        app.panes.get(&new_id),
        Some(PaneKind::Launcher(_))
    ));
    assert_eq!(app.focus.focus_area, FocusArea::Dock);
    let owner = app
        .panes
        .get(&terminal_id)
        .and_then(|pane| match pane {
            PaneKind::Terminal(terminal) => Some(terminal),
            _ => None,
        })
        .expect("owner terminal should exist");
    assert!(owner.dock_layout.all_pane_ids().contains(&dock_pane_id));
    assert_eq!(owner.dock_layout.all_pane_ids().len(), 2);
    assert_eq!(owner.dock_layout.pane_ids().len(), 2);
}
