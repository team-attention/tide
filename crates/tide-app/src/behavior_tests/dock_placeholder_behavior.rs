// Spec: docs/specs/dock-placeholder.md
use crate::pane::{PaneKind, TerminalPane};
use crate::state::FocusArea;
use crate::pane::editor::EditorPane;
use crate::App;
use crate::DockPort;
use tide_core::LayoutEngine;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

/// Create an App with a real TerminalPane in Stage (spawns PTY).
fn app_with_real_terminal() -> (App, u64) {
    let mut app = test_app();
    let (layout, tid) = tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let tp = TerminalPane::with_cwd(tid, 80, 24, None, true).unwrap();
    app.panes.insert(tid, PaneKind::Terminal(tp));
    app.focus.focused = Some(tid);
    app.focus.stage_focused = Some(tid);
    app.focus.focus_area = FocusArea::Stage;
    (app, tid)
}

/// Create an App with two real TerminalPanes in Stage.
fn app_with_two_real_terminals() -> (App, u64, u64) {
    let (mut app, t1) = app_with_real_terminal();
    let t2 = app.layout.split(t1, tide_core::SplitDirection::Vertical);
    let tp2 = TerminalPane::with_cwd(t2, 80, 24, None, true).unwrap();
    app.panes.insert(t2, PaneKind::Terminal(tp2));
    (app, t1, t2)
}

// --- UC-1: PlaceholderOnTerminalSwitch ---

#[test]
// UC-1 BR-1: Only create Launcher if dock_layout is empty
fn dock_placeholder_created_on_terminal_switch_when_dock_empty() {
    let (mut app, t1, t2) = app_with_two_real_terminals();

    // t1 has an editor in dock
    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.focus.focused = Some(t1);
    app.add_pane_to_dock(e1);
    assert!(app.dock.dock_open);

    // Switch to t2 (dock is open, t2 has empty dock_layout)
    app.focus_terminal(t2);

    // t2's dock_layout should now have a placeholder Launcher
    if let Some(PaneKind::Terminal(tp)) = app.panes.get(&t2) {
        let dock_ids = tp.dock_layout.all_pane_ids();
        assert_eq!(dock_ids.len(), 1, "placeholder Launcher should be created");
        let placeholder_id = dock_ids[0];
        assert!(matches!(app.panes.get(&placeholder_id), Some(PaneKind::Launcher(_))),
            "placeholder should be a Launcher");
    } else {
        panic!("t2 should be a Terminal");
    }
}

#[test]
// UC-1 BR-2: Do not create placeholder if dock_layout already has panes
fn dock_placeholder_not_created_when_dock_has_panes() {
    let (mut app, t1, t2) = app_with_two_real_terminals();

    // Both terminals have editors in dock
    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.focus.focused = Some(t1);
    app.add_pane_to_dock(e1);

    let e2 = app.layout.alloc_id();
    app.panes.insert(e2, PaneKind::Editor(EditorPane::new_empty(e2)));
    app.focus.focused = Some(t2);
    app.focus.stage_focused = Some(t2);
    app.add_pane_to_dock(e2);

    // Switch to t1 (dock is open, t1 already has e1)
    app.focus_terminal(t1);

    if let Some(PaneKind::Terminal(tp)) = app.panes.get(&t1) {
        let dock_ids = tp.dock_layout.all_pane_ids();
        assert_eq!(dock_ids.len(), 1, "should only have the original editor, no extra Launcher");
        assert_eq!(dock_ids[0], e1);
    } else {
        panic!("t1 should be a Terminal");
    }
}

// --- UC-2: ReplacePlaceholderOnOpen ---

