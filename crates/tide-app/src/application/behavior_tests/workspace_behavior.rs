// Spec: docs/specs/workspace.md
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::update::workspace_infra_service::Workspace;
use crate::App;
use crate::ActionPort;
use std::collections::HashMap;
use crate::tide_layout::SplitLayout;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_two_workspaces() -> App {
    let mut app = test_app();

    // Use distinct pane IDs for each workspace
    let id1: u64 = 100;
    let id2: u64 = 200;

    // Push two workspace slots
    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: SplitLayout::new(),
        focused: None,
        panes: HashMap::new(),
    });
    app.ws.workspaces.push(Workspace {
        name: "WS2".into(),
        layout: SplitLayout::new(),
        focused: None,
        panes: HashMap::new(),
    });

    // Set up WS1 as active
    app.ws.active = 0;
    app.panes = HashMap::new();
    app.panes.insert(id1, PaneKind::Editor(EditorPane::new_empty(id1)));
    app.focus.focused = Some(id1);
    app.focus.focus_area = FocusArea::Stage;

    // Save WS1, switch to WS2
    app.save_active_workspace();
    app.ws.active = 1;
    app.panes = HashMap::new();
    app.panes.insert(id2, PaneKind::Editor(EditorPane::new_empty(id2)));
    app.focus.focused = Some(id2);
    app.save_active_workspace();

    // Load WS1 back as active
    app.ws.active = 0;
    app.load_active_workspace();
    app
}

// --- UC-1: SwitchWorkspace ---

#[test]
fn switching_workspace_in_workspace_manager_preserves_each_workspaces_focus() {
    // UC-1 BR-1: Switching preserves each Workspace's focused Pane
    let mut app = app_with_two_workspaces();
    let ws1_focus = app.focus.focused;
    assert_eq!(ws1_focus, Some(100));

    app.switch_workspace(1);
    let ws2_focus = app.focus.focused;
    assert_eq!(ws2_focus, Some(200));

    app.switch_workspace(0);
    assert_eq!(app.focus.focused, Some(100));
}

#[test]
fn switching_to_same_workspace_is_a_no_op() {
    // UC-1 BR-2: Switching to the same Workspace is a no-op
    let mut app = app_with_two_workspaces();
    let gen_before = app.cache.chrome_generation;
    app.switch_workspace(0);
    assert_eq!(app.cache.chrome_generation, gen_before);
}

#[test]
fn switching_to_out_of_bounds_workspace_is_a_no_op() {
    // UC-1 BR-3: Switching to out-of-bounds index is a no-op
    let mut app = app_with_two_workspaces();
    let focus_before = app.focus.focused;
    app.switch_workspace(99);
    assert_eq!(app.focus.focused, focus_before);
}

#[test]
fn workspace_prev_wraps_from_first_to_last() {
    // UC-1 BR-4: WorkspacePrev wraps from first to last
    let mut app = app_with_two_workspaces();
    assert_eq!(app.ws.active, 0);
    app.handle_global_action(crate::tide_input::GlobalAction::WorkspacePrev);
    assert_eq!(app.ws.active, 1);
}

#[test]
fn workspace_next_wraps_from_last_to_first() {
    // UC-1 BR-5: WorkspaceNext wraps from last to first
    let mut app = app_with_two_workspaces();
    app.switch_workspace(1);
    assert_eq!(app.ws.active, 1);
    app.handle_global_action(crate::tide_input::GlobalAction::WorkspaceNext);
    assert_eq!(app.ws.active, 0);
}

// --- UC-2: CloseWorkspace ---

#[test]
fn closing_only_workspace_in_workspace_manager_is_a_no_op() {
    // UC-2 BR-7: Closing the only Workspace is a no-op
    let mut app = test_app();
    app.ws.workspaces.push(Workspace {
        name: "Only".into(),
        layout: SplitLayout::new(),
        focused: None,
        panes: HashMap::new(),
    });
    app.close_workspace();
    assert_eq!(app.ws.workspaces.len(), 1);
}

#[test]
fn closing_workspace_removes_from_workspace_manager_and_switches() {
    // UC-2 BR-8: Closing a Workspace removes it and switches to adjacent
    let mut app = app_with_two_workspaces();
    assert_eq!(app.ws.workspaces.len(), 2);
    app.close_workspace();
    assert_eq!(app.ws.workspaces.len(), 1);
}

#[test]
fn switching_workspace_preserves_view_mode() {
    // UC-1 BR-10: Switching preserves each Workspace's ViewMode (Split/Stacked)
    use crate::state::ViewMode;
    let mut app = app_with_two_workspaces();
    assert_eq!(app.ws.active, 0);

    // Set WS1 to Stacked
    app.dock.terminal_view_mode = ViewMode::Stacked;

    // Switch to WS2 — should be Split (default)
    app.switch_workspace(1);
    assert_eq!(app.dock.terminal_view_mode, ViewMode::Split);

    // Switch back to WS1 — should be Stacked
    app.switch_workspace(0);
    assert_eq!(app.dock.terminal_view_mode, ViewMode::Stacked);
}

#[test]
fn switching_workspace_preserves_zoomed_pane() {
    // UC-1 BR-11: Switching preserves each Workspace's zoomed_pane
    let mut app = app_with_two_workspaces();

    // Set WS1 zoomed_pane
    app.focus.zoomed_pane = Some(100);

    // Switch to WS2 — should have no zoomed pane
    app.switch_workspace(1);
    assert_eq!(app.focus.zoomed_pane, None);

    // Switch back to WS1 — should restore zoomed_pane
    app.switch_workspace(0);
    assert_eq!(app.focus.zoomed_pane, Some(100));
}

#[test]
fn switching_workspace_preserves_focus_area() {
    // UC-1 BR-12: Switching preserves each Workspace's FocusArea
    let mut app = app_with_two_workspaces();

    // Set WS1 to Dock focus
    app.focus.focus_area = FocusArea::Dock;

    // Switch to WS2 — should be Stage (default)
    app.switch_workspace(1);
    assert_eq!(app.focus.focus_area, FocusArea::Stage);

    // Switch back to WS1 — should restore Dock
    app.switch_workspace(0);
    assert_eq!(app.focus.focus_area, FocusArea::Dock);
}

// --- UC-3: ToggleWorkspaceSidebar ---

#[test]
fn toggling_workspace_sidebar_toggles_visibility() {
    // UC-3 BR-9: Toggle flips visibility state (default: closed)
    let mut app = test_app();
    assert!(!app.ws.show_sidebar);
    app.handle_global_action(crate::tide_input::GlobalAction::ToggleWorkspaceSidebar);
    assert!(app.ws.show_sidebar);
    app.handle_global_action(crate::tide_input::GlobalAction::ToggleWorkspaceSidebar);
    assert!(!app.ws.show_sidebar);
}
