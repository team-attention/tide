// Spec: docs/specs/modifier-keybinding-redesign.md
//
// These tests are written ahead of implementation (spec-first, test-first).
// They reference NEW GlobalAction variants that do not yet exist:
//   DockNavigate(Direction), DockSplitVertical, DockSplitHorizontal,
//   DockNewTab, DockTabPrev, DockTabNext
// They also reference REMOVED variants that still exist in the current code:
//   BrowserBack, BrowserForward, ToggleZoom, SplitHorizontalHere, SplitVerticalHere
//
// Expected: these tests will NOT compile until the implementation is done.

use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::tide_core::{Key, LayoutEngine, Modifiers, SplitDirection};
use crate::tide_input::{Direction, GlobalAction, KeybindingMap};
use crate::ActionPort;
use crate::App;
use crate::DockPort;
use crate::WorkspaceNavPort;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_editor() -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes
        .insert(id, PaneKind::Editor(EditorPane::new_empty(id)));
    app.focus.focused = Some(id);
    app.focus.stage_focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

fn app_with_two_stage_panes() -> (App, u64, u64) {
    let (mut app, p1) = app_with_editor();
    let p2 = app.layout.split(p1, SplitDirection::Vertical);
    app.panes
        .insert(p2, PaneKind::Editor(EditorPane::new_empty(p2)));
    (app, p1, p2)
}

/// Helper: add a pane to a terminal's dock.
/// For Launcher panes (test fixtures without real PTY), manually set dock state.
fn add_to_dock(app: &mut App, terminal_id: u64, pane_id: u64) {
    app.focus.focused = Some(terminal_id);
    app.add_pane_to_dock(pane_id, None);
    if matches!(app.panes.get(&terminal_id), Some(PaneKind::Launcher(_))) {
        app.dock.dock_open = true;
        app.assoc.associated_terminal.insert(pane_id, terminal_id);
    }
}

// ──────────────────────────────────────────────
// --- UC-1: Navigate Within Current FocusArea ---
// ──────────────────────────────────────────────

#[test]
fn navigate_in_stage_does_not_change_focus_area() {
    // UC-1 BR-1: Navigate(Direction) MUST NOT change FocusArea.
    let (mut app, p1, _p2) = app_with_two_stage_panes();
    app.focus.focused = Some(p1);
    app.focus.focus_area = FocusArea::Stage;

    app.handle_global_action(GlobalAction::Navigate(Direction::Right));

    assert_eq!(
        app.focus.focus_area,
        FocusArea::Stage,
        "Navigate in Stage must not change FocusArea"
    );
}

#[test]
fn navigate_in_dock_does_not_change_focus_area() {
    // UC-1 BR-1: Navigate(Direction) MUST NOT change FocusArea when in Dock.
    // Currently broken: handle_navigate forces focus back to Stage when Dock is focused.
    let (mut app, p1, _p2) = app_with_two_stage_panes();

    // Set up dock with two panes so spatial navigation is possible
    let dock_p1 = app.layout.alloc_id();
    app.panes
        .insert(dock_p1, PaneKind::Editor(EditorPane::new_empty(dock_p1)));
    add_to_dock(&mut app, p1, dock_p1);

    let dock_p2 = app.layout.alloc_id();
    app.panes
        .insert(dock_p2, PaneKind::Editor(EditorPane::new_empty(dock_p2)));
    add_to_dock(&mut app, p1, dock_p2);

    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(dock_p1);

    app.handle_global_action(GlobalAction::Navigate(Direction::Right));

    assert_eq!(
        app.focus.focus_area,
        FocusArea::Dock,
        "Navigate in Dock must NOT change FocusArea to Stage (area confinement)"
    );
}

#[test]
fn navigate_in_dock_uses_dock_layout_for_spatial_lookup() {
    // UC-1 BR-2: When FocusArea is Dock, Navigate uses the dock's SplitLayout
    // for spatial neighbor lookup, not the Stage layout.
    let (mut app, p1, _p2) = app_with_two_stage_panes();

    // Add two dock panes split vertically
    let dock_p1 = app.layout.alloc_id();
    app.panes
        .insert(dock_p1, PaneKind::Editor(EditorPane::new_empty(dock_p1)));
    add_to_dock(&mut app, p1, dock_p1);

    let dock_p2 = app.layout.alloc_id();
    app.panes
        .insert(dock_p2, PaneKind::Editor(EditorPane::new_empty(dock_p2)));
    add_to_dock(&mut app, p1, dock_p2);

    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(dock_p1);

    app.handle_global_action(GlobalAction::Navigate(Direction::Right));

    // After navigation, focus should still be on a dock pane (not a stage pane)
    let focused = app.focus.focused.unwrap();
    let is_dock_pane = focused == dock_p1 || focused == dock_p2;
    assert!(
        is_dock_pane,
        "Navigate in Dock should move focus to another dock pane, not a stage pane"
    );
}

