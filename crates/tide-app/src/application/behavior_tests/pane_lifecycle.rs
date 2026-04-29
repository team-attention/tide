use crate::pane::browser::BrowserPane;
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::{FocusArea, ViewMode};
use crate::theme::{
    PANE_PADDING, SIDE_SURFACE_BORDER_HIT_SLOP, TITLEBAR_BUTTON_GAP, TITLEBAR_ICON_BUTTON_PAD_H,
    TITLEBAR_ICON_SCALE,
};
use crate::tide_core::{LayoutEngine, MouseButton, SplitDirection, Vec2};
use crate::App;
use crate::AppCorePort;
use crate::DockPort;
use crate::LayoutPort;
use crate::PaneLifecyclePort;
use crate::WorkspaceNavPort;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn test_window_proxy() -> crate::tide_platform::WindowProxy {
    let (tx, _rx) = std::sync::mpsc::channel();
    crate::tide_platform::WindowProxy::new(tx, std::sync::Arc::new(|| {}))
}

enum TitlebarSurfaceButton {
    Dock,
    FileTree,
    Workspace,
}

fn titlebar_surface_button_center(app: &App, button: TitlebarSurfaceButton) -> Vec2 {
    let logical = app.logical_size();
    let cs = app.window.cached_cell_size;
    let btn_w = cs.width * TITLEBAR_ICON_SCALE + TITLEBAR_ICON_BUTTON_PAD_H * 2.0;
    let gear_x = logical.width - PANE_PADDING - btn_w;
    let integ_x = gear_x - btn_w - TITLEBAR_BUTTON_GAP;
    let mut cur_right = integ_x - TITLEBAR_BUTTON_GAP;
    let index = match button {
        TitlebarSurfaceButton::FileTree => 0,
        TitlebarSurfaceButton::Dock => 1,
        TitlebarSurfaceButton::Workspace => 2,
    };
    for _ in 0..index {
        cur_right -= btn_w + TITLEBAR_BUTTON_GAP;
    }
    let btn_x = cur_right - btn_w;
    Vec2::new(btn_x + btn_w / 2.0, app.window.top_inset / 2.0)
}

fn app_with_editor() -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let pane = EditorPane::new_empty(id);
    app.panes.insert(id, PaneKind::Editor(pane));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

fn app_with_browser() -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let pane = BrowserPane::with_url(id, "https://example.com".to_string());
    app.panes.insert(id, PaneKind::Browser(pane));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

fn app_with_file_tree_view() -> App {
    let (mut app, id) = app_with_editor();
    app.focus.stage_focused = Some(id);
    app.ft.visible = true;
    app.ft.width = 220.0;
    app.ft.visibility_animation = None;
    app.compute_layout();
    app
}

fn app_with_terminal_context_surface() -> App {
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

    let context_id = app.layout.alloc_id();
    app.panes.insert(
        context_id,
        PaneKind::Editor(EditorPane::new_empty(context_id)),
    );
    app.add_pane_to_dock(context_id, Some(terminal_id));
    app.dock.visibility_animation = None;
    app.compute_layout();
    app
}

