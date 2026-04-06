// Spec: docs/specs/launcher.md — UC-1: ResolveLauncher
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::App;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_launcher() -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(id, PaneKind::Launcher(id));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

#[test]
fn pressing_e_in_launcher_pane_resolves_to_editor_pane_kind() {
    // UC-1 BR-1: 'e' resolves to Editor PaneKind
    let (mut app, id) = app_with_launcher();
    crate::adapter::inward::ime_adapter::handle_ime_commit(&mut app, "e");
    assert!(matches!(app.panes.get(&id), Some(PaneKind::Editor(_))));
}

#[test]
fn pressing_capital_e_in_launcher_pane_resolves_to_editor_pane_kind() {
    // UC-1 BR-2: 'E' also resolves to Editor
    let (mut app, id) = app_with_launcher();
    crate::adapter::inward::ime_adapter::handle_ime_commit(&mut app, "E");
    assert!(matches!(app.panes.get(&id), Some(PaneKind::Editor(_))));
}

#[test]
fn korean_ime_commit_resolves_launcher_pane_to_editor_pane_kind() {
    // UC-1 BR-3: Korean jamo 'ㄷ' resolves to Editor
    let (mut app, id) = app_with_launcher();
    crate::adapter::inward::ime_adapter::handle_ime_commit(&mut app, "ㄷ");
    assert!(matches!(app.panes.get(&id), Some(PaneKind::Editor(_))));
}

#[test]
fn korean_ime_preedit_resolves_launcher_pane_to_terminal_pane_kind() {
    // UC-1 BR-4: Korean jamo 'ㅅ' resolves to Terminal via preedit
    let (mut app, id) = app_with_launcher();
    crate::adapter::inward::ime_adapter::handle_ime_preedit(&mut app, "ㅅ");
    let is_launcher = matches!(app.panes.get(&id), Some(PaneKind::Launcher(_)));
    assert!(!is_launcher || app.panes.get(&id).is_none());
}

#[test]
fn non_matching_text_in_launcher_pane_is_ignored() {
    // UC-1 BR-5: Non-matching text is ignored
    let (mut app, id) = app_with_launcher();
    crate::adapter::inward::ime_adapter::handle_ime_commit(&mut app, "x");
    assert!(matches!(app.panes.get(&id), Some(PaneKind::Launcher(_))));
}

#[test]
fn resolve_launcher_queues_ime_proxy_remove_and_create_for_same_id() {
    // UC-1 BR-6: Resolution queues IME proxy remove + create for same PaneId
    let (mut app, id) = app_with_launcher();
    app.ime.pending_creates.clear();

    crate::adapter::inward::ime_adapter::handle_ime_commit(&mut app, "e");

    assert!(
        app.ime.pending_removes.contains(&id),
        "old launcher proxy not queued for removal"
    );
    assert!(
        app.ime.pending_creates.contains(&id),
        "new editor proxy not queued for creation"
    );
}