#[test]
fn navigate_in_zoomed_stage_cycles_stacked_panes() {
    // UC-1 BR-3: When Stage is in stacked/zoomed mode, Navigate Left/Right
    // cycles through stacked panes (existing behavior preserved).
    let (mut app, p1, p2) = app_with_two_stage_panes();
    app.focus.focused = Some(p1);
    app.focus.focus_area = FocusArea::Stage;

    // Enter zoomed/stacked mode
    app.handle_toggle_stacked();
    assert!(app.focus.zoomed_pane.is_some());

    // Navigate right should cycle to the next pane
    app.handle_global_action(GlobalAction::Navigate(Direction::Right));
    assert_eq!(
        app.focus.focused,
        Some(p2),
        "Navigate Right in zoomed mode should cycle to next pane"
    );

    // Navigate left should cycle back
    app.handle_global_action(GlobalAction::Navigate(Direction::Left));
    assert_eq!(
        app.focus.focused,
        Some(p1),
        "Navigate Left in zoomed mode should cycle back"
    );
}

// ──────────────────────────────────────────────────
// --- UC-2: Cross-Area Dock Navigation ---
// ──────────────────────────────────────────────────

#[test]
fn dock_navigate_does_not_change_focus_area() {
    // UC-2 BR-1: DockNavigate MUST NOT change FocusArea, even though it operates on Dock.
    let (mut app, p1, _p2) = app_with_two_stage_panes();

    let dock_p1 = app.layout.alloc_id();
    app.panes
        .insert(dock_p1, PaneKind::Editor(EditorPane::new_empty(dock_p1)));
    add_to_dock(&mut app, p1, dock_p1);

    let dock_p2 = app.layout.alloc_id();
    app.panes
        .insert(dock_p2, PaneKind::Editor(EditorPane::new_empty(dock_p2)));
    add_to_dock(&mut app, p1, dock_p2);

    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(p1);

    app.handle_global_action(GlobalAction::DockNavigate(Direction::Right));

    assert_eq!(
        app.focus.focus_area,
        FocusArea::Stage,
        "DockNavigate must not change FocusArea"
    );
}

#[test]
fn dock_navigate_when_dock_focused_behaves_like_navigate() {
    // UC-2 BR-2: When FocusArea is already Dock, DockNavigate behaves identically
    // to Navigate — both target Dock.
    let (mut app, p1, _p2) = app_with_two_stage_panes();

    let dock_p1 = app.layout.alloc_id();
    app.panes
        .insert(dock_p1, PaneKind::Editor(EditorPane::new_empty(dock_p1)));
    add_to_dock(&mut app, p1, dock_p1);

    let dock_p2 = app.layout.alloc_id();
    app.panes
        .insert(dock_p2, PaneKind::Editor(EditorPane::new_empty(dock_p2)));
    add_to_dock(&mut app, p1, dock_p2);

    // Focus is already in Dock
    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(dock_p1);

    app.handle_global_action(GlobalAction::DockNavigate(Direction::Right));

    assert_eq!(
        app.focus.focus_area,
        FocusArea::Dock,
        "DockNavigate when Dock focused should stay in Dock"
    );
}

#[test]
fn dock_navigate_when_dock_closed_is_noop() {
    // UC-2 BR-3: If Dock is not open/visible, DockNavigate is a no-op.
    let (mut app, p1, _p2) = app_with_two_stage_panes();
    app.dock.dock_open = false;
    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(p1);

    let focused_before = app.focus.focused;
    app.handle_global_action(GlobalAction::DockNavigate(Direction::Right));

    assert_eq!(
        app.focus.focused, focused_before,
        "DockNavigate when dock closed should be no-op"
    );
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
}

// ─────────────────────────────────────────────────
// --- UC-3: Tab Cycling in Stage ---
// ─────────────────────────────────────────────────