fn app_with_two_terminal_stage_splits() -> (App, u64, u64) {
    let mut app = test_app();
    let (layout, first_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.create_terminal_pane(first_id, None);
    app.focus.focused = Some(first_id);
    app.focus.stage_focused = Some(first_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(first_id);

    app.new_terminal_tab();
    let second_id = app
        .focus
        .focused
        .expect("new terminal tab should focus the new pane");

    assert_eq!(app.layout.pane_ids().len(), 2);
    assert!(app.layout.tab_group_containing(first_id).is_none());
    assert!(app.layout.tab_group_containing(second_id).is_none());

    (app, first_id, second_id)
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

// Spec: docs/specs/pane-lifecycle.md

// --- UC-1: CreateTab ---

#[test]
fn new_editor_pane_adds_stage_split_leaf() {
    // UC-1: CreateTab
    let (mut app, _first_id) = app_with_editor();
    let pane_count_before = app.panes.len();
    app.new_editor_pane();
    assert_eq!(app.panes.len(), pane_count_before + 1);
    assert_ne!(app.focus.focused, Some(_first_id));
    // Invariant: PaneId sync
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
}

#[test]
fn new_editor_pane_sets_focus_to_new_pane() {
    // UC-1 BR-3: Focus moves to the newly created Pane
    let (mut app, _) = app_with_editor();
    app.new_editor_pane();
    let new_id = app.focus.focused.unwrap();
    assert!(app.panes.contains_key(&new_id));
    assert!(matches!(app.panes.get(&new_id), Some(PaneKind::Editor(_))));
    // Invariant: PaneId sync
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
}

#[test]
fn new_editor_pane_does_nothing_without_focus() {
    // UC-1 BR-2: If no Pane is focused, do nothing
    let mut app = test_app();
    let count_before = app.panes.len();
    app.new_editor_pane();
    assert_eq!(app.panes.len(), count_before);
}

#[test]
fn new_terminal_tab_creates_terminal_pane_in_stage() {
    // UC-1 BR-1: New tab in Stage creates a Terminal split leaf.
    let (mut app, _) = app_with_editor();
    app.new_terminal_tab();
    let new_id = app.focus.focused.unwrap();
    assert!(matches!(
        app.panes.get(&new_id),
        Some(PaneKind::Terminal(_))
    ));
    // Invariant: PaneId sync
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
    assert!(app.layout.tab_group_containing(new_id).is_none());
}

// --- UC-2: SplitPane ---

#[test]
fn split_creates_new_pane_in_split_layout() {
    // UC-2: SplitPane
    let (mut app, _first_id) = app_with_editor();
    let pane_ids_before = app.layout.pane_ids().len();
    app.split_with_launcher(crate::tide_core::SplitDirection::Vertical);
    assert_eq!(app.layout.pane_ids().len(), pane_ids_before + 1);
    // Invariant: PaneId sync
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
}

#[test]
fn split_focuses_new_terminal_pane_in_stage() {
    // UC-2 BR-4: Split in Stage creates a Terminal directly
    let (mut app, first_id) = app_with_editor();
    app.split_with_launcher(crate::tide_core::SplitDirection::Vertical);
    assert_ne!(app.focus.focused, Some(first_id));
    let new_id = app.focus.focused.unwrap();
    assert!(matches!(
        app.panes.get(&new_id),
        Some(PaneKind::Terminal(_))
    ));
    // Invariant: PaneId sync
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
}

#[test]
fn splitting_zoomed_stage_leaf_keeps_stacked_mode_and_focuses_the_new_pane() {
    // UC-2 BR-5: If the focused Stage Pane was zoomed, split preserves stacked mode
    // and focuses the new Stage Pane so the stacked flat tab bar stays visible.
    let (mut app, first_id) = app_with_editor();
    app.handle_toggle_stacked();

    assert_eq!(app.dock.terminal_view_mode, ViewMode::Stacked);
    assert_eq!(app.focus.zoomed_pane, Some(first_id));

    app.split_with_launcher(crate::tide_core::SplitDirection::Vertical);

    let new_id = app.focus.focused.expect("split should focus the new pane");
    assert_ne!(new_id, first_id);
    assert_eq!(app.dock.terminal_view_mode, ViewMode::Stacked);
    assert_eq!(app.focus.zoomed_pane, Some(new_id));
    assert_eq!(app.layout.pane_ids().len(), 2);
    assert_eq!(app.layout.all_tabs_flat().len(), 2);
}

#[test]
fn splitting_stacked_stage_creates_split_leaf_not_tab_group() {
    // UC-2 BR-7: If the focused Stage Pane is zoomed, split keeps stacked mode
    // and creates a new Stage split leaf instead of a Stage TabGroup tab.
    let (mut app, first_id, second_id) = app_with_two_terminal_stage_splits();
    app.focus.focused = Some(second_id);
    app.focus.stage_focused = Some(second_id);
    app.router.set_focused(second_id);
    app.handle_toggle_stacked();

    assert_eq!(app.dock.terminal_view_mode, ViewMode::Stacked);
    assert_eq!(app.focus.zoomed_pane, Some(second_id));

    let visible_before = app.layout.pane_ids();

    app.split_with_launcher(crate::tide_core::SplitDirection::Vertical);

    let new_id = app.focus.focused.expect("split should focus the new pane");

    assert_eq!(app.dock.terminal_view_mode, ViewMode::Stacked);
    assert_eq!(app.focus.zoomed_pane, Some(new_id));
    assert_eq!(app.focus.stage_focused, Some(new_id));
    assert_eq!(app.layout.pane_ids().len(), visible_before.len() + 1);
    assert!(app.layout.pane_ids().contains(&first_id));
    assert!(app.layout.pane_ids().contains(&second_id));
    assert!(app.layout.pane_ids().contains(&new_id));
    assert!(app.layout.tab_group_containing(first_id).is_none());
    assert!(app.layout.tab_group_containing(second_id).is_none());
    assert!(app.layout.tab_group_containing(new_id).is_none());
    assert_eq!(app.focus.stage_focused, Some(new_id));
    assert!(matches!(
        app.panes.get(&new_id),
        Some(PaneKind::Terminal(_))
    ));
}

// --- UC-3: ResolveLauncher ---

#[test]
fn resolving_launcher_as_new_file_replaces_pane_kind_with_editor() {
    // UC-3 BR-7: Launcher is replaced in-place — PaneId does not change
    // Launchers now only exist in Dock, so test with a Dock Launcher
    let (mut app, _first_id) = app_with_editor();
    let launcher_id = app.layout.alloc_id();
    app.panes
        .insert(launcher_id, PaneKind::Launcher(launcher_id));
    assert!(matches!(
        app.panes.get(&launcher_id),
        Some(PaneKind::Launcher(_))
    ));

    app.resolve_launcher(launcher_id, crate::action::LauncherChoice::NewFile);
    assert!(matches!(
        app.panes.get(&launcher_id),
        Some(PaneKind::Editor(_))
    ));
}

// --- UC-4: OpenFile ---

#[test]
fn opening_same_file_twice_activates_existing_tab_instead() {
    // UC-4 BR-8: Opening an already-open file activates the existing tab (dedup)
    let (mut app, first_id) = app_with_editor();
    let test_path = std::path::PathBuf::from("/tmp/behavior_test_dedup.txt");
    // Write a temp file for testing
    let _ = std::fs::write(&test_path, "test content");

    app.open_editor_pane(test_path.clone());
    let editor_id = app.focus.focused.unwrap();
    assert_ne!(editor_id, first_id);

    // Refocus first pane
    app.focus.focused = Some(first_id);
    // Open same file again
    app.open_editor_pane(test_path.clone());
    // Should refocus the existing editor, not create a new one
    assert_eq!(app.focus.focused, Some(editor_id));
    let _ = std::fs::remove_file(&test_path);
}

#[test]
fn opening_file_defaults_to_right_split_when_focused_is_non_terminal() {
    // UC-4 BR-9a: Opening a new file defaults to a right-side split in Stage fallback.
    let (mut app, first_id) = app_with_editor();
    let test_path = std::path::PathBuf::from("/tmp/behavior_test_right_split.txt");
    let _ = std::fs::write(&test_path, "test content");

    app.open_editor_pane(test_path.clone());
    let new_id = app.focus.focused.unwrap();

    match app.layout.snapshot().expect("layout should exist") {
        crate::tide_layout::LayoutSnapshot::Split {
            direction, right, ..
        } => {
            assert_eq!(direction, SplitDirection::Vertical);
            assert!(
                layout_snapshot_contains(&right, new_id),
                "new file should open to the right of the focused Pane"
            );
        }
        other => panic!("expected right split after opening file, got {other:?}"),
    }
    assert!(app.layout.pane_ids().contains(&first_id));
    let _ = std::fs::remove_file(&test_path);
}

// --- UC-5: ClosePane ---

#[test]
fn closing_a_dirty_editor_with_file_shows_save_confirm() {
    // UC-5 BR-10: Dirty Editor with file_path → show SaveConfirm modal
    let (mut app, id) = app_with_editor();
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        pane.editor.insert_text("hello");
        pane.editor.buffer.file_path = Some(std::path::PathBuf::from("/tmp/test.txt"));
    }

    app.close_specific_pane(id);
    assert!(app.modal.save_confirm.is_some());
    assert_eq!(app.modal.save_confirm.as_ref().unwrap().pane_id, id);
}

#[test]
fn closing_a_dirty_untitled_editor_does_not_show_save_confirm() {
    // UC-5 BR-11: Dirty Editor without file_path → close immediately
    let (mut app, id) = app_with_editor();
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        pane.editor.insert_text("hello");
    }
    // Need a second pane so close doesn't exit
    app.new_editor_pane();
    let _second_id = app.focus.focused.unwrap();
    app.focus.focused = Some(id);

    app.close_specific_pane(id);
    assert!(app.modal.save_confirm.is_none());
}

#[test]
fn closing_browser_pane_moves_focus_to_another_pane() {
    // UC-5 BR-15: Browser Pane close preserves pane lifecycle invariants
    let (mut app, first_id) = app_with_browser();
    app.new_editor_pane();
    let second_id = app.focus.focused.unwrap();
    assert_eq!(app.panes.len(), 2);

    app.focus.focused = Some(first_id);
    app.close_specific_pane(first_id);

    assert_eq!(app.panes.len(), 1);
    assert_eq!(app.focus.focused, Some(second_id));
    assert!(matches!(
        app.panes.get(&second_id),
        Some(PaneKind::Editor(_))
    ));
    // Invariant: PaneId sync
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
}

#[test]
fn closing_browser_pane_with_pending_certificate_error_preserves_pane_lifecycle_invariants() {
    // UC-5 BR-16: Closing a Browser Pane with pending native Browser Pane state still preserves pane lifecycle invariants
    use crate::pane::browser::BrowserCertificateError;

    let (mut app, browser_id) = app_with_browser();
    app.new_editor_pane();
    let editor_id = app.focus.focused.unwrap();

    if let Some(PaneKind::Browser(browser)) = app.panes.get_mut(&browser_id) {
        browser.set_certificate_error(BrowserCertificateError {
            host: "localhost".to_string(),
            reason: "SelfSigned".to_string(),
        });
    }

    app.focus.focused = Some(browser_id);
    app.close_specific_pane(browser_id);

    assert_eq!(app.panes.len(), 1);
    assert_eq!(app.focus.focused, Some(editor_id));
    assert!(matches!(
        app.panes.get(&editor_id),
        Some(PaneKind::Editor(_))
    ));
    // Invariant: PaneId sync
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
}

#[test]
fn closing_editor_pane_moves_focus_to_another_pane() {
    // UC-5 BR-12: After close, focus moves to an adjacent Pane
    let (mut app, _first_id) = app_with_editor();
    app.new_editor_pane();
    let second_id = app.focus.focused.unwrap();
    assert_eq!(app.panes.len(), 2);

    app.force_close_editor_panel_tab(second_id);
    assert_eq!(app.panes.len(), 1);
    assert!(app.focus.focused.is_some());
    assert_ne!(app.focus.focused, Some(second_id));
    // Invariant: PaneId sync
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
}

#[test]
fn closing_pane_in_vertical_split_focuses_right_neighbor() {
    // UC-5 BR-12: After closing a pane, focus moves to right neighbor
    // Layout: Vertical(A, B) — closing A focuses B
    let (mut app, left_id) = app_with_editor();
    let right_id = app
        .layout
        .split(left_id, crate::tide_core::SplitDirection::Vertical);
    app.panes.insert(
        right_id,
        PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(right_id)),
    );
    app.focus.focused = Some(left_id);

    // Close left pane — right neighbor (right_id) should get focus
    app.force_close_editor_panel_tab(left_id);
    assert_eq!(app.focus.focused, Some(right_id));
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
}

