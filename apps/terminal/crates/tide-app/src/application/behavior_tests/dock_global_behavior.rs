// Spec: docs/specs/dock-global.md
use crate::adapter::inward::click_adapter::header::check_header_click;
use crate::adapter::inward::click_adapter::pane::handle_drop;
use crate::adapter::inward::drag_drop_adapter::compute_drop_destination;
use crate::header::{HeaderHitAction, HeaderHitZone};
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::drag_types::DropDestination;
use crate::state::FocusArea;
use crate::tide_core::{DropZone, LayoutEngine, Rect, SplitDirection, Vec2};
use crate::tide_input::GlobalAction;
use crate::ActionPort;
use crate::App;
use crate::AppCorePort;
use crate::DockPort;
use crate::LayoutPort;
use crate::PaneLifecyclePort;

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
    let terminal = TerminalPane::with_cwd(tid, 80, 24, None, true).unwrap();
    app.panes.insert(tid, PaneKind::Terminal(terminal));
    app.focus.focused = Some(tid);
    app.focus.stage_focused = Some(tid);
    app.focus.focus_area = FocusArea::Stage;
    (app, tid)
}

fn app_with_two_real_terminals() -> (App, u64, u64) {
    let (mut app, t1) = app_with_real_terminal();
    let t2 = app
        .layout
        .split(t1, crate::tide_core::SplitDirection::Vertical);
    let terminal = TerminalPane::with_cwd(t2, 80, 24, None, true).unwrap();
    app.panes.insert(t2, PaneKind::Terminal(terminal));
    (app, t1, t2)
}

fn add_context_editor(app: &mut App, terminal_id: u64) -> u64 {
    let pane_id = app.layout.alloc_id();
    app.panes
        .insert(pane_id, PaneKind::Editor(EditorPane::new_empty(pane_id)));
    app.add_pane_to_dock(pane_id, Some(terminal_id));
    pane_id
}

fn terminal_context_ids(app: &App, terminal_id: u64) -> Vec<u64> {
    match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => terminal.dock_layout.all_pane_ids(),
        _ => Vec::new(),
    }
}