#[test]
fn tab_prev_next_in_stage_cycles_within_tab_group() {
    // UC-3 BR-1: TabPrev/TabNext cycle within the current TabGroup only.
    let (mut app, p1) = app_with_editor();
    // Add a second tab to the same TabGroup
    let p2 = app.layout.alloc_id();
    app.layout.add_tab(p1, p2);
    app.panes
        .insert(p2, PaneKind::Editor(EditorPane::new_empty(p2)));

    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(p1);

    app.handle_global_action(GlobalAction::TabNext);

    assert_eq!(
        app.focus.focused,
        Some(p2),
        "TabNext should cycle to next tab in the same TabGroup"
    );
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
}

#[test]
fn tab_prev_next_in_dock_cycles_dock_tabs() {
    // UC-3 BR-2: When FocusArea is Dock, TabPrev/TabNext cycle through Dock tabs
    // (pinned + terminal dock tabs) — the current cycle_tab() behavior.
    let (mut app, p1, _p2) = app_with_two_stage_panes();

    let dock_p1 = app.layout.alloc_id();
    app.panes
        .insert(dock_p1, PaneKind::Editor(EditorPane::new_empty(dock_p1)));
    add_to_dock(&mut app, p1, dock_p1);

    let dock_p2 = app.layout.alloc_id();
    app.panes
        .insert(dock_p2, PaneKind::Editor(EditorPane::new_empty(dock_p2)));
    add_to_dock(&mut app, p1, dock_p2);

    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(dock_p1);

    app.handle_global_action(GlobalAction::TabNext);

    assert_eq!(
        app.focus.focus_area,
        FocusArea::Dock,
        "TabNext in Dock should keep FocusArea as Dock"
    );
    // Focus should have moved to another dock pane
    let focused = app.focus.focused.unwrap();
    assert!(
        focused == dock_p1 || focused == dock_p2,
        "TabNext in Dock should cycle between dock tabs"
    );
}

#[test]
fn tab_cycling_wraps_around_within_tab_group() {
    // UC-3 BR-3: Cycling past the last tab wraps to the first within the TabGroup.
    let (mut app, p1) = app_with_editor();
    let p2 = app.layout.alloc_id();
    app.layout.add_tab(p1, p2);
    app.panes
        .insert(p2, PaneKind::Editor(EditorPane::new_empty(p2)));

    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(p2);

    // TabNext from last tab wraps to first
    app.handle_global_action(GlobalAction::TabNext);
    assert_eq!(
        app.focus.focused,
        Some(p1),
        "TabNext from last tab should wrap to first"
    );

    // TabPrev from first tab wraps to last
    app.handle_global_action(GlobalAction::TabPrev);
    assert_eq!(
        app.focus.focused,
        Some(p2),
        "TabPrev from first tab should wrap to last"
    );
}

#[test]
fn tab_cycling_into_tab_group_sets_active_tab() {
    // UC-3 BR-4: When cycling into a TabGroup, the target pane becomes the active tab
    // of that group.
    let (mut app, p1, p2) = app_with_two_stage_panes();

    // Create a TabGroup [p1, p3] where p3 is active
    let p3 = app.layout.alloc_id();
    app.panes
        .insert(p3, PaneKind::Editor(EditorPane::new_empty(p3)));
    app.layout.add_tab(p1, p3);

    // Focus is on p2 (separate leaf). Cycle into the TabGroup.
    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(p2);

    app.handle_global_action(GlobalAction::TabNext);

    let focused = app.focus.focused.unwrap();
    // Focused pane should be in the TabGroup
    let tg = app.layout.tab_group_containing(p1);
    if let Some(tg) = tg {
        if tg.contains(focused) {
            assert_eq!(
                tg.active_pane(),
                focused,
                "Cycling into a TabGroup must set the target as active tab"
            );
        }
    }
}

// ────────────────────────────────────────────────────
// --- UC-4: Cross-Area Dock Tab Cycling ---
// ────────────────────────────────────────────────────

#[test]
fn dock_tab_next_does_not_change_focus_area() {
    // UC-4 BR-1: DockTabPrev/DockTabNext MUST NOT change FocusArea.
    let (mut app, p1, _p2) = app_with_two_stage_panes();

    let dock_p1 = app.layout.alloc_id();
    app.panes
        .insert(dock_p1, PaneKind::Editor(EditorPane::new_empty(dock_p1)));
    add_to_dock(&mut app, p1, dock_p1);

    let dock_p2 = app.layout.alloc_id();
    app.panes
        .insert(dock_p2, PaneKind::Editor(EditorPane::new_empty(dock_p2)));
    add_to_dock(&mut app, p1, dock_p2);

    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(p1);

    app.handle_global_action(GlobalAction::DockTabNext);

    assert_eq!(
        app.focus.focus_area,
        FocusArea::Stage,
        "DockTabNext must not change FocusArea"
    );
}