#[test]
fn closing_only_pane_in_split_focuses_neighbor() {
    // UC-5 BR-12: When a pane is closed, focus moves to remaining pane
    // Layout: Split { left: A, right: B(focused) }
    let (mut app, left_id) = app_with_editor();
    let right_id = app
        .layout
        .split(left_id, crate::tide_core::SplitDirection::Vertical);
    app.panes.insert(
        right_id,
        PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(right_id)),
    );
    app.focus.focused = Some(right_id);

    app.force_close_editor_panel_tab(right_id);
    // Focus should move to left_id (the remaining pane)
    assert_eq!(app.focus.focused, Some(left_id));
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
}

#[test]
fn closing_focused_stacked_stage_pane_focuses_previous_flat_pane() {
    // UC-5 BR-12b: Stage ViewMode::Stacked close uses the flat stacked order and prefers the Pane immediately to the left.
    let (mut app, first_id) = app_with_editor();
    app.new_editor_pane();
    let second_id = app.focus.focused.unwrap();
    app.new_editor_pane();
    let third_id = app.focus.focused.unwrap();

    assert_eq!(app.layout.pane_ids(), vec![first_id, second_id, third_id]);
    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(third_id);
    app.router.set_focused(third_id);
    app.handle_toggle_stacked();
    assert_eq!(app.focus.zoomed_pane, Some(third_id));

    app.force_close_editor_panel_tab(third_id);

    assert_eq!(app.focus.focused, Some(second_id));
    assert_eq!(app.focus.zoomed_pane, Some(second_id));
    assert_eq!(app.layout.pane_ids(), vec![first_id, second_id]);
}

