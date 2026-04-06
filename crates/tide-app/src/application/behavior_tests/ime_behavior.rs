// Spec: docs/specs/ime.md
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::search::SearchState;
use crate::state::{ContextCommentComposerState, FocusArea, ImeState, InputLine};
use crate::tide_core::LayoutEngine;
use crate::tide_layout::SplitLayout;
use crate::update::workspace_infra_service::Workspace;
use crate::App;
use crate::AppCorePort;
use crate::PaneLifecyclePort;
use std::collections::HashMap;

// --- UC-1: Composition ---

#[test]
fn new_ime_state_is_not_composing() {
    // UC-1 BR-1: New ImeState is not composing
    let state = ImeState::new();
    assert!(!state.composing);
    assert!(state.preedit.is_empty());
}

#[test]
fn set_preedit_with_text_starts_composition() {
    // UC-1 BR-2: set_preedit with text starts composition
    let mut state = ImeState::new();
    state.set_preedit("ㅎ");
    assert!(state.composing);
    assert_eq!(state.preedit, "ㅎ");
}

#[test]
fn set_preedit_with_empty_string_ends_composition() {
    // UC-1 BR-3: set_preedit with empty string ends composition
    let mut state = ImeState::new();
    state.set_preedit("ㅎ");
    state.set_preedit("");
    assert!(!state.composing);
    assert!(state.preedit.is_empty());
}

#[test]
fn clear_composition_resets_all_state() {
    // UC-1 BR-4: clear_composition resets all state
    let mut state = ImeState::new();
    state.composing = true;
    state.preedit = "한".to_string();
    state.clear_composition();
    assert!(!state.composing);
    assert!(state.preedit.is_empty());
}

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_two_workspaces() -> App {
    let mut app = test_app();
    let id1: u64 = 100;
    let id2: u64 = 200;
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
    app.panes = HashMap::new();
    app.panes
        .insert(id1, PaneKind::Editor(EditorPane::new_empty(id1)));
    app.focus.focused = Some(id1);
    app.focus.focus_area = FocusArea::Stage;
    app.save_active_workspace();
    app.ws.active = 1;
    app.panes = HashMap::new();
    app.panes
        .insert(id2, PaneKind::Editor(EditorPane::new_empty(id2)));
    app.focus.focused = Some(id2);
    app.save_active_workspace();
    app.ws.active = 0;
    app.load_active_workspace();
    app
}

fn app_with_editor() -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes
        .insert(id, PaneKind::Editor(EditorPane::new_empty(id)));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

// --- UC-2: CompositionCleanup ---

#[test]
fn workspace_switch_clears_composition() {
    // UC-2 BR-5: Workspace switch clears composition
    let mut app = app_with_two_workspaces();
    app.ime.composing = true;
    app.ime.preedit = "ㅎ".to_string();
    app.ime.last_target = Some(100);

    app.switch_workspace(1);

    assert!(!app.ime.composing);
    assert!(app.ime.preedit.is_empty());
    assert_eq!(app.ime.last_target, None);
}

#[test]
fn workspace_switch_without_composition_does_not_affect_ime() {
    // UC-2 BR-6: Workspace switch without composition does not affect IME
    let mut app = app_with_two_workspaces();
    assert!(!app.ime.composing);

    app.switch_workspace(1);

    assert!(!app.ime.composing);
    assert!(app.ime.preedit.is_empty());
}

#[test]
fn closing_pane_that_is_ime_target_clears_composition() {
    // UC-2 BR-7: Closing Pane that is IME target clears composition
    let mut app = test_app();
    let (layout, id1) = SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes
        .insert(id1, PaneKind::Editor(EditorPane::new_empty(id1)));
    let id2 = app
        .layout
        .split(id1, crate::tide_core::SplitDirection::Vertical);
    app.panes
        .insert(id2, PaneKind::Editor(EditorPane::new_empty(id2)));
    app.focus.focused = Some(id1);
    app.focus.focus_area = FocusArea::Stage;

    app.ime.composing = true;
    app.ime.preedit = "한".to_string();
    app.ime.last_target = Some(id1);

    app.force_close_editor_panel_tab(id1);

    assert!(!app.ime.composing);
    assert!(app.ime.preedit.is_empty());
    assert_eq!(app.ime.last_target, None);
}

