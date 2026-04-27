// Spec: docs/specs/stage-split-only.md
use crate::adapter::inward::click_adapter::pane::handle_drop;
use crate::adapter::inward::drag_drop_adapter::{
    compute_drop_destination, compute_drop_preview_rect,
};
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::drag_types::DropDestination;
use crate::state::{FocusArea, ViewMode};
use crate::tide_core::{DropZone, LayoutEngine, SplitDirection, Vec2};
use crate::tide_input::GlobalAction;
use crate::ActionPort;
use crate::App;
use crate::AppCorePort;
use crate::LayoutPort;
use crate::PaneLifecyclePort;
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
    app.router.set_focused(id);
    (app, id)
}

fn app_with_two_stage_panes() -> (App, u64, u64) {
    let (mut app, p1) = app_with_editor();
    let p2 = app.layout.split(p1, SplitDirection::Horizontal);
    app.panes
        .insert(p2, PaneKind::Editor(EditorPane::new_empty(p2)));
    app.focus.focused = Some(p1);
    app.focus.stage_focused = Some(p1);
    app.router.set_focused(p1);
    (app, p1, p2)
}

fn app_with_legacy_stage_leaf_group() -> (App, u64, u64) {
    let (mut app, p1, p2) = app_with_two_stage_panes();
    app.layout.remove(p2);
    assert!(app.layout.add_tab(p1, p2));
    app.focus.focused = Some(p2);
    app.focus.stage_focused = Some(p2);
    app.router.set_focused(p2);
    (app, p1, p2)
}

// --- UC-1: CreateStagePaneAsSplit ---

#[test]
fn new_terminal_tab_creates_stage_split_not_tab_group() {
    // UC-1 BR-1: NewTab in Stage creates a Terminal split leaf, not a Stage TabGroup tab.
    let (mut app, first_id) = app_with_editor();

    app.new_terminal_tab();

    let new_id = app.focus.focused.expect("NewTab should focus the new Pane");
    assert_ne!(new_id, first_id);
    assert!(matches!(
        app.panes.get(&new_id),
        Some(PaneKind::Terminal(_))
    ));
    assert_eq!(app.layout.pane_ids().len(), 2);
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
    assert!(app.layout.tab_group_containing(first_id).is_none());
    assert!(app.layout.tab_group_containing(new_id).is_none());
}

#[test]
fn new_editor_pane_creates_stage_split_not_tab_group() {
    // UC-1 BR-2: NewFile fallback in Stage creates a split leaf, not a Stage TabGroup tab.
    let (mut app, first_id) = app_with_editor();

    app.new_editor_pane();

    let new_id = app
        .focus
        .focused
        .expect("NewFile should focus the new Pane");
    assert_ne!(new_id, first_id);
    assert!(matches!(app.panes.get(&new_id), Some(PaneKind::Editor(_))));
    assert_eq!(app.layout.pane_ids().len(), 2);
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
    assert!(app.layout.tab_group_containing(first_id).is_none());
    assert!(app.layout.tab_group_containing(new_id).is_none());
}

#[test]
fn splitting_stacked_stage_keeps_stacked_mode_and_creates_split() {
    // UC-1 BR-3: Stage split in ViewMode::Stacked keeps stacked mode and creates a split leaf.
    let (mut app, first_id) = app_with_editor();
    app.handle_toggle_stacked();

    assert_eq!(app.dock.terminal_view_mode, ViewMode::Stacked);
    assert_eq!(app.focus.zoomed_pane, Some(first_id));

    app.split_with_launcher(SplitDirection::Vertical);

    let new_id = app.focus.focused.expect("split should focus the new Pane");
    assert_ne!(new_id, first_id);
    assert_eq!(app.dock.terminal_view_mode, ViewMode::Stacked);
    assert_eq!(app.focus.zoomed_pane, Some(new_id));
    assert_eq!(app.layout.pane_ids().len(), 2);
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
    assert!(app.layout.tab_group_containing(first_id).is_none());
    assert!(app.layout.tab_group_containing(new_id).is_none());
}