#[test]
fn dock_tab_next_opens_dock_if_closed() {
    // UC-4 BR-2: If dock is closed, DockTabPrev/DockTabNext opens it
    // (sets dock_open = true).
    let (mut app, p1, _p2) = app_with_two_stage_panes();

    let dock_p1 = app.layout.alloc_id();
    app.panes
        .insert(dock_p1, PaneKind::Editor(EditorPane::new_empty(dock_p1)));
    add_to_dock(&mut app, p1, dock_p1);

    let dock_p2 = app.layout.alloc_id();
    app.panes
        .insert(dock_p2, PaneKind::Editor(EditorPane::new_empty(dock_p2)));
    add_to_dock(&mut app, p1, dock_p2);

    app.dock.dock_open = false;
    app.focus.focus_area = FocusArea::Stage;

    app.handle_global_action(GlobalAction::DockTabNext);

    assert!(
        app.dock.dock_open,
        "DockTabNext should open the dock if it was closed"
    );
}

// ──────────────────────────────────────────────────
// --- UC-5: Split in Current Area ---
// ──────────────────────────────────────────────────

#[test]
fn split_vertical_in_stage_splits_stage_layout() {
    // UC-5 BR-1: SplitVertical/SplitHorizontal target the current FocusArea.
    // When in Stage they split Stage layout.
    let (mut app, p1) = app_with_editor();
    app.focus.focus_area = FocusArea::Stage;

    let pane_count_before = app.layout.pane_ids().len();
    app.handle_global_action(GlobalAction::SplitVertical);
    let pane_count_after = app.layout.pane_ids().len();

    assert_eq!(
        pane_count_after,
        pane_count_before + 1,
        "SplitVertical in Stage should add a pane to Stage layout"
    );
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
}

#[test]
fn split_vertical_in_dock_splits_dock_layout() {
    // UC-5 BR-1: When in Dock, SplitVertical splits Dock layout.
    let (mut app, p1, _p2) = app_with_two_stage_panes();

    let dock_p1 = app.layout.alloc_id();
    app.panes
        .insert(dock_p1, PaneKind::Editor(EditorPane::new_empty(dock_p1)));
    add_to_dock(&mut app, p1, dock_p1);

    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(dock_p1);

    app.handle_global_action(GlobalAction::SplitVertical);

    // FocusArea should remain Dock
    assert_eq!(
        app.focus.focus_area,
        FocusArea::Dock,
        "SplitVertical in Dock should keep FocusArea as Dock"
    );
}

#[test]
fn cmd_backslash_maps_to_split_horizontal() {
    // Cmd+\ = SplitHorizontal in current area (below).
    let map = KeybindingMap::new();
    let mods = Modifiers {
        shift: false,
        ctrl: false,
        meta: true,
        alt: false,
    };
    let action = map.lookup(&Key::Char('\\'), &mods);
    assert_eq!(
        action,
        Some(GlobalAction::SplitHorizontal),
        "Cmd+\\ should map to SplitHorizontal"
    );
}

#[test]
fn cmd_shift_backslash_maps_to_split_vertical() {
    // Cmd+Shift+\ = SplitVertical in current area (right). Shift flips orientation.
    let map = KeybindingMap::new();
    let mods = Modifiers {
        shift: true,
        ctrl: false,
        meta: true,
        alt: false,
    };
    let action = map.lookup(&Key::Char('\\'), &mods);
    assert_eq!(
        action,
        Some(GlobalAction::SplitVertical),
        "Cmd+Shift+\\ should map to SplitVertical"
    );
}

// ──────────────────────────────────────────────────
// --- UC-6: Cross-Area Dock Split ---
// ──────────────────────────────────────────────────