fn layout_snapshot_contains(snapshot: &crate::tide_layout::LayoutSnapshot, pane_id: u64) -> bool {
    match snapshot {
        crate::tide_layout::LayoutSnapshot::Leaf { tabs, .. }
        | crate::tide_layout::LayoutSnapshot::LeafGroup { tabs, .. } => tabs.contains(&pane_id),
        crate::tide_layout::LayoutSnapshot::Split { left, right, .. } => {
            layout_snapshot_contains(left, pane_id) || layout_snapshot_contains(right, pane_id)
        }
    }
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

// --- UC-1: GlobalDockWidth ---

#[test]
fn dock_width_is_global_not_per_terminal() {
    // UC-1 BR-1: Dock width is global state on DockState, not per Terminal.
    let (mut app, t1, t2) = app_with_two_real_terminals();
    app.dock.dock_width = 500.0;
    app.dock.dock_open = true;

    app.focus.focused = Some(t2);
    app.focus.stage_focused = Some(t2);
    app.swap_dock_state(t2);
    assert_eq!(app.dock.dock_width, 500.0);

    app.focus.focused = Some(t1);
    app.focus.stage_focused = Some(t1);
    app.swap_dock_state(t1);
    assert_eq!(app.dock.dock_width, 500.0);
}

#[test]
fn switching_terminals_preserves_dock_width() {
    // UC-1 BR-2: Switching Stage Terminals does not change dock_width.
    let (mut app, t1, t2) = app_with_two_real_terminals();
    app.focus.focused = Some(t1);
    app.focus.stage_focused = Some(t1);
    add_context_editor(&mut app, t1);
    app.dock.dock_width = 600.0;

    app.focus.focused = Some(t2);
    app.focus.stage_focused = Some(t2);
    app.swap_dock_state(t2);

    assert_eq!(
        app.dock.dock_width, 600.0,
        "dock width must persist across Stage Terminal switch"
    );
}

// --- UC-2: RejectPinnedDock ---

#[test]
fn toggle_dock_pin_keeps_pane_in_terminal_context_surface() {
    // UC-2 BR-1: ToggleDockPin must not move a Pane into pinned_dock_layout.
    let (mut app, terminal_id) = app_with_real_terminal();
    let context_pane = add_context_editor(&mut app, terminal_id);
    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(context_pane);

    app.toggle_dock_pin();

    assert!(!app.is_pane_pinned(context_pane));
    assert!(app.dock.pinned_dock_layout.all_pane_ids().is_empty());
    assert_eq!(terminal_context_ids(&app, terminal_id), vec![context_pane]);
    assert_eq!(
        app.assoc.associated_terminal.get(&context_pane),
        Some(&terminal_id)
    );
    assert_eq!(app.focus.focused, Some(context_pane));
}

#[test]
fn pin_queries_report_no_visible_pinned_panes() {
    // UC-2 BR-2: is_pane_pinned and has_pinned_panes return false for user-visible behavior.
    let (mut app, _terminal_id) = app_with_real_terminal();
    let legacy_pane = app.layout.alloc_id();
    app.panes.insert(
        legacy_pane,
        PaneKind::Editor(EditorPane::new_empty(legacy_pane)),
    );
    app.dock.pinned_dock_layout.insert_leaf_group(legacy_pane);

    assert!(!app.is_pane_pinned(legacy_pane));
    assert!(!app.has_pinned_panes());
}

#[test]
fn legacy_pinned_layout_does_not_intercept_context_drop_target() {
    // UC-2 BR-3: Legacy pinned layout must not create a separate Dock drop target.
    let (mut app, terminal_id) = app_with_real_terminal();
    app.set_dock_zoomed(false);
    let first = add_context_editor(&mut app, terminal_id);
    let second = add_context_editor(&mut app, terminal_id);
    let legacy_pane = app.layout.alloc_id();
    app.panes.insert(
        legacy_pane,
        PaneKind::Editor(EditorPane::new_empty(legacy_pane)),
    );
    app.dock.pinned_dock_layout.insert_leaf_group(legacy_pane);
    app.dock.dock_open = true;
    app.dock.visibility_animation = None;
    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(second);
    app.compute_layout();
    let dock_rect = app.dock_area_rect.expect("Dock area should be computed");

    let destination = compute_drop_destination(
        &app,
        Vec2::new(dock_rect.x + 4.0, dock_rect.y + 4.0),
        second,
    );

    assert!(
        matches!(
            destination,
            Some(DropDestination::DockRoot(_)) | Some(DropDestination::TreePane(_, _))
        ),
        "legacy pinned layout should leave ordinary context drop zones available, got {destination:?}"
    );
    assert_eq!(terminal_context_ids(&app, terminal_id), vec![first, second]);
}

#[test]
fn legacy_pinned_layout_does_not_keep_dock_open() {
    // UC-2 BR-4: Legacy pinned layout contents must not make the Dock visible or suppress placeholders.
    let (mut app, _terminal_id) = app_with_real_terminal();
    let legacy_pane = app.layout.alloc_id();
    app.panes.insert(
        legacy_pane,
        PaneKind::Editor(EditorPane::new_empty(legacy_pane)),
    );
    app.dock.pinned_dock_layout.insert_leaf_group(legacy_pane);
    app.dock.dock_open = true;

    app.compute_layout();

    assert!(
        !app.dock.dock_open,
        "legacy pinned layout must not keep the right region open"
    );
}

// --- UC-3: ToggleDockStacked ---

#[test]
fn dock_stacked_mode_renders_only_active_context_pane() {
    // UC-3 BR-1: Dock stacked state must render exactly one active context Pane.
    let (mut app, terminal_id) = app_with_real_terminal();
    let first = add_context_editor(&mut app, terminal_id);
    let second = add_context_editor(&mut app, terminal_id);
    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(second);
    app.set_dock_zoomed(true);
    app.compute_layout();

    let visible_ids: Vec<u64> = app.pane_rects.iter().map(|(id, _)| *id).collect();
    assert_eq!(app.dock_zoomed_pane(), Some(second));
    assert!(visible_ids.contains(&second));
    assert!(!visible_ids.contains(&first));
}

#[test]
fn dock_toggle_stacked_preserves_context_split_layout() {
    // UC-3 BR-2: DockToggleStacked must not flatten the context SplitLayout.
    let (mut app, terminal_id) = app_with_real_terminal();
    app.set_dock_zoomed(false);
    let first = add_context_editor(&mut app, terminal_id);
    let second = add_context_editor(&mut app, terminal_id);
    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(second);

    app.handle_global_action(GlobalAction::DockToggleStacked);

    assert!(app.dock_zoomed());
    assert_eq!(app.dock_zoomed_pane(), Some(second));
    assert_eq!(terminal_context_ids(&app, terminal_id), vec![first, second]);
    let terminal = match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => terminal,
        _ => panic!("expected Terminal"),
    };
    assert_eq!(
        terminal.dock_layout.pane_ids().len(),
        2,
        "stored context SplitLayout should keep both visible leaves while stacked presentation is active"
    );
}

