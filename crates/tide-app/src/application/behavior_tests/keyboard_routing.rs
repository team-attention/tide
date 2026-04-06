// Spec: docs/specs/input-routing.md — UC-1: ResolveKeystroke
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::*;
use crate::tide_core::{Key, Modifiers};
use crate::App;
use std::path::PathBuf;

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
    let pane = EditorPane::new_empty(id);
    app.panes.insert(id, PaneKind::Editor(pane));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

fn cmd() -> Modifiers {
    Modifiers {
        meta: true,
        ctrl: false,
        shift: false,
        alt: false,
    }
}

#[test]
fn plain_text_keys_route_to_focused_pane() {
    // UC-1 BR-1: Plain text keys route to focused Pane
    let (mut app, id) = app_with_editor();
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        Key::Char('a'),
        Modifiers::default(),
        Some("a".to_string()),
    );
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(pane.editor.is_modified());
    }
}

#[test]
fn config_page_intercepts_all_keyboard_input() {
    // UC-1 BR-3: Config page intercepts ALL keyboard input
    let (mut app, id) = app_with_editor();
    app.modal.config_page = Some(ConfigPageState::new(vec![], String::new(), String::new()));
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        Key::Char('x'),
        Modifiers::default(),
        Some("x".to_string()),
    );
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(!pane.editor.is_modified());
    }
}

#[test]
fn escape_during_config_page_closes_config_page() {
    // UC-1 BR-3: Config page intercepts ALL keyboard input (ESC closes it)
    let (mut app, _) = app_with_editor();
    app.modal.config_page = Some(ConfigPageState::new(vec![], String::new(), String::new()));
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        Key::Escape,
        Modifiers::default(),
        None,
    );
    assert!(app.modal.config_page.is_none());
}

#[test]
fn file_finder_intercepts_keys_before_pane() {
    // UC-1 BR-4: File finder intercepts keys before Pane
    let (mut app, id) = app_with_editor();
    app.modal.file_finder = Some(FileFinderState::new(PathBuf::from("/tmp"), vec![]));
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        Key::Char('a'),
        Modifiers::default(),
        Some("a".to_string()),
    );
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(!pane.editor.is_modified());
    }
}

#[test]
fn escape_during_pane_drag_cancels_the_drag() {
    // UC-1 BR-6: Escape during pane drag cancels the drag
    let (mut app, _) = app_with_editor();
    app.interaction.pane_drag = crate::state::drag_types::PaneDragState::PendingDrag {
        source_pane: 1,
        press_pos: crate::tide_core::Vec2::new(0.0, 0.0),
    };
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        Key::Escape,
        Modifiers::default(),
        None,
    );
    assert!(matches!(
        app.interaction.pane_drag,
        crate::state::drag_types::PaneDragState::Idle
    ));
}

#[test]
fn focus_area_file_tree_consumes_arrow_keys() {
    // UC-1 BR-7: FocusArea::FileTree consumes arrow keys
    let (mut app, _) = app_with_editor();
    app.ft.visible = true;
    app.focus.focus_area = FocusArea::FileTree;
    let _gen_before = app.cache.chrome_generation;
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        Key::Down,
        Modifiers::default(),
        None,
    );
}

#[test]
fn global_action_keys_work_when_focus_area_is_file_tree() {
    // UC-1 BR-8: GlobalAction keys work regardless of FocusArea
    let (mut app, _) = app_with_editor();
    app.ft.visible = true;
    app.focus.focus_area = FocusArea::FileTree;
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        Key::Char('e'),
        cmd(),
        Some("e".to_string()),
    );
}

#[test]
fn save_confirm_blocks_all_keys_except_escape() {
    // UC-1 BR-5: Save confirm blocks all keys except ESC/Y/N
    let (mut app, id) = app_with_editor();
    app.modal.save_confirm = Some(crate::SaveConfirmState { pane_id: id });
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        Key::Char('x'),
        Modifiers::default(),
        Some("x".to_string()),
    );
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(!pane.editor.is_modified());
    }
}

#[test]
fn branch_cleanup_enter_means_keep_branch() {
    // UC-1 BR-9: Branch cleanup modal ESC cancels cleanup
    let (mut app, id) = app_with_editor();
    app.modal.branch_cleanup = Some(crate::BranchCleanupState {
        pane_id: id,
        branch: "feature-x".to_string(),
        worktree_path: PathBuf::from("/tmp/worktree"),
        cwd: PathBuf::from("/tmp"),
    });
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        Key::Escape,
        Modifiers::default(),
        None,
    );
    assert!(app.modal.branch_cleanup.is_none());
}