#[test]
// UC-2 BR-1: Replace Launcher when opening a file into Dock
fn open_file_replaces_dock_placeholder_launcher() {
    let (mut app, t1, t2) = app_with_two_real_terminals();

    // t1 has editor, dock is open
    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.focus.focused = Some(t1);
    app.add_pane_to_dock(e1);

    // Switch to t2 → placeholder Launcher created
    app.focus_terminal(t2);
    let placeholder_id = if let Some(PaneKind::Terminal(tp)) = app.panes.get(&t2) {
        tp.dock_focused.unwrap()
    } else { panic!("t2 should be a Terminal") };
    assert!(matches!(app.panes.get(&placeholder_id), Some(PaneKind::Launcher(_))));

    // Now open an editor — should replace the placeholder
    let e2 = app.layout.alloc_id();
    let editor = EditorPane::new_empty(e2);
    app.panes.insert(e2, PaneKind::Editor(editor));
    app.ime.pending_creates.push(e2);
    app.add_pane_to_dock(e2);

    // Placeholder should be gone, editor should be in its place
    assert!(!app.panes.contains_key(&placeholder_id), "placeholder Launcher should be removed");
    if let Some(PaneKind::Terminal(tp)) = app.panes.get(&t2) {
        let dock_ids = tp.dock_layout.all_pane_ids();
        assert_eq!(dock_ids.len(), 1, "should only have the new editor");
        assert_eq!(dock_ids[0], e2);
        assert_eq!(tp.dock_focused, Some(e2));
    } else {
        panic!("t2 should be a Terminal");
    }
}

#[test]
// UC-2 BR-1: When dock_focused is NOT a Launcher, add as normal tab
fn open_file_adds_tab_when_dock_focused_is_not_launcher() {
    let (mut app, t1) = app_with_real_terminal();

    // t1 has an editor in dock
    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.focus.focused = Some(t1);
    app.add_pane_to_dock(e1);

    // Open another editor — should add as tab, not replace
    let e2 = app.layout.alloc_id();
    let editor = EditorPane::new_empty(e2);
    app.panes.insert(e2, PaneKind::Editor(editor));
    app.add_pane_to_dock(e2);

    if let Some(PaneKind::Terminal(tp)) = app.panes.get(&t1) {
        let dock_ids = tp.dock_layout.all_pane_ids();
        assert_eq!(dock_ids.len(), 2, "both editors should be in dock");
        assert!(dock_ids.contains(&e1));
        assert!(dock_ids.contains(&e2));
    } else {
        panic!("t1 should be a Terminal");
    }
}

// --- UC-3: PlaceholderNotDuplicated ---

#[test]
// UC-3 BR-1: Switching back and forth does not create duplicate placeholders
fn switching_back_does_not_duplicate_placeholder() {
    let (mut app, t1, t2) = app_with_two_real_terminals();

    // t1 has editor, dock open
    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.focus.focused = Some(t1);
    app.add_pane_to_dock(e1);

    // Switch to t2 → placeholder created
    app.focus_terminal(t2);
    let placeholder_count_1 = if let Some(PaneKind::Terminal(tp)) = app.panes.get(&t2) {
        tp.dock_layout.all_pane_ids().len()
    } else { 0 };
    assert_eq!(placeholder_count_1, 1);

    // Switch to t1
    app.focus_terminal(t1);

    // Switch back to t2 — should NOT create another placeholder
    app.focus_terminal(t2);
    if let Some(PaneKind::Terminal(tp)) = app.panes.get(&t2) {
        let dock_ids = tp.dock_layout.all_pane_ids();
        assert_eq!(dock_ids.len(), 1, "should still have exactly one placeholder, not two");
    } else {
        panic!("t2 should be a Terminal");
    }
}

#[test]
// Cmd+4 close then reopen does not create extra placeholder
fn toggle_dock_close_reopen_no_duplicate_placeholder() {
    let (mut app, t1, t2) = app_with_two_real_terminals();

    // t1 has editor, dock open
    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.focus.focused = Some(t1);
    app.add_pane_to_dock(e1);

    // Switch to t2 → placeholder created
    app.focus_terminal(t2);
    assert!(app.dock.dock_open);

    // Cmd+4 while Stage focused → focuses Dock (placeholder Launcher)
    app.toggle_dock();
    assert!(app.dock.dock_open);
    assert_eq!(app.focus.focus_area, FocusArea::Dock);

    // Cmd+4 again while Dock focused → closes Dock
    app.toggle_dock();
    assert!(!app.dock.dock_open);
    assert_eq!(app.focus.focus_area, FocusArea::Stage);

    // Cmd+4 to reopen — placeholder still there, no new one
    app.toggle_dock();
    assert!(app.dock.dock_open);

    if let Some(PaneKind::Terminal(tp)) = app.panes.get(&t2) {
        let dock_ids = tp.dock_layout.all_pane_ids();
        assert_eq!(dock_ids.len(), 1, "still one placeholder, not two");
        assert!(matches!(app.panes.get(&dock_ids[0]), Some(PaneKind::Launcher(_))));
    } else {
        panic!("t2 should be a Terminal");
    }
}