#[test]
fn closing_focused_stacked_context_pane_focuses_previous_flat_pane() {
    // UC-3 BR-5: Stacked Terminal Context Surface close uses the flat stacked order and prefers the Pane immediately to the left.
    let (mut app, terminal_id) = app_with_real_terminal();
    let first = add_context_editor(&mut app, terminal_id);
    let second = add_context_editor(&mut app, terminal_id);
    let third = add_context_editor(&mut app, terminal_id);

    assert_eq!(
        terminal_context_ids(&app, terminal_id),
        vec![first, second, third]
    );
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(third);
    app.set_dock_zoomed(true);

    app.close_specific_pane(third);

    assert_eq!(app.focus.focus_area, FocusArea::Dock);
    assert_eq!(app.focus.focused, Some(second));
    let terminal = match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => terminal,
        _ => panic!("expected Terminal"),
    };
    assert_eq!(terminal.dock_focused, Some(second));
    assert_eq!(terminal_context_ids(&app, terminal_id), vec![first, second]);
}

#[test]
fn context_pane_maximize_toggles_dock_stacked_mode() {
    // UC-3 BR-3: Header maximize on a context Pane must toggle Dock stacked state.
    let (mut app, terminal_id) = app_with_real_terminal();
    app.set_dock_zoomed(false);
    let context_pane = add_context_editor(&mut app, terminal_id);
    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(context_pane);

    click_header_action(&mut app, context_pane, HeaderHitAction::Maximize);

    assert!(app.dock_zoomed());
    assert_eq!(app.dock_zoomed_pane(), Some(context_pane));
    assert_eq!(terminal_context_ids(&app, terminal_id), vec![context_pane]);
}

// --- UC-4: RenderTerminalContextOnly ---

#[test]
fn layout_compute_ignores_legacy_pinned_layout() {
    // UC-4 BR-1: Layout computation must ignore pinned_dock_layout.
    let (mut app, terminal_id) = app_with_real_terminal();
    let context_pane = add_context_editor(&mut app, terminal_id);
    let legacy_pane = app.layout.alloc_id();
    app.panes.insert(
        legacy_pane,
        PaneKind::Editor(EditorPane::new_empty(legacy_pane)),
    );
    app.dock.pinned_dock_layout.insert_leaf_group(legacy_pane);
    app.dock.dock_open = true;

    app.compute_layout();

    let visible_ids: Vec<u64> = app.pane_rects.iter().map(|(id, _)| *id).collect();
    assert!(visible_ids.contains(&terminal_id));
    assert!(visible_ids.contains(&context_pane));
    assert!(
        !visible_ids.contains(&legacy_pane),
        "legacy pinned Pane must not receive a layout rect"
    );
}

#[test]
fn tab_bar_ignores_legacy_pinned_layout() {
    // UC-4 BR-2: Tab-bar rendering must not include pinned tabs or a pinned separator.
    let (mut app, terminal_id) = app_with_real_terminal();
    let context_pane = add_context_editor(&mut app, terminal_id);
    let legacy_pane = app.layout.alloc_id();
    app.panes.insert(
        legacy_pane,
        PaneKind::Editor(EditorPane::new_empty(legacy_pane)),
    );
    app.dock.pinned_dock_layout.insert_leaf_group(legacy_pane);

    assert_eq!(
        app.shared_tab_max_scroll(context_pane),
        None,
        "single visible context tab should not inherit legacy pinned tabs"
    );
    assert_eq!(
        app.shared_tab_max_scroll(legacy_pane),
        None,
        "legacy pinned Pane should not expose shared tab-bar state"
    );
}