#[test]
fn new_workspace_defaults_stage_to_split_mode() {
    // UC-1 BR-4: Creating a new Workspace starts Stage in ViewMode::Split with no zoomed_pane.
    let (mut app, _first_id) = app_with_editor();
    app.handle_toggle_stacked();
    assert_eq!(app.dock.terminal_view_mode, ViewMode::Stacked);
    assert!(app.focus.zoomed_pane.is_some());

    app.new_workspace();

    assert_eq!(app.dock.terminal_view_mode, ViewMode::Split);
    assert_eq!(app.focus.zoomed_pane, None);
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
}

// --- UC-2: MoveStagePaneBySplitOnly ---

#[test]
fn center_drop_on_stage_pane_swaps_positions() {
    // UC-2 BR-1: Stage DropZone::Center swaps the source and target Pane positions.
    let (mut app, p1, p2) = app_with_two_stage_panes();
    app.compute_layout();
    let p1_before = app
        .pane_rects()
        .iter()
        .find(|(id, _)| *id == p1)
        .map(|(_, rect)| *rect)
        .expect("target Stage Pane should have a rect before swap");
    let p2_before = app
        .pane_rects()
        .iter()
        .find(|(id, _)| *id == p2)
        .map(|(_, rect)| *rect)
        .expect("source Stage Pane should have a rect before swap");
    app.focus.focused = Some(p1);

    handle_drop(
        &mut app,
        p2,
        DropDestination::TreePane(p1, DropZone::Center),
    );

    let p1_after = app
        .pane_rects()
        .iter()
        .find(|(id, _)| *id == p1)
        .map(|(_, rect)| *rect)
        .expect("target Stage Pane should have a rect after swap");
    let p2_after = app
        .pane_rects()
        .iter()
        .find(|(id, _)| *id == p2)
        .map(|(_, rect)| *rect)
        .expect("source Stage Pane should have a rect after swap");

    assert_eq!(p2_after, p1_before);
    assert_eq!(p1_after, p2_before);
    assert_eq!(app.focus.focused, Some(p2));
    assert!(app.layout.tab_group_containing(p1).is_none());
    assert!(app.layout.tab_group_containing(p2).is_none());
}

#[test]
fn center_drop_on_stage_pane_has_swap_drop_target() {
    // UC-2 BR-5: Stage center hit testing returns a swap target.
    let (mut app, p1, p2) = app_with_two_stage_panes();
    app.compute_layout();
    let rect = app
        .pane_rects()
        .iter()
        .find(|(id, _)| *id == p1)
        .map(|(_, rect)| *rect)
        .expect("target Stage Pane should have a rect");
    let mouse = Vec2::new(rect.x + rect.width * 0.5, rect.y + rect.height * 0.5);

    let target = compute_drop_destination(&app, mouse, p2);
    let preview = compute_drop_preview_rect(&app, p2, &target);

    assert!(matches!(
        target,
        Some(DropDestination::TreePane(id, DropZone::Center)) if id == p1
    ));
    // Center drops use the renderer's swap preview around the target Pane,
    // not a simulated insert preview rect.
    assert!(preview.is_none());
}

#[test]
fn edge_drop_on_stage_pane_keeps_split_layout() {
    // UC-2 BR-2: Stage directional drops insert split leaves.
    let (mut app, p1, p2) = app_with_two_stage_panes();

    handle_drop(&mut app, p2, DropDestination::TreePane(p1, DropZone::Left));

    assert_eq!(app.layout.pane_ids().len(), 2);
    assert_eq!(app.layout.all_pane_ids().len(), app.panes.len());
    assert!(app.layout.tab_group_containing(p1).is_none());
    assert!(app.layout.tab_group_containing(p2).is_none());
}