#[test]
fn cancel_save_confirm_clears_the_modal() {
    // UC-5 BR-14: Cancel on SaveConfirm clears the modal without closing
    let (mut app, id) = app_with_editor();
    app.modal.save_confirm = Some(crate::SaveConfirmState { pane_id: id });
    app.cancel_save_confirm();
    assert!(app.modal.save_confirm.is_none());
}

#[test]
fn mouse_release_clears_hover_target_immediately() {
    // UC-6 BR-19: Mouse release clears the current hover target immediately so hover visuals do not wait for the next mouse move
    let (mut app, id) = app_with_editor();
    app.interaction.hover_target = Some(crate::state::drag_types::HoverTarget::PaneContent);

    crate::adapter::inward::mouse_adapter::handle_mouse_up(
        &mut app,
        crate::tide_core::MouseButton::Left,
    );

    assert!(app.interaction.hover_target.is_none());
    assert_eq!(app.focus.focused, Some(id));
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
}

#[test]
fn mouse_release_still_completes_border_drag_cleanup() {
    // UC-6 BR-20: Mouse release still completes border-drag cleanup before returning
    let (mut app, id) = app_with_editor();
    app.ft.border_dragging = true;
    app.interaction.hover_target = Some(crate::state::drag_types::HoverTarget::SplitBorder(
        crate::tide_core::SplitDirection::Horizontal,
    ));

    crate::adapter::inward::mouse_adapter::handle_mouse_up(
        &mut app,
        crate::tide_core::MouseButton::Left,
    );

    assert!(app.interaction.hover_target.is_none());
    assert!(!app.ft.border_dragging);
    assert_eq!(app.focus.focused, Some(id));
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
}