#[test]
fn closing_pane_that_is_not_ime_target_preserves_composition() {
    // UC-2 BR-8: Closing Pane that is NOT IME target preserves composition
    let mut app = test_app();
    let (layout, id1) = SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes
        .insert(id1, PaneKind::Editor(EditorPane::new_empty(id1)));
    let id2 = app
        .layout
        .split(id1, crate::tide_core::SplitDirection::Vertical);
    app.panes
        .insert(id2, PaneKind::Editor(EditorPane::new_empty(id2)));
    app.focus.focused = Some(id1);
    app.focus.focus_area = FocusArea::Stage;

    app.ime.composing = true;
    app.ime.preedit = "한".to_string();
    app.ime.last_target = Some(id1);

    app.force_close_editor_panel_tab(id2);

    assert!(app.ime.composing);
    assert_eq!(app.ime.preedit, "한");
    assert_eq!(app.ime.last_target, Some(id1));
}

// --- UC-3: CLI focus-pane updates effective IME target ---

#[test]
fn cli_focus_pane_updates_effective_ime_target() {
    // UC-3 BR-9: After cli focus-pane, effective_ime_target returns the new pane
    use serde_json::json;
    let mut app = test_app();
    let (layout, id1) = SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes
        .insert(id1, PaneKind::Editor(EditorPane::new_empty(id1)));
    let id2 = app
        .layout
        .split(id1, crate::tide_core::SplitDirection::Vertical);
    app.panes
        .insert(id2, PaneKind::Editor(EditorPane::new_empty(id2)));
    app.focus.focused = Some(id1);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(id1);

    // Simulate CLI focus-pane changing to id2
    let _ = app.handle_cli_command("focus-pane", json!({"pane_id": id2}));

    // effective_ime_target should return the newly focused pane
    assert_eq!(app.focus.focused, Some(id2));
    assert_eq!(app.effective_ime_target(), Some(id2));
}

#[test]
fn cli_focus_pane_with_active_composition_commits_to_old_target() {
    // UC-3 BR-10: CLI focus-pane during IME composition — the sync_ime_proxies
    // call (in the event loop) will detect the target change and commit preedit
    // to the old target. Here we verify that ime state is set up correctly for
    // the sync to detect the change.
    use serde_json::json;
    let mut app = test_app();
    let (layout, id1) = SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes
        .insert(id1, PaneKind::Editor(EditorPane::new_empty(id1)));
    let id2 = app
        .layout
        .split(id1, crate::tide_core::SplitDirection::Vertical);
    app.panes
        .insert(id2, PaneKind::Editor(EditorPane::new_empty(id2)));
    app.focus.focused = Some(id1);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(id1);

    // Simulate active Korean IME composition
    app.ime.composing = true;
    app.ime.preedit = "한".to_string();
    app.ime.last_target = Some(id1);

    // CLI focus-pane changes focus
    let _ = app.handle_cli_command("focus-pane", json!({"pane_id": id2}));

    // Focus should have changed but IME last_target still points to old pane
    // (sync_ime_proxies in the event loop will detect the mismatch and commit)
    assert_eq!(app.focus.focused, Some(id2));
    assert_eq!(app.effective_ime_target(), Some(id2));
    // last_target still holds old pane — sync_ime_proxies will handle the commit
    assert_eq!(app.ime.last_target, Some(id1));
}

// --- UC-4: OverlayComposition ---

#[test]
fn ime_preedit_with_search_focus_invalidates_chrome() {
    // UC-4 BR-11: IME preedit with an active Search Bar invalidates chrome and redraws inline in the Search Bar.
    let (mut app, id) = app_with_editor();
    app.focus.search_focus = Some(id);
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&id) {
        let mut search = SearchState::new();
        search.input = crate::state::InputLine::with_text("ab".to_string());
        editor.search = Some(search);
    }

    let before = app.cache.chrome_generation;
    crate::adapter::inward::ime_adapter::handle_ime_preedit(&mut app, "ㅎ");

    assert_eq!(app.ime.preedit, "ㅎ");
    assert!(app.cache.chrome_generation > before);
}

