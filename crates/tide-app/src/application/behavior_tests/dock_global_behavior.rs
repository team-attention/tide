// Spec: docs/specs/dock-global.md
use crate::pane::{PaneKind, TerminalPane};
use crate::pane::editor::EditorPane;
use crate::state::FocusArea;
use crate::App;
use crate::DockPort;
use crate::tide_core::LayoutEngine;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_real_terminal() -> (App, u64) {
    let mut app = test_app();
    let (layout, tid) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let tp = TerminalPane::with_cwd(tid, 80, 24, None, true).unwrap();
    app.panes.insert(tid, PaneKind::Terminal(tp));
    app.focus.focused = Some(tid);
    app.focus.stage_focused = Some(tid);
    app.focus.focus_area = FocusArea::Stage;
    (app, tid)
}

fn app_with_two_real_terminals() -> (App, u64, u64) {
    let (mut app, t1) = app_with_real_terminal();
    let t2 = app.layout.split(t1, crate::tide_core::SplitDirection::Vertical);
    let tp2 = TerminalPane::with_cwd(t2, 80, 24, None, true).unwrap();
    app.panes.insert(t2, PaneKind::Terminal(tp2));
    (app, t1, t2)
}

// --- UC-1: GlobalDockWidth ---

#[test]
fn dock_width_is_global_not_per_terminal() {
    // UC-1 BR-1: Dock width is stored only in App.dock_width
    let (mut app, t1, t2) = app_with_two_real_terminals();
    app.dock.dock_width = 500.0;
    app.dock.dock_open = true;

    // Focus t2 — dock_width should still be 500
    app.focus.focused = Some(t2);
    app.swap_dock_state(t2);
    assert_eq!(app.dock.dock_width, 500.0);

    // Focus t1 — still 500
    app.focus.focused = Some(t1);
    app.swap_dock_state(t1);
    assert_eq!(app.dock.dock_width, 500.0);
}

#[test]
fn switching_terminals_preserves_dock_width() {
    // UC-1 BR-2: Switching terminals does not change dock width
    let (mut app, t1, t2) = app_with_two_real_terminals();

    // Add editor to t1's dock so dock stays open
    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.focus.focused = Some(t1);
    app.add_pane_to_dock(e1);

    app.dock.dock_width = 600.0;

    // Switch to t2
    app.focus.focused = Some(t2);
    app.swap_dock_state(t2);

    assert_eq!(app.dock.dock_width, 600.0, "dock width must persist across terminal switch");
}

// --- UC-2: PinPane ---

#[test]
fn pinning_moves_pane_to_pinned_dock_layout() {
    // UC-2 BR-1: Pin moves pane from terminal dock_layout to pinned_dock_layout
    let (mut app, t1, _t2) = app_with_two_real_terminals();
    app.focus.focused = Some(t1);

    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.add_pane_to_dock(e1);

    app.focus.focused = Some(e1);
    app.toggle_dock_pin();

    // e1 should be in pinned_dock_layout
    assert!(app.is_pane_pinned(e1));
    // e1 should NOT be in t1's dock_layout (single existence)
    if let Some(PaneKind::Terminal(tp)) = app.panes.get(&t1) {
        assert!(!tp.dock_layout.all_pane_ids().contains(&e1));
    }
}

#[test]
fn pinning_preserves_associated_terminal() {
    // UC-2 BR-2: associated_terminal preserved for unpin routing
    let (mut app, t1, _t2) = app_with_two_real_terminals();
    app.focus.focused = Some(t1);

    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.add_pane_to_dock(e1);

    assert_eq!(app.assoc.associated_terminal.get(&e1), Some(&t1));

    app.focus.focused = Some(e1);
    app.toggle_dock_pin();

    assert_eq!(app.assoc.associated_terminal.get(&e1), Some(&t1),
        "pinning must preserve associated_terminal for unpin");
}

#[test]
fn pinned_panes_in_pinned_dock_layout() {
    // UC-2 BR-3: Multiple pinned panes coexist in pinned_dock_layout
    let (mut app, t1, _t2) = app_with_two_real_terminals();
    app.focus.focused = Some(t1);

    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.add_pane_to_dock(e1);

    let e2 = app.layout.alloc_id();
    app.panes.insert(e2, PaneKind::Editor(EditorPane::new_empty(e2)));
    app.add_pane_to_dock(e2);

    app.focus.focused = Some(e1);
    app.toggle_dock_pin();
    app.focus.focused = Some(e2);
    app.toggle_dock_pin();

    let pinned = app.dock.pinned_dock_layout.all_pane_ids();
    assert!(pinned.contains(&e1));
    assert!(pinned.contains(&e2));
}

// --- UC-3: ViewPinnedFromOtherTerminal ---

#[test]
fn pinned_pane_visible_from_any_terminal() {
    // UC-3: Pinned panes are always visible (they're in pinned_dock_layout)
    let (mut app, t1, t2) = app_with_two_real_terminals();
    app.focus.focused = Some(t1);

    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.add_pane_to_dock(e1);

    app.focus.focused = Some(e1);
    app.toggle_dock_pin();

    // Switch to t2 — e1 is still in pinned_dock_layout
    app.focus.focused = Some(t2);
    app.swap_dock_state(t2);

    assert!(app.is_pane_pinned(e1), "pinned pane should be visible from any terminal");
    assert!(app.has_pinned_panes());
}

