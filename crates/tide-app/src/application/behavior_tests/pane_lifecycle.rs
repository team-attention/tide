use crate::pane::browser::BrowserPane;
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::tide_core::LayoutEngine;
use crate::App;
use crate::PaneLifecyclePort;

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

// Spec: docs/specs/pane-lifecycle.md

// --- UC-1: CreateTab ---

#[test]
fn new_editor_pane_adds_to_focused_tab_group() {
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
    // UC-1 BR-1: New tab in Stage creates a Terminal directly (added to TabGroup)
    let (mut app, _) = app_with_editor();
    app.new_terminal_tab();
    let new_id = app.focus.focused.unwrap();
    assert!(matches!(
        app.panes.get(&new_id),
        Some(PaneKind::Terminal(_))
    ));
    // Invariant: PaneId sync (all_pane_ids includes inactive TabGroup tabs)
    assert_eq!(app.layout.all_pane_ids().len(), app.panes.len());
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
fn split_unzooms_focused_pane() {
    // UC-2 BR-5: If Pane was zoomed, unzoom before splitting
    let (mut app, first_id) = app_with_editor();
    app.focus.zoomed_pane = Some(first_id);
    app.split_with_launcher(crate::tide_core::SplitDirection::Vertical);
    assert!(app.focus.zoomed_pane.is_none());
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
fn closing_pane_in_horizontal_split_focuses_right_neighbor() {
    // UC-5 BR-12: After closing a pane, focus moves to right neighbor
    // Layout: H(A, B(focused)) — closing B focuses A
    let (mut app, left_id) = app_with_editor();
    let right_id = app
        .layout
        .split(left_id, crate::tide_core::SplitDirection::Horizontal);
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
fn cancel_save_confirm_clears_the_modal() {
    // UC-5 BR-14: Cancel on SaveConfirm clears the modal without closing
    let (mut app, id) = app_with_editor();
    app.modal.save_confirm = Some(crate::SaveConfirmState { pane_id: id });
    app.cancel_save_confirm();
    assert!(app.modal.save_confirm.is_none());
}
