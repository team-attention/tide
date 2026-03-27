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

// --- UC-5: DisplayWorkspaceTerminalSummaries ---

use crate::pane::TerminalContext;
use crate::tide_terminal::git::GitInfo;
use crate::tide_terminal::git::GitStatus;
use crate::adapter::outward::view::chrome::titlebar::collect_workspace_terminal_summaries;
use crate::tide_core::LayoutEngine;
use std::path::PathBuf;

/// Helper: create an app with a real terminal and set its TerminalContext.
fn app_with_terminal_context(cwd: Option<PathBuf>, git_info: Option<GitInfo>) -> (App, u64) {
    let mut app = test_app();
    let (layout, tid) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let mut tp = crate::pane::TerminalPane::with_cwd(tid, 80, 24, None, true).unwrap();
    tp.context = TerminalContext {
        cwd,
        git_info,
        ..TerminalContext::default()
    };
    app.panes.insert(tid, PaneKind::Terminal(tp));
    app.focus.focused = Some(tid);
    app.focus.stage_focused = Some(tid);
    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: SplitLayout::new(),
        focused: None,
        panes: HashMap::new(),
    });
    app.ws.active = 0;
    (app, tid)
}

#[test]
fn workspace_sidebar_shows_terminal_cwd_basename() {
    // UC-5 BR-13: Each workspace item shows CWD basename of its Stage terminals
    let (app, _tid) = app_with_terminal_context(
        Some(PathBuf::from("/Users/test/Workspace/tide")),
        None,
    );
    let summaries = collect_workspace_terminal_summaries(&app.panes, &app.layout);
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].basename, "tide");
}

#[test]
fn workspace_sidebar_shows_git_branch_when_available() {
    // UC-5 BR-14: If TerminalContext.git_info is Some, git branch is shown
    let (app, _tid) = app_with_terminal_context(
        Some(PathBuf::from("/Users/test/project")),
        Some(GitInfo {
            branch: "main".into(),
            status: GitStatus::default(),
        }),
    );
    let summaries = collect_workspace_terminal_summaries(&app.panes, &app.layout);
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].basename, "project");
    assert_eq!(summaries[0].branch.as_deref(), Some("main"));
}

#[test]
fn workspace_sidebar_hides_branch_when_not_git_repo() {
    // UC-5 BR-15: If TerminalContext.git_info is None, only basename is shown
    let (app, _tid) = app_with_terminal_context(
        Some(PathBuf::from("/Users/test/scripts")),
        None,
    );
    let summaries = collect_workspace_terminal_summaries(&app.panes, &app.layout);
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].basename, "scripts");
    assert!(summaries[0].branch.is_none());
}

#[test]
fn workspace_sidebar_shows_overflow_when_three_or_more_terminals() {
    // UC-5 BR-16: First 2 terminals shown; 3+ terminals results in overflow
    let mut app = test_app();
    let (layout, t1) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let mut tp1 = crate::pane::TerminalPane::with_cwd(t1, 80, 24, None, true).unwrap();
    tp1.context.cwd = Some(PathBuf::from("/a/proj1"));
    app.panes.insert(t1, PaneKind::Terminal(tp1));

    let t2 = app.layout.split(t1, crate::tide_core::SplitDirection::Vertical);
    let mut tp2 = crate::pane::TerminalPane::with_cwd(t2, 80, 24, None, true).unwrap();
    tp2.context.cwd = Some(PathBuf::from("/a/proj2"));
    app.panes.insert(t2, PaneKind::Terminal(tp2));

    let t3 = app.layout.split(t2, crate::tide_core::SplitDirection::Vertical);
    let mut tp3 = crate::pane::TerminalPane::with_cwd(t3, 80, 24, None, true).unwrap();
    tp3.context.cwd = Some(PathBuf::from("/a/proj3"));
    app.panes.insert(t3, PaneKind::Terminal(tp3));

    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: SplitLayout::new(),
        focused: None,
        panes: HashMap::new(),
    });
    app.ws.active = 0;

    let summaries = collect_workspace_terminal_summaries(&app.panes, &app.layout);
    // 3 terminals exist — all returned, caller decides how to render overflow
    assert_eq!(summaries.len(), 3);
}

#[test]
fn workspace_sidebar_skips_terminals_without_cwd() {
    // UC-5 BR-17: Terminals with cwd=None are skipped
    let (app, _tid) = app_with_terminal_context(None, None);
    let summaries = collect_workspace_terminal_summaries(&app.panes, &app.layout);
    assert_eq!(summaries.len(), 0);
}

#[test]
fn inactive_workspace_sidebar_reads_from_cold_storage() {
    // UC-5 BR-18: Inactive workspace reads from cold-stored Workspace.panes
    let mut app = test_app();

    // Create WS1 with a terminal that has cwd+git
    let (layout1, t1) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout1;
    let mut tp1 = crate::pane::TerminalPane::with_cwd(t1, 80, 24, None, true).unwrap();
    tp1.context = TerminalContext {
        cwd: Some(PathBuf::from("/Users/test/tide")),
        git_info: Some(GitInfo {
            branch: "main".into(),
            status: GitStatus::default(),
        }),
        ..TerminalContext::default()
    };
    app.panes.insert(t1, PaneKind::Terminal(tp1));
    app.focus.focused = Some(t1);

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
    app.ws.active = 0;

    // Save WS1 into cold storage, switch to WS2
    app.save_active_workspace();
    app.ws.active = 1;
    let (layout2, t2) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout2;
    let tp2 = crate::pane::TerminalPane::with_cwd(t2, 80, 24, None, true).unwrap();
    app.panes.insert(t2, PaneKind::Terminal(tp2));
    app.focus.focused = Some(t2);

    // Read summaries from inactive WS1 (cold storage)
    let ws1 = &app.ws.workspaces[0];
    let summaries = collect_workspace_terminal_summaries(&ws1.panes, &ws1.layout);
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].basename, "tide");
    assert_eq!(summaries[0].branch.as_deref(), Some("main"));
}
