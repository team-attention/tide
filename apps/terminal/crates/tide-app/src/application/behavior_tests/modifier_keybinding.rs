// Spec: docs/specs/modifier-keybinding-redesign.md
//
// These tests cover the current modifier keybinding contract and the legacy
// action-key migration behavior for removed bindings.

use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::{ConfigPageState, FocusArea, ViewMode};
use crate::tide_core::{Key, LayoutEngine, Modifiers, SplitDirection};
use crate::tide_input::{Direction, GlobalAction, KeybindingMap};
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

fn app_with_stage_terminal() -> (App, u64) {
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        terminal_id,
        PaneKind::Terminal(TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap()),
    );
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(terminal_id);
    (app, terminal_id)
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

fn add_context_editor(app: &mut App, terminal_id: u64) -> u64 {
    let pane_id = app.layout.alloc_id();
    app.panes
        .insert(pane_id, PaneKind::Editor(EditorPane::new_empty(pane_id)));
    app.add_pane_to_dock(pane_id, Some(terminal_id));
    app.dock.dock_open = true;
    app.dock.visibility_animation = None;
    pane_id
}

fn set_terminal_context_focus(app: &mut App, terminal_id: u64, pane_id: u64) {
    let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&terminal_id) else {
        panic!("expected Stage Terminal");
    };
    terminal.dock_focused = Some(pane_id);
    terminal.dock_layout.set_active_tab(pane_id);
}

fn terminal_context_focus(app: &App, terminal_id: u64) -> Option<u64> {
    match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => terminal.dock_focused,
        _ => None,
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
    assert!(
        !app.dock.dock_open,
        "DockNavigate when dock closed must not open the Dock"
    );
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
}

#[test]
fn dock_navigate_from_stage_updates_split_terminal_context_surface_focus() {
    // UC-2 BR-4: Cross-area DockNavigate updates the focused Stage Terminal's
    // Terminal Context Surface active Pane without moving keyboard focus.
    let (mut app, terminal_id) = app_with_stage_terminal();
    let first = add_context_editor(&mut app, terminal_id);
    let second = add_context_editor(&mut app, terminal_id);
    {
        let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&terminal_id) else {
            panic!("expected Stage Terminal");
        };
        terminal.dock_view_mode = ViewMode::Split;
    }
    set_terminal_context_focus(&mut app, terminal_id, first);
    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(terminal_id);
    app.router.set_focused(terminal_id);
    app.compute_layout();

    app.handle_global_action(GlobalAction::DockNavigate(Direction::Right));

    assert_eq!(terminal_context_focus(&app, terminal_id), Some(second));
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert_eq!(
        app.focus.focused,
        Some(terminal_id),
        "keyboard focus must stay on the Stage Pane"
    );
}

#[test]
fn dock_navigate_from_stage_preserves_keyboard_focus_in_stacked_terminal_context_surface() {
    // UC-2 BR-4: Cross-area DockNavigate in a stacked Terminal Context Surface
    // cycles the active Pane without routing text input away from Stage.
    let (mut app, terminal_id) = app_with_stage_terminal();
    let first = add_context_editor(&mut app, terminal_id);
    let second = add_context_editor(&mut app, terminal_id);
    set_terminal_context_focus(&mut app, terminal_id, first);
    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(terminal_id);
    app.router.set_focused(terminal_id);
    app.compute_layout();

    app.handle_global_action(GlobalAction::DockNavigate(Direction::Right));

    assert_eq!(terminal_context_focus(&app, terminal_id), Some(second));
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert_eq!(
        app.focus.focused,
        Some(terminal_id),
        "keyboard focus must stay on the Stage Pane"
    );
}

// ─────────────────────────────────────────────────
// --- UC-3: Tab Cycling in Stage ---
// ─────────────────────────────────────────────────

#[test]
fn tab_prev_next_in_stage_split_mode_is_noop() {
    // UC-3 BR-1: TabPrev/TabNext are no-ops in Stage ViewMode::Split.
    let (mut app, p1, _p2) = app_with_two_stage_panes();
    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(p1);

    app.handle_global_action(GlobalAction::TabNext);
    assert_eq!(
        app.focus.focused,
        Some(p1),
        "TabNext should not move focus in Stage split mode"
    );

    app.handle_global_action(GlobalAction::TabPrev);
    assert_eq!(
        app.focus.focused,
        Some(p1),
        "TabPrev should not move focus in Stage split mode"
    );
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
}

