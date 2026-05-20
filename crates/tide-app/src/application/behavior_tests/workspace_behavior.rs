// Spec: docs/specs/workspace.md
use crate::pane::browser::BrowserPane;
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::tide_layout::SplitLayout;
use crate::update::workspace_infra_service::Workspace;
use crate::ActionPort;
use crate::App;
use std::collections::HashMap;

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
    app.panes
        .insert(id1, PaneKind::Editor(EditorPane::new_empty(id1)));
    app.focus.focused = Some(id1);
    app.focus.focus_area = FocusArea::Stage;

    // Save WS1, switch to WS2
    app.save_active_workspace();
    app.ws.active = 1;
    app.panes = HashMap::new();
    app.panes
        .insert(id2, PaneKind::Editor(EditorPane::new_empty(id2)));
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

#[test]
fn save_active_workspace_hides_browser_native_view_before_cold_storage() {
    // UC-1 BR-14: save_active_workspace hides Browser Pane native views and
    // clears Browser Pane first-responder state before cold storage.
    let mut app = test_app();
    let browser_id = 42u64;

    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: SplitLayout::new(),
        focused: None,
        panes: HashMap::new(),
    });
    app.ws.active = 0;
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            browser_id,
            "https://example.com".to_string(),
        )),
    );
    if let Some(PaneKind::Browser(browser)) = app.panes.get_mut(&browser_id) {
        browser.is_first_responder = true;
    }

    app.save_active_workspace();

    match app.ws.workspaces[0].panes.get(&browser_id) {
        Some(PaneKind::Browser(browser)) => assert!(
            !browser.is_first_responder,
            "cold-stored Browser Pane must not retain native first responder state"
        ),
        _ => panic!("Browser Pane should be cold-stored in Workspace 0"),
    }
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

// Spec: docs/specs/rename-workspaces.md
//
// --- UC-1: RenameWorkspace ---

// UC-1 BR-1: rename_workspace updates the active Workspace name
#[test]
fn rename_workspace_updates_active_workspace_name() {
    use crate::WorkspaceNavPort;
    let mut app = app_with_two_workspaces();
    let active = app.ws.active;

    app.rename_workspace(active, "Renamed Active".to_string());

    assert_eq!(app.ws.workspaces[active].name, "Renamed Active");
}

// UC-1 BR-2: rename_workspace updates a cold-stored (inactive) Workspace
#[test]
fn rename_workspace_updates_cold_stored_workspace_name() {
    use crate::WorkspaceNavPort;
    let mut app = app_with_two_workspaces();
    let inactive = 1 - app.ws.active;

    app.rename_workspace(inactive, "Renamed Cold".to_string());

    assert_eq!(app.ws.workspaces[inactive].name, "Renamed Cold");
}

// UC-1 BR-3: empty / whitespace-only names are rejected
#[test]
fn rename_workspace_with_empty_name_is_a_no_op() {
    use crate::WorkspaceNavPort;
    let mut app = app_with_two_workspaces();
    let active = app.ws.active;
    let original = app.ws.workspaces[active].name.clone();

    app.rename_workspace(active, "".to_string());
    app.rename_workspace(active, "   ".to_string());

    assert_eq!(app.ws.workspaces[active].name, original);
}

// UC-1 BR-4: rename survives a switch out and back
#[test]
fn rename_workspace_persists_across_switch_out_and_back() {
    use crate::WorkspaceNavPort;
    let mut app = app_with_two_workspaces();
    let active = app.ws.active;
    let other = 1 - active;

    app.rename_workspace(active, "Persisted".to_string());
    app.switch_workspace(other);
    app.switch_workspace(active);

    assert_eq!(app.ws.workspaces[active].name, "Persisted");
}

// UC-1 BR-5: out-of-bounds index is a no-op
#[test]
fn rename_workspace_with_out_of_bounds_index_is_a_no_op() {
    use crate::WorkspaceNavPort;
    let mut app = app_with_two_workspaces();
    let len = app.ws.workspaces.len();
    let before: Vec<String> = app.ws.workspaces.iter().map(|w| w.name.clone()).collect();

    app.rename_workspace(len, "Nope".to_string());
    app.rename_workspace(len + 5, "Also nope".to_string());

    let after: Vec<String> = app.ws.workspaces.iter().map(|w| w.name.clone()).collect();
    assert_eq!(before, after);
}

// --- UC-2: OpenWorkspaceRenameModal ---

// UC-2 BR-1: right-click on a Workspace rail item opens the ContextMenu with Rename
#[test]
fn right_click_on_workspace_sidebar_item_opens_context_menu_with_rename() {
    use crate::tide_core::MouseButton;
    use crate::LayoutPort;
    use crate::WorkspaceNavPort;

    let (tx, _rx) = std::sync::mpsc::channel();
    let window = crate::tide_platform::WindowProxy::new(tx, std::sync::Arc::new(|| {}));

    let mut app = app_with_two_workspaces();
    app.ws.show_sidebar = true;
    app.compute_layout();

    // Resolve where the workspace 0 rail item sits on screen
    let rect = app
        .workspace_sidebar_item_rect(0)
        .expect("workspace sidebar item rect");
    app.window.last_cursor_pos = crate::tide_core::Vec2::new(
        rect.x + rect.width / 2.0,
        rect.y + rect.height / 2.0,
    );

    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        MouseButton::Right,
        &window,
    );

    let menu = app
        .modal
        .context_menu
        .as_ref()
        .expect("context menu should be open");
    match &menu.target {
        crate::ContextMenuTarget::WorkspaceSidebarItem { ws_index } => assert_eq!(*ws_index, 0),
        other => panic!("expected WorkspaceSidebarItem target, got {:?}", other),
    }
    let labels: Vec<&'static str> = menu.items().iter().map(|a| a.label()).collect();
    assert_eq!(labels, vec!["Rename"]);
}

// UC-2 BR-3: Enter commits the new name and closes the modal
#[test]
fn enter_in_workspace_rename_commits_new_name() {
    use crate::WorkspaceNavPort;
    let mut app = app_with_two_workspaces();
    app.modal.workspace_rename = Some(crate::WorkspaceRenameState {
        ws_index: 0,
        input: crate::InputLine::with_text("Committed".to_string()),
    });

    app.complete_workspace_rename();

    assert_eq!(app.ws.workspaces[0].name, "Committed");
    assert!(app.modal.workspace_rename.is_none());
}

// UC-2 BR-4: Escape cancels and closes the modal without renaming
#[test]
fn escape_in_workspace_rename_cancels() {
    let mut app = app_with_two_workspaces();
    let original = app.ws.workspaces[0].name.clone();
    app.modal.workspace_rename = Some(crate::WorkspaceRenameState {
        ws_index: 0,
        input: crate::InputLine::with_text("Should Not Apply".to_string()),
    });

    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        crate::tide_core::Key::Escape,
        crate::tide_core::Modifiers::default(),
        None,
    );

    assert_eq!(app.ws.workspaces[0].name, original);
    assert!(app.modal.workspace_rename.is_none());
}

// UC-2 BR-5: empty commit leaves the name unchanged
#[test]
fn empty_commit_in_workspace_rename_leaves_name_unchanged() {
    use crate::WorkspaceNavPort;
    let mut app = app_with_two_workspaces();
    let original = app.ws.workspaces[0].name.clone();
    app.modal.workspace_rename = Some(crate::WorkspaceRenameState {
        ws_index: 0,
        input: crate::InputLine::with_text("   ".to_string()),
    });

    app.complete_workspace_rename();

    assert_eq!(app.ws.workspaces[0].name, original);
    assert!(app.modal.workspace_rename.is_none());
}