#[test]
fn dock_tab_cycle_uses_only_active_terminal_context_surface() {
    // UC-4 BR-3: Dock tab navigation must cycle only through the focused Stage Terminal's context TabGroup.
    let (mut app, terminal_id) = app_with_real_terminal();
    let first = add_context_editor(&mut app, terminal_id);
    let second = add_context_editor(&mut app, terminal_id);
    let legacy_pane = app.layout.alloc_id();
    app.panes.insert(
        legacy_pane,
        PaneKind::Editor(EditorPane::new_empty(legacy_pane)),
    );
    app.dock.pinned_dock_layout.insert_leaf_group(legacy_pane);
    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(first);
    if let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&terminal_id) {
        terminal.dock_focused = Some(first);
        terminal.dock_layout.set_active_tab(first);
    }

    app.handle_global_action(GlobalAction::DockTabNext);

    assert_eq!(app.focus.focused, Some(second));
    assert_ne!(app.focus.focused, Some(legacy_pane));
}

#[test]
fn drag_drop_uses_only_context_surface_destinations() {
    // UC-4 BR-4: Drag/drop hit testing must use only Terminal Context Surface destinations.
    let (mut app, terminal_id) = app_with_real_terminal();
    let context_pane = add_context_editor(&mut app, terminal_id);
    let legacy_pane = app.layout.alloc_id();
    app.panes.insert(
        legacy_pane,
        PaneKind::Editor(EditorPane::new_empty(legacy_pane)),
    );
    app.dock.pinned_dock_layout.insert_leaf_group(legacy_pane);
    app.dock.dock_open = true;
    app.compute_layout();
    let dock_rect = app.dock_area_rect.expect("Dock area should be computed");

    let destination = compute_drop_destination(
        &app,
        Vec2::new(dock_rect.x + 4.0, dock_rect.y + 4.0),
        context_pane,
    );

    assert_eq!(
        destination, None,
        "single context Pane self-drop should not expose any legacy Dock target"
    );
}

#[test]
fn center_drop_on_context_pane_swaps_without_merging_context_panes() {
    // UC-4 BR-4: Drag/drop hit testing must use Dock split/stack behavior, not legacy center-tab insertion.
    let (mut app, terminal_id) = app_with_real_terminal();
    let first = add_context_editor(&mut app, terminal_id);
    let second = add_context_editor(&mut app, terminal_id);

    handle_drop(
        &mut app,
        first,
        DropDestination::TreePane(second, DropZone::Center),
    );

    let terminal = match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => terminal,
        _ => panic!("expected Terminal"),
    };
    assert_eq!(terminal.dock_layout.all_pane_ids().len(), 2);
    assert_eq!(
        terminal.dock_layout.pane_ids().len(),
        2,
        "center drop should keep both context Panes visible in Split view"
    );
    assert!(
        terminal
            .dock_layout
            .tab_group_containing(first)
            .is_none_or(|group| !group.contains(second)),
        "center drop should swap positions instead of creating a shared TabGroup"
    );
}

#[test]
fn opening_file_in_context_surface_defaults_to_right_split() {
    // UC-4 BR-4: File opens in Terminal Context Surface default to a right-side split.
    let (mut app, terminal_id) = app_with_real_terminal();
    let first_path = std::path::PathBuf::from("/tmp/dock_context_right_split_first.txt");
    let second_path = std::path::PathBuf::from("/tmp/dock_context_right_split_second.txt");
    let _ = std::fs::write(&first_path, "first");
    let _ = std::fs::write(&second_path, "second");

    app.open_editor_pane(first_path.clone());
    let first = app.focus.focused.expect("first file should focus");
    app.open_editor_pane(second_path.clone());
    let second = app.focus.focused.expect("second file should focus");

    let terminal = match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => terminal,
        _ => panic!("expected Terminal"),
    };

    match terminal
        .dock_layout
        .snapshot()
        .expect("context SplitLayout should exist")
    {
        crate::tide_layout::LayoutSnapshot::Split {
            direction, right, ..
        } => {
            assert_eq!(direction, SplitDirection::Vertical);
            assert!(
                layout_snapshot_contains(&right, second),
                "second file should open to the right of the focused context Pane"
            );
        }
        other => panic!("expected right context split after opening file, got {other:?}"),
    }
    assert!(terminal.dock_layout.all_pane_ids().contains(&first));
    assert!(terminal.dock_layout.all_pane_ids().contains(&second));

    let _ = std::fs::remove_file(&first_path);
    let _ = std::fs::remove_file(&second_path);
}