#[test]
fn titlebar_surface_buttons_recompute_hover_target_on_mouse_down() {
    // UC-6 BR-21: Mouse down recomputes titlebar hover target so surface buttons can be clicked repeatedly without mouse movement.
    let mut app = test_app();
    app.create_initial_pane(None);
    let window = test_window_proxy();

    app.ft.visible = false;
    app.window.last_cursor_pos =
        titlebar_surface_button_center(&app, TitlebarSurfaceButton::FileTree);
    app.interaction.hover_target = None;
    crate::adapter::inward::mouse_adapter::handle_mouse_down(&mut app, MouseButton::Left, &window);
    assert!(app.ft.visible);
    crate::adapter::inward::mouse_adapter::handle_mouse_up(&mut app, MouseButton::Left);
    assert!(app.interaction.hover_target.is_none());
    crate::adapter::inward::mouse_adapter::handle_mouse_down(&mut app, MouseButton::Left, &window);
    assert!(!app.ft.visible);

    app.ws.show_sidebar = false;
    app.window.last_cursor_pos =
        titlebar_surface_button_center(&app, TitlebarSurfaceButton::Workspace);
    app.interaction.hover_target = None;
    crate::adapter::inward::mouse_adapter::handle_mouse_down(&mut app, MouseButton::Left, &window);
    assert!(app.ws.show_sidebar);

    app.dock.dock_open = false;
    app.window.last_cursor_pos = titlebar_surface_button_center(&app, TitlebarSurfaceButton::Dock);
    app.interaction.hover_target = None;
    crate::adapter::inward::mouse_adapter::handle_mouse_down(&mut app, MouseButton::Left, &window);
    assert!(app.dock.dock_open);
}

#[test]
fn file_tree_border_drag_uses_widened_hit_slop() {
    // UC-6 BR-22: FileTree View border drag uses the widened side-surface border hit slop for hover and mouse-down acquisition.
    let mut app = app_with_file_tree_view();
    let window = test_window_proxy();
    let file_tree_rect = app.ft.rect.expect("FileTree View rect should exist");
    let pos = Vec2::new(
        file_tree_rect.x + SIDE_SURFACE_BORDER_HIT_SLOP - 1.0,
        file_tree_rect.y + file_tree_rect.height / 2.0,
    );

    assert_eq!(
        crate::adapter::inward::click_adapter::hit_test::compute_hover_target(&app, pos),
        Some(crate::state::drag_types::HoverTarget::FileTreeBorder)
    );

    app.window.last_cursor_pos = pos;
    crate::adapter::inward::mouse_adapter::handle_mouse_down(&mut app, MouseButton::Left, &window);

    assert!(app.ft.border_dragging);
}

#[test]
fn dock_border_drag_uses_widened_hit_slop() {
    // UC-6 BR-22: Terminal Context Surface border drag uses the widened side-surface border hit slop for hover and mouse-down acquisition.
    let mut app = app_with_terminal_context_surface();
    let window = test_window_proxy();
    let pane_area_rect = app.pane_area_rect.expect("Stage rect should exist");
    let border_x = pane_area_rect.x + pane_area_rect.width;
    let pos = Vec2::new(
        border_x - (SIDE_SURFACE_BORDER_HIT_SLOP - 1.0),
        pane_area_rect.y + pane_area_rect.height / 2.0,
    );

    assert_eq!(
        crate::adapter::inward::click_adapter::hit_test::compute_hover_target(&app, pos),
        Some(crate::state::drag_types::HoverTarget::DockBorder)
    );

    app.window.last_cursor_pos = pos;
    crate::adapter::inward::mouse_adapter::handle_mouse_down(&mut app, MouseButton::Left, &window);

    assert!(app.dock.dock_border_dragging);
}