#[test]
fn stage_self_drop_has_no_drop_target_or_preview() {
    // UC-2 BR-3: Stage self-drop extraction targets are not offered.
    let (mut app, p1, _p2) = app_with_two_stage_panes();
    app.compute_layout();
    let rect = app
        .pane_rects()
        .iter()
        .find(|(id, _)| *id == p1)
        .map(|(_, rect)| *rect)
        .expect("Stage Pane should have a rect");
    let mouse = Vec2::new(rect.x + rect.width * 0.1, rect.y + rect.height * 0.5);

    let target = compute_drop_destination(&app, mouse, p1);
    let preview = compute_drop_preview_rect(
        &app,
        p1,
        &Some(DropDestination::TreePane(p1, DropZone::Left)),
    );

    assert!(target.is_none());
    assert!(preview.is_none());
}

// --- UC-3: CycleStageOnlyWhenStacked ---

#[test]
fn tab_prev_next_in_stage_split_mode_is_noop() {
    // UC-3 BR-1: TabPrev and TabNext are no-ops in Stage split mode.
    let (mut app, p1, _p2) = app_with_two_stage_panes();
    app.focus.focused = Some(p1);
    app.focus.focus_area = FocusArea::Stage;

    app.handle_global_action(GlobalAction::TabNext);
    assert_eq!(app.focus.focused, Some(p1));

    app.handle_global_action(GlobalAction::TabPrev);
    assert_eq!(app.focus.focused, Some(p1));
}

#[test]
fn tab_prev_next_in_stacked_stage_cycles_split_panes() {
    // UC-3 BR-2: TabPrev and TabNext cycle Stage split panes in ViewMode::Stacked.
    let (mut app, p1, p2) = app_with_two_stage_panes();
    app.focus.focused = Some(p1);
    app.focus.focus_area = FocusArea::Stage;
    app.handle_toggle_stacked();

    app.handle_global_action(GlobalAction::TabNext);
    assert_eq!(app.focus.focused, Some(p2));
    assert_eq!(app.focus.zoomed_pane, Some(p2));

    app.handle_global_action(GlobalAction::TabPrev);
    assert_eq!(app.focus.focused, Some(p1));
    assert_eq!(app.focus.zoomed_pane, Some(p1));
}

// --- UC-4: RenderStageWithoutOrdinaryTabGroupChrome ---

#[test]
fn stage_split_mode_has_no_shared_tab_scroll() {
    // UC-4 BR-1: Stage split mode must not expose per-TabGroup tab-scroll state.
    let (mut app, p1, _p2) = app_with_two_stage_panes();
    app.compute_layout();

    assert_eq!(AppCorePort::shared_tab_max_scroll(&app, p1), None);
}

#[test]
fn stacked_stage_tab_bar_uses_split_panes() {
    // UC-4 BR-2: Stage ViewMode::Stacked keeps the flat tab bar over split panes.
    let (mut app, p1, p2) = app_with_two_stage_panes();
    app.focus.focused = Some(p1);
    app.handle_toggle_stacked();

    assert_eq!(app.dock.terminal_view_mode, ViewMode::Stacked);
    assert_eq!(app.layout.pane_ids(), vec![p1, p2]);
    assert_eq!(app.layout.all_tabs_flat(), vec![p1, p2]);
    assert!(app.layout.tab_group_containing(p1).is_none());
    assert!(app.layout.tab_group_containing(p2).is_none());
}

// --- UC-5: NormalizeLegacyStageLeafGroups ---

#[test]
fn legacy_stage_leaf_group_expands_to_splits_on_layout_compute() {
    // UC-5 BR-1: A legacy Stage LeafGroup with multiple tabs expands into visible split leaves.
    let (mut app, p1, p2) = app_with_legacy_stage_leaf_group();
    assert!(app.layout.tab_group_containing(p1).is_some());

    app.compute_layout();

    assert_eq!(app.layout.pane_ids().len(), 2);
    assert_eq!(app.layout.all_pane_ids().len(), app.panes.len());
    assert!(app.layout.pane_ids().contains(&p1));
    assert!(app.layout.pane_ids().contains(&p2));
    assert!(app.layout.tab_group_containing(p1).is_none());
    assert!(app.layout.tab_group_containing(p2).is_none());
}