#[test]
fn ime_preedit_with_context_comment_composer_invalidates_chrome() {
    // UC-4 BR-12: IME preedit with an open Context Comment Composer invalidates chrome and redraws inline in the composer input.
    let (mut app, id) = app_with_editor();
    app.modal.context_comment_composer = Some(ContextCommentComposerState::new(
        id,
        id,
        "editor".to_string(),
        None,
        "selection".to_string(),
    ));

    let before = app.cache.chrome_generation;
    crate::adapter::inward::ime_adapter::handle_ime_preedit(&mut app, "ㅎ");

    assert_eq!(app.ime.preedit, "ㅎ");
    assert!(app.cache.chrome_generation > before);
}

#[test]
fn search_bar_ime_cursor_area_tracks_search_caret() {
    // UC-4 BR-13: The Search Bar provides the IME cursor area while it is the active text input.
    let (mut app, id) = app_with_editor();
    app.visual_pane_rects
        .push((id, crate::tide_core::Rect::new(10.0, 20.0, 400.0, 240.0)));
    app.focus.search_focus = Some(id);
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&id) {
        let mut search = SearchState::new();
        search.input = crate::state::InputLine::with_text("ab".to_string());
        editor.search = Some(search);
    }

    let (target_id, rect) = crate::adapter::inward::event_loop_adapter::overlay_ime_cursor_area(
        app.focus.focused,
        app.focus.search_focus,
        &app.modal,
        &app.panes,
        &app.visual_pane_rects,
        app.logical_size(),
        app.cell_size(),
        &app.ime.preedit,
    )
    .expect("search bar should provide ime cursor area");

    let pane_rect = app.visual_pane_rects[0].1;
    let bar_w = crate::theme::SEARCH_BAR_WIDTH.min(pane_rect.width - 16.0);
    let expected_x =
        pane_rect.x + pane_rect.width - bar_w - 8.0 + 6.0 + 2.0 * app.cell_size().width;
    let expected_y = pane_rect.y
        + crate::theme::TAB_BAR_HEIGHT
        + 4.0
        + (crate::theme::SEARCH_BAR_HEIGHT - app.cell_size().height) / 2.0;

    assert_eq!(target_id, id);
    assert_eq!(rect.width, app.cell_size().width);
    assert_eq!(rect.height, app.cell_size().height);
    assert_eq!(rect.x, expected_x);
    assert_eq!(rect.y, expected_y);
}

#[test]
fn context_comment_composer_ime_cursor_area_tracks_composer_caret() {
    // UC-4 BR-14: The Context Comment Composer provides the IME cursor area while it is the active text input.
    let (mut app, id) = app_with_editor();
    let mut composer = ContextCommentComposerState::new(
        id,
        id,
        "editor".to_string(),
        None,
        "selection".to_string(),
    );
    composer.comment = crate::state::InputLine::with_text("ab".to_string());
    app.modal.context_comment_composer = Some(composer);

    let (target_id, rect) = crate::adapter::inward::event_loop_adapter::overlay_ime_cursor_area(
        app.focus.focused,
        app.focus.search_focus,
        &app.modal,
        &app.panes,
        &app.visual_pane_rects,
        app.logical_size(),
        app.cell_size(),
        &app.ime.preedit,
    )
    .expect("context comment composer should provide ime cursor area");

    let logical = app.logical_size();
    let popup_w = if logical.width > 560.0 {
        (logical.width - 48.0).min(760.0).max(520.0)
    } else {
        (logical.width - 24.0).max(320.0)
    };
    let popup_h = if logical.height > 420.0 {
        (logical.height - 48.0).min(520.0).max(320.0)
    } else {
        (logical.height - 24.0).max(260.0)
    };
    let popup_x = (logical.width - popup_w) / 2.0;
    let popup_y = (logical.height - popup_h) / 2.0;
    let line_h = app.cell_size().height + 6.0;
    let mut input_y = popup_y + 16.0;
    input_y += line_h + 4.0;
    input_y += line_h;
    input_y += line_h + 8.0;
    input_y += line_h;
    input_y += 5.0 * line_h + 12.0;
    input_y += line_h;
    let input_h = line_h + 4.0;
    let expected_x = popup_x + 18.0 + 10.0 + 2.0 * app.cell_size().width;
    let expected_y = input_y + (input_h - app.cell_size().height) / 2.0;

    assert_eq!(target_id, id);
    assert_eq!(rect.width, app.cell_size().width);
    assert_eq!(rect.height, app.cell_size().height);
    assert_eq!(rect.x, expected_x);
    assert_eq!(rect.y, expected_y);
}