#[test]
fn tab_prev_next_in_dock_cycles_dock_tabs() {
    // UC-3 BR-2: When FocusArea is Dock, TabPrev/TabNext cycle through Dock tabs
    // in the focused Stage Terminal's Terminal Context Surface.
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
fn tab_cycling_wraps_around_in_stacked_stage() {
    // UC-3 BR-3: Stage ViewMode::Stacked cycling wraps at both ends.
    let (mut app, p1, p2) = app_with_two_stage_panes();
    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(p2);
    app.handle_toggle_stacked();

    // TabNext from last pane wraps to first.
    app.handle_global_action(GlobalAction::TabNext);
    assert_eq!(
        app.focus.focused,
        Some(p1),
        "TabNext from last stacked pane should wrap to first"
    );
    assert_eq!(app.focus.zoomed_pane, Some(p1));

    // TabPrev from first pane wraps to last.
    app.handle_global_action(GlobalAction::TabPrev);
    assert_eq!(
        app.focus.focused,
        Some(p2),
        "TabPrev from first stacked pane should wrap to last"
    );
    assert_eq!(app.focus.zoomed_pane, Some(p2));
}

#[test]
fn tab_prev_next_in_stacked_stage_cycles_split_panes() {
    // UC-3 BR-4: Stage ViewMode::Stacked cycling updates focus and zoomed pane.
    let (mut app, p1, p2) = app_with_two_stage_panes();
    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(p1);
    app.handle_toggle_stacked();

    app.handle_global_action(GlobalAction::TabNext);

    assert_eq!(app.focus.focused, Some(p2));
    assert_eq!(app.focus.zoomed_pane, Some(p2));
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
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
    let (mut app, _p1) = app_with_editor();
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
fn split_vertical_in_dock_targets_terminal_context_surface() {
    // Spec: docs/specs/open-terminal-codex-app.md
    // UC-4 BR-7: Split actions invoked while focus is inside Dock must target Terminal Context Surface.
    let (mut app, p1, _p2) = app_with_two_stage_panes();

    let dock_p1 = app.layout.alloc_id();
    app.panes
        .insert(dock_p1, PaneKind::Editor(EditorPane::new_empty(dock_p1)));
    add_to_dock(&mut app, p1, dock_p1);

    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(dock_p1);

    app.handle_global_action(GlobalAction::SplitVertical);

    assert_eq!(
        app.focus.focus_area,
        FocusArea::Dock,
        "SplitVertical in Dock should keep FocusArea as Dock"
    );
    assert!(
        !app.layout.all_pane_ids().contains(&dock_p1),
        "SplitVertical in Dock should not move the context Pane into Stage"
    );
}

#[test]
fn split_horizontal_in_stacked_dock_preserves_stacked_terminal_context_surface() {
    // UC-5 BR-3: SplitHorizontal in a Stacked Terminal Context Surface adds a Launcher without switching to Split view.
    let (mut app, terminal_id) = app_with_stage_terminal();
    let first_context_id = add_context_editor(&mut app, terminal_id);
    let second_context_id = add_context_editor(&mut app, terminal_id);
    app.set_active_terminal_context_stacked(true);
    set_terminal_context_focus(&mut app, terminal_id, second_context_id);
    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(second_context_id);
    app.router.set_focused(second_context_id);

    app.handle_global_action(GlobalAction::SplitHorizontal);

    let new_id = app
        .focus
        .focused
        .expect("Dock split should focus the new Launcher");
    assert!(matches!(
        app.panes.get(&new_id),
        Some(PaneKind::Launcher(_))
    ));
    assert_eq!(app.focus.focus_area, FocusArea::Dock);
    assert_eq!(app.terminal_owning(new_id), Some(terminal_id));

    let Some(PaneKind::Terminal(owner)) = app.panes.get(&terminal_id) else {
        panic!("expected Stage Terminal");
    };
    assert_eq!(owner.dock_view_mode, ViewMode::Stacked);
    assert_eq!(
        owner.dock_layout.all_tabs_flat(),
        vec![first_context_id, second_context_id, new_id]
    );
}

#[test]
fn cmd_backslash_maps_to_toggle_dock() {
    // UC-8 BR-1: Cmd+\ = ToggleDock.
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
        Some(GlobalAction::ToggleDock),
        "Cmd+\\ should map to ToggleDock"
    );
}

#[test]
fn cmd_b_maps_to_toggle_file_tree() {
    // UC-8 BR-1: Cmd+B = ToggleFileTree.
    let map = KeybindingMap::new();
    let mods = Modifiers {
        shift: false,
        ctrl: false,
        meta: true,
        alt: false,
    };
    let action = map.lookup(&Key::Char('b'), &mods);
    assert_eq!(
        action,
        Some(GlobalAction::ToggleFileTree),
        "Cmd+B should map to ToggleFileTree"
    );
}

#[test]
fn cmd_e_maps_to_toggle_workspace_rail() {
    // UC-8 BR-1: Cmd+E = ToggleWorkspaceSidebar.
    let map = KeybindingMap::new();
    let mods = Modifiers {
        shift: false,
        ctrl: false,
        meta: true,
        alt: false,
    };
    let action = map.lookup(&Key::Char('e'), &mods);
    assert_eq!(
        action,
        Some(GlobalAction::ToggleWorkspaceSidebar),
        "Cmd+E should map to ToggleWorkspaceSidebar"
    );
}

#[test]
fn cmd_1_2_3_4_are_not_default_visibility_or_focus_toggles() {
    // UC-8 BR-2: Visibility and FocusArea changes use named shortcuts, not numeric slots.
    let map = KeybindingMap::new();
    let mods = Modifiers {
        shift: false,
        ctrl: false,
        meta: true,
        alt: false,
    };

    assert_eq!(map.lookup(&Key::Char('1'), &mods), None);
    assert_eq!(map.lookup(&Key::Char('2'), &mods), None);
    assert_eq!(map.lookup(&Key::Char('3'), &mods), None);
    assert_eq!(map.lookup(&Key::Char('4'), &mods), None);
}

#[test]
fn cmd_i_and_cmd_o_are_not_default_tab_group_navigation() {
    // UC-8 BR-3: Cmd+I/O are no longer reserved for TabPrev/TabNext.
    let map = KeybindingMap::new();
    let mods = Modifiers {
        shift: false,
        ctrl: false,
        meta: true,
        alt: false,
    };

    assert_eq!(map.lookup(&Key::Char('i'), &mods), None);
    assert_eq!(map.lookup(&Key::Char('o'), &mods), None);
}

#[test]
fn cmd_shift_hjkl_maps_to_dock_navigate() {
    // UC-2 BR-1: Cmd+Shift+H/J/K/L navigates Dock without moving FocusArea.
    let map = KeybindingMap::new();
    let mods = Modifiers {
        shift: true,
        ctrl: false,
        meta: true,
        alt: false,
    };

    let cases = [
        ('h', Direction::Left),
        ('j', Direction::Down),
        ('k', Direction::Up),
        ('l', Direction::Right),
    ];

    for (ch, direction) in cases {
        assert_eq!(
            map.lookup(&Key::Char(ch), &mods),
            Some(GlobalAction::DockNavigate(direction))
        );
    }
}

#[test]
fn keybinding_settings_omit_retired_tab_group_and_unbound_dock_split_actions() {
    // UC-10 BR-1/BR-2/BR-3: Settings hides retired tab-group shortcuts and
    // no-default internals, while exposing every default-bound action.
    let actions = GlobalAction::all_actions();
    let defaults = KeybindingMap::new();

    for retired in [
        GlobalAction::TabPrev,
        GlobalAction::TabNext,
        GlobalAction::DockTabPrev,
        GlobalAction::DockTabNext,
        GlobalAction::DockSplitHorizontal,
        GlobalAction::DockSplitVertical,
        GlobalAction::DockNewTab,
        GlobalAction::SplitVertical,
        GlobalAction::ToggleTheme,
        GlobalAction::ToggleDockPin,
    ] {
        assert!(
            !actions.iter().any(|action| action == &retired),
            "{} should not be shown in keybinding settings",
            retired.action_key()
        );
    }

    for action in actions {
        assert!(
            defaults.hotkey_for(&action).is_some(),
            "{} should not be shown without a default hotkey",
            action.action_key()
        );
    }

    for (_, default_action) in KeybindingMap::default_bindings() {
        assert!(
            GlobalAction::all_actions()
                .iter()
                .any(|action| action.action_key() == default_action.action_key()),
            "{} has a default hotkey and should be shown in keybinding settings",
            default_action.action_key()
        );
    }
}

#[test]
fn keybinding_settings_swap_conflicting_hotkeys_instead_of_placeholder_unbinding() {
    // UC-10 BR-4: Recording a hotkey already used by another action swaps the
    // conflicting action onto the previous hotkey instead of assigning a fake
    // placeholder key that could later be routed as a real shortcut.
    let mut page = ConfigPageState::new(
        vec![
            (
                GlobalAction::ToggleFileTree,
                crate::tide_input::Hotkey::new(Key::Char('b'), false, false, true, false),
            ),
            (
                GlobalAction::ToggleWorkspaceSidebar,
                crate::tide_input::Hotkey::new(Key::Char('e'), false, false, true, false),
            ),
        ],
        String::new(),
        String::new(),
    );

    page.set_keybinding_with_swap(
        1,
        crate::tide_input::Hotkey::new(Key::Char('b'), false, false, true, false),
    );

    assert_eq!(
        page.bindings[0].1,
        crate::tide_input::Hotkey::new(Key::Char('e'), false, false, true, false)
    );
    assert_eq!(
        page.bindings[1].1,
        crate::tide_input::Hotkey::new(Key::Char('b'), false, false, true, false)
    );
    assert!(page.dirty);
}

#[test]
fn keybinding_overrides_remove_same_hotkey_collisions_with_last_override_winning() {
    // UC-10 BR-5: Manually-edited settings may contain conflicts. The runtime
    // map resolves same-hotkey collisions deterministically instead of relying
    // on first-match lookup order.
    let cmd_b = crate::tide_input::Hotkey::new(Key::Char('b'), false, false, true, false);
    let map = KeybindingMap::with_overrides(vec![
        (cmd_b.clone(), GlobalAction::ToggleFileTree),
        (cmd_b.clone(), GlobalAction::ToggleWorkspaceSidebar),
    ]);
    let mods = Modifiers {
        shift: false,
        ctrl: false,
        meta: true,
        alt: false,
    };

    assert_eq!(
        map.lookup(&Key::Char('b'), &mods),
        Some(GlobalAction::ToggleWorkspaceSidebar)
    );
    assert!(
        map.hotkey_for(&GlobalAction::ToggleFileTree).is_none(),
        "same-hotkey conflict should unbind the earlier action"
    );
}

#[test]
fn cmd_shift_p_is_not_bound_to_retired_dock_pin() {
    // UC-10 BR-4: ToggleDockPin is retained for compatibility but has no default hotkey.
    let map = KeybindingMap::new();
    let mods = Modifiers {
        shift: true,
        ctrl: false,
        meta: true,
        alt: false,
    };

    assert_eq!(map.lookup(&Key::Char('p'), &mods), None);
}

#[test]
fn cmd_shift_backslash_is_not_bound_to_split_vertical() {
    // UC-5 BR-2: SplitVertical has no default keyboard binding.
    let map = KeybindingMap::new();
    let mods = Modifiers {
        shift: true,
        ctrl: false,
        meta: true,
        alt: false,
    };
    let action = map.lookup(&Key::Char('\\'), &mods);
    assert_eq!(
        action, None,
        "Cmd+Shift+\\ should not have a default binding"
    );
}

#[test]
fn cmd_shift_d_is_not_bound_to_toggle_theme() {
    // UC-8 BR-5: ToggleTheme has no default keyboard binding.
    let map = KeybindingMap::new();
    let mods = Modifiers {
        shift: true,
        ctrl: false,
        meta: true,
        alt: false,
    };
    let action = map.lookup(&Key::Char('d'), &mods);
    assert_eq!(
        action, None,
        "Cmd+Shift+D should not have a default binding"
    );
}

#[test]
fn cmd_shift_t_maps_to_split_horizontal() {
    // UC-5 BR-2: Cmd+Shift+T = SplitHorizontal in the current FocusArea.
    let map = KeybindingMap::new();
    let mods = Modifiers {
        shift: true,
        ctrl: false,
        meta: true,
        alt: false,
    };
    let action = map.lookup(&Key::Char('t'), &mods);
    assert_eq!(
        action,
        Some(GlobalAction::SplitHorizontal),
        "Cmd+Shift+T should map to SplitHorizontal"
    );
}

// ──────────────────────────────────────────────────
// --- UC-6: Cross-Area Dock Split ---
// ──────────────────────────────────────────────────

#[test]
fn dock_split_vertical_always_targets_dock() {
    // Spec: docs/specs/open-terminal-codex-app.md
    // UC-4 BR-7: DockSplit variants must split Terminal Context Surface, not Stage.
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
fn dock_split_focuses_terminal_context_surface() {
    // Spec: docs/specs/open-terminal-codex-app.md
    // UC-4 BR-7: DockSplit must split the Terminal Context Surface.
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
        "DockSplitVertical should focus the new context Pane"
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