#[test]
fn dock_split_vertical_always_targets_dock() {
    // UC-6 BR-1: DockSplit variants always target Dock layout regardless of current FocusArea.
    let (mut app, p1, _p2) = app_with_two_stage_panes();

    let dock_p1 = app.layout.alloc_id();
    app.panes
        .insert(dock_p1, PaneKind::Editor(EditorPane::new_empty(dock_p1)));
    add_to_dock(&mut app, p1, dock_p1);

    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(p1);
    app.focus.stage_focused = Some(p1);

    let stage_pane_count_before = app.layout.pane_ids().len();
    app.handle_global_action(GlobalAction::DockSplitVertical);
    let stage_pane_count_after = app.layout.pane_ids().len();

    assert_eq!(
        stage_pane_count_before, stage_pane_count_after,
        "DockSplitVertical should not add panes to Stage layout"
    );
}

#[test]
fn dock_split_moves_focus_to_dock() {
    // DockSplit creates a Launcher that needs interaction, so focus moves to Dock.
    let (mut app, p1, _p2) = app_with_two_stage_panes();

    let dock_p1 = app.layout.alloc_id();
    app.panes
        .insert(dock_p1, PaneKind::Editor(EditorPane::new_empty(dock_p1)));
    add_to_dock(&mut app, p1, dock_p1);

    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(p1);

    app.handle_global_action(GlobalAction::DockSplitVertical);
    assert_eq!(
        app.focus.focus_area,
        FocusArea::Dock,
        "DockSplitVertical should move focus to Dock"
    );
}

// ──────────────────────────────────────────────────
// --- UC-7: Cross-Area Dock New Tab ---
// ──────────────────────────────────────────────────

#[test]
fn dock_new_tab_always_targets_dock() {
    // UC-7 BR-1: DockNewTab creates a tab in the Dock, not in Stage.
    let (mut app, p1, _p2) = app_with_two_stage_panes();

    let dock_p1 = app.layout.alloc_id();
    app.panes
        .insert(dock_p1, PaneKind::Editor(EditorPane::new_empty(dock_p1)));
    add_to_dock(&mut app, p1, dock_p1);

    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(p1);
    app.focus.stage_focused = Some(p1);

    let stage_pane_count_before = app.layout.pane_ids().len();
    app.handle_global_action(GlobalAction::DockNewTab);
    let stage_pane_count_after = app.layout.pane_ids().len();

    assert_eq!(
        stage_pane_count_before, stage_pane_count_after,
        "DockNewTab should not add panes to Stage layout"
    );
}

#[test]
fn dock_new_tab_moves_focus_to_dock() {
    // DockNewTab creates a Launcher that needs interaction, so focus moves to Dock.
    let (mut app, p1, _p2) = app_with_two_stage_panes();

    let dock_p1 = app.layout.alloc_id();
    app.panes
        .insert(dock_p1, PaneKind::Editor(EditorPane::new_empty(dock_p1)));
    add_to_dock(&mut app, p1, dock_p1);

    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(p1);
    app.focus.stage_focused = Some(p1);

    app.handle_global_action(GlobalAction::DockNewTab);

    assert_eq!(
        app.focus.focus_area,
        FocusArea::Dock,
        "DockNewTab should move focus to Dock"
    );
}

// ──────────────────────────────────────────────────
// --- UC-8: Settings Migration for Removed Actions ---
// ──────────────────────────────────────────────────

#[test]
fn removed_action_keys_return_none_from_parse() {
    // UC-8 BR-1: Removed action keys in user settings MUST NOT cause a crash or error.
    // They are silently ignored (from_action_key returns None).
    assert_eq!(
        GlobalAction::from_action_key("BrowserBack"),
        None,
        "BrowserBack should be silently dropped"
    );
    assert_eq!(
        GlobalAction::from_action_key("BrowserForward"),
        None,
        "BrowserForward should be silently dropped"
    );
    assert_eq!(
        GlobalAction::from_action_key("SplitHorizontalHere"),
        None,
        "SplitHorizontalHere should be silently dropped"
    );
    assert_eq!(
        GlobalAction::from_action_key("SplitVerticalHere"),
        None,
        "SplitVerticalHere should be silently dropped"
    );
}

#[test]
fn toggle_zoom_in_settings_is_silently_dropped() {
    // UC-8 BR-2: "ToggleZoom" in settings maps to None (dropped).
    // Users who want the behavior must rebind to "ToggleStacked".
    assert_eq!(
        GlobalAction::from_action_key("ToggleZoom"),
        None,
        "ToggleZoom should be silently dropped (users must rebind to ToggleStacked)"
    );
    // ToggleStacked should still work
    assert_eq!(
        GlobalAction::from_action_key("ToggleStacked"),
        Some(GlobalAction::ToggleStacked),
        "ToggleStacked should still parse correctly"
    );
}