#[test]
fn focused_terminal_not_changed_by_pinned_pane_focus() {
    // Focusing a pinned pane should not change focused_terminal_id
    let (mut app, t1, t2) = app_with_two_real_terminals();
    app.focus.focused = Some(t1);

    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.add_pane_to_dock(e1);

    app.focus.focused = Some(e1);
    app.toggle_dock_pin();

    // Focus t2 in Stage
    app.focus.focused = Some(t2);
    app.focus.stage_focused = Some(t2);
    assert_eq!(app.focused_terminal_id(), Some(t2));

    // Now focus the pinned pane — stage_focused should still be t2
    app.focus.focused = Some(e1);
    assert_eq!(app.focused_terminal_id(), Some(t2),
        "focusing pinned pane must not change stage_focused");
}

// --- UC-4: UnpinPane ---

#[test]
fn unpinned_pane_returns_to_owning_terminal_dock() {
    // UC-4 BR-1: Unpin moves pane from pinned_dock_layout back to associated terminal
    let (mut app, t1, _t2) = app_with_two_real_terminals();
    app.focus.focused = Some(t1);

    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.add_pane_to_dock(e1);

    // Pin
    app.focus.focused = Some(e1);
    app.toggle_dock_pin();
    assert!(app.is_pane_pinned(e1));

    // Re-focus pinned pane then unpin
    app.focus.focused = Some(e1);
    app.toggle_dock_pin();
    assert!(!app.is_pane_pinned(e1));

    // Should be back in t1's dock_layout
    if let Some(PaneKind::Terminal(tp)) = app.panes.get(&t1) {
        assert!(tp.dock_layout.all_pane_ids().contains(&e1));
    }
}

#[test]
fn unpinned_pane_not_in_pinned_dock_layout() {
    // UC-4 BR-2: After unpin, pane is not in pinned_dock_layout
    let (mut app, t1, _t2) = app_with_two_real_terminals();
    app.focus.focused = Some(t1);

    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.add_pane_to_dock(e1);

    app.focus.focused = Some(e1);
    app.toggle_dock_pin();
    // Re-focus pinned pane then unpin
    app.focus.focused = Some(e1);
    app.toggle_dock_pin();

    assert!(!app.is_pane_pinned(e1));
    assert!(!app.has_pinned_panes());
}

// --- UC-6: PlaceholderLogic ---

#[test]
fn no_placeholder_when_pinned_panes_exist() {
    // UC-6 BR-1: Pinned panes prevent placeholder creation
    let (mut app, t1, t2) = app_with_two_real_terminals();
    app.focus.focused = Some(t1);

    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.add_pane_to_dock(e1);

    // Pin e1
    app.focus.focused = Some(e1);
    app.toggle_dock_pin();

    // Switch to t2 (which has no dock panes)
    app.focus.focused = Some(t2);
    app.dock.dock_open = true;
    app.swap_dock_state(t2);

    // Dock should remain open (pinned content exists)
    assert!(app.dock.dock_open, "dock should stay open when pinned panes exist");
}

#[test]
fn placeholder_when_no_dock_panes_and_no_pinned() {
    // UC-6 BR-2: Placeholder only when both terminal dock and pinned group empty
    let (mut app, t1, _t2) = app_with_two_real_terminals();
    app.focus.focused = Some(t1);
    app.dock.dock_open = true;
    assert!(!app.has_pinned_panes());

    app.ensure_dock_placeholder();

    // Should have created a placeholder
    if let Some(PaneKind::Terminal(tp)) = app.panes.get(&t1) {
        let dock_panes = tp.dock_layout.all_pane_ids();
        assert!(!dock_panes.is_empty(), "placeholder should exist when no pinned panes");
        let has_launcher = dock_panes.iter().any(|&id|
            matches!(app.panes.get(&id), Some(PaneKind::Launcher(_)))
        );
        assert!(has_launcher, "placeholder should be a Launcher");
    }
}

// --- UC-5: DragTogglePin ---

#[test]
fn drag_into_pinned_group_pins_pane() {
    // UC-5 BR-1: Dropping a pane onto pinned group pins it
    use crate::state::drag_types::DropDestination;

    let (mut app, t1, _t2) = app_with_two_real_terminals();
    app.focus.focused = Some(t1);

    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.add_pane_to_dock(e1);

    assert!(!app.is_pane_pinned(e1));

    app.handle_drop(e1, DropDestination::PinnedGroup);

    assert!(app.is_pane_pinned(e1), "pane should be pinned after drop");
}

#[test]
fn drag_out_of_pinned_group_unpins_pane() {
    // UC-5 BR-2: Dropping a pinned pane onto dock root unpins it
    use crate::state::drag_types::DropDestination;

    let (mut app, t1, _t2) = app_with_two_real_terminals();
    app.focus.focused = Some(t1);

    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.add_pane_to_dock(e1);

    // Pin
    app.focus.focused = Some(e1);
    app.toggle_dock_pin();
    assert!(app.is_pane_pinned(e1));

    // Drop onto dock root = unpin
    app.handle_drop(e1, DropDestination::DockRoot(crate::tide_core::DropZone::Right));

    assert!(!app.is_pane_pinned(e1), "pane should be unpinned after drop out");
}

// --- Pin keeps focused on the pane ---

#[test]
fn pin_keeps_focused_on_pane() {
    // After pinning, self.focus.focused stays on the pane (it moved to pinned_dock_layout)
    let (mut app, t1, _t2) = app_with_two_real_terminals();
    app.focus.stage_focused = Some(t1);
    app.focus.focused = Some(t1);

    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.add_pane_to_dock(e1);

    app.focus.focused = Some(e1);
    app.toggle_dock_pin();

    // focused stays on e1 (now in pinned_dock_layout)
    assert_eq!(app.focus.focused, Some(e1));
    assert!(app.is_pane_pinned(e1));
    // stage_focused unchanged
    assert_eq!(app.focus.stage_focused, Some(t1));
}
