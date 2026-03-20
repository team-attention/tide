// Spec: docs/specs/ime.md
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::{FocusArea, ImeState};
use crate::update::workspace_infra_service::Workspace;
use crate::App;
use crate::PaneLifecyclePort;
use std::collections::HashMap;
use crate::tide_core::LayoutEngine;
use crate::tide_layout::SplitLayout;

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
    app.panes.insert(id1, PaneKind::Editor(EditorPane::new_empty(id1)));
    app.focus.focused = Some(id1);
    app.focus.focus_area = FocusArea::Stage;
    app.save_active_workspace();
    app.ws.active = 1;
    app.panes = HashMap::new();
    app.panes.insert(id2, PaneKind::Editor(EditorPane::new_empty(id2)));
    app.focus.focused = Some(id2);
    app.save_active_workspace();
    app.ws.active = 0;
    app.load_active_workspace();
    app
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
    app.panes.insert(id1, PaneKind::Editor(EditorPane::new_empty(id1)));
    let id2 = app.layout.split(id1, crate::tide_core::SplitDirection::Vertical);
    app.panes.insert(id2, PaneKind::Editor(EditorPane::new_empty(id2)));
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
    app.panes.insert(id1, PaneKind::Editor(EditorPane::new_empty(id1)));
    let id2 = app.layout.split(id1, crate::tide_core::SplitDirection::Vertical);
    app.panes.insert(id2, PaneKind::Editor(EditorPane::new_empty(id2)));
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