#[test]
fn context_comment_composer_long_hangul_input_keeps_text_and_caret_aligned() {
    // UC-4 BR-16: Long Korean Context Comment Composer composition keeps committed text, preedit, wrapped-row caret, and IME cursor area aligned.
    let (mut app, id) = app_with_editor();
    let mut composer = ContextCommentComposerState::new(
        id,
        id,
        "editor".to_string(),
        None,
        "selection".to_string(),
    );
    composer.comment = InputLine::with_text("가".repeat(80));
    app.modal.context_comment_composer = Some(composer);
    app.ime.preedit = "한글".to_string();

    let (_target_id, rect) = crate::adapter::inward::event_loop_adapter::overlay_ime_cursor_area(
        app.focus.focused,
        app.focus.search_focus,
        &app.modal,
        &app.panes,
        &app.visual_pane_rects,
        app.logical_size(),
        app.cell_size(),
        &app.ime.preedit,
    )
    .expect("context comment composer should provide ime cursor area");

    let logical = app.logical_size();
    let popup_w = if logical.width > 560.0 {
        (logical.width - 48.0).min(760.0).max(520.0)
    } else {
        (logical.width - 24.0).max(320.0)
    };
    let popup_h = if logical.height > 420.0 {
        (logical.height - 48.0).min(520.0).max(320.0)
    } else {
        (logical.height - 24.0).max(260.0)
    };
    let popup_x = (logical.width - popup_w) / 2.0;
    let popup_y = (logical.height - popup_h) / 2.0;
    let line_h = app.cell_size().height + 6.0;
    let mut input_y = popup_y + 16.0;
    input_y += line_h + 4.0;
    input_y += line_h;
    input_y += line_h + 8.0;
    input_y += line_h;
    input_y += 5.0 * line_h + 12.0;
    input_y += line_h;

    let text_left = popup_x + 18.0 + 10.0;
    let text_right = popup_x + popup_w - 18.0 - 10.0;
    let first_row_y = input_y + ((line_h + 4.0) - app.cell_size().height) / 2.0;

    assert!(
        rect.x >= text_left && rect.x <= text_right,
        "IME cursor should stay inside the visible composer input width"
    );
    assert!(
        rect.y > first_row_y,
        "long wrapped composer input should move the IME cursor to a later visual row"
    );
}

#[test]
fn search_bar_long_hangul_input_keeps_text_and_caret_aligned() {
    // UC-4 BR-15: Long Korean Search Bar composition keeps committed text, preedit, caret, and IME cursor area aligned.
    let (mut app, id) = app_with_editor();
    app.visual_pane_rects
        .push((id, crate::tide_core::Rect::new(10.0, 20.0, 400.0, 240.0)));
    app.focus.search_focus = Some(id);
    app.ime.preedit = "입력".to_string();
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&id) {
        let mut search = SearchState::new();
        search.input = crate::state::InputLine::with_text("한글ab".to_string());
        editor.search = Some(search);
    }

    let (target_id, rect) = crate::adapter::inward::event_loop_adapter::overlay_ime_cursor_area(
        app.focus.focused,
        app.focus.search_focus,
        &app.modal,
        &app.panes,
        &app.visual_pane_rects,
        app.logical_size(),
        app.cell_size(),
        &app.ime.preedit,
    )
    .expect("search bar should provide ime cursor area");

    let pane_rect = app.visual_pane_rects[0].1;
    let bar_w = crate::theme::SEARCH_BAR_WIDTH.min(pane_rect.width - 16.0);
    let expected_x = pane_rect.x + pane_rect.width - bar_w - 8.0
        + 6.0
        + crate::adapter::outward::view::overlays::search_bar_cursor_advance_cells(
            "한글ab",
            "한글ab".len(),
            &app.ime.preedit,
        ) as f32
            * app.cell_size().width;

    assert_eq!(target_id, id);
    assert_eq!(rect.x, expected_x);
}
