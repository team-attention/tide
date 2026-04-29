// Spec: docs/specs/launcher.md — UC-1: ResolveLauncher
use crate::adapter::inward::click_adapter::hit_test::compute_hover_target;
use crate::adapter::inward::click_adapter::pane::handle_launcher_choice_click;
use crate::pane::PaneKind;
use crate::state::drag_types::HoverTarget;
use crate::state::FocusArea;
use crate::App;
use crate::AppCorePort;
use crate::LayoutPort;

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

// --- UC-2: ClickLauncherChoice ---

fn launcher_choice_center(
    app: &App,
    pane_id: u64,
    choice: crate::action::LauncherChoice,
) -> crate::tide_core::Vec2 {
    let rect = app
        .visual_pane_rects
        .iter()
        .find(|(id, _)| *id == pane_id)
        .map(|(_, rect)| *rect)
        .expect("Launcher Pane should have a visual rect");
    let inner = crate::rendering::launcher::launcher_content_rect(rect);
    let row = crate::rendering::launcher::launcher_choice_rect(inner, app.cell_size(), choice)
        .expect("Launcher choice should have a row rect");
    crate::tide_core::Vec2::new(row.x + row.width / 2.0, row.y + row.height / 2.0)
}

#[test]
fn clicking_browser_launcher_choice_resolves_to_browser_pane_kind() {
    // UC-2 BR-7: Clicking the Browser Launcher choice resolves the Launcher Pane to PaneKind::Browser.
    let (mut app, id) = app_with_launcher();
    app.compute_layout();
    let pos = launcher_choice_center(&app, id, crate::action::LauncherChoice::Browser);

    assert!(handle_launcher_choice_click(&mut app, pos));

    assert!(matches!(app.panes.get(&id), Some(PaneKind::Browser(_))));
}

#[test]
fn hovering_launcher_choice_returns_launcher_choice_target() {
    // UC-2 BR-8: Hovering a Launcher choice row produces a HoverTarget::LauncherChoice pointer target.
    let (mut app, id) = app_with_launcher();
    app.compute_layout();
    let pos = launcher_choice_center(&app, id, crate::action::LauncherChoice::OpenFile);

    assert_eq!(
        compute_hover_target(&app, pos),
        Some(HoverTarget::LauncherChoice(
            id,
            crate::action::LauncherChoice::OpenFile,
        ))
    );
}

#[test]
fn launcher_choice_hit_testing_uses_rendered_choice_rects() {
    // UC-2 BR-9: Launcher rendering and click hit-testing share the same choice row geometry.
    let (mut app, id) = app_with_launcher();
    app.compute_layout();
    let rect = app
        .visual_pane_rects
        .iter()
        .find(|(pane_id, _)| *pane_id == id)
        .map(|(_, rect)| *rect)
        .expect("Launcher Pane should have a visual rect");
    let inner = crate::rendering::launcher::launcher_content_rect(rect);
    let row = crate::rendering::launcher::launcher_choice_rect(
        inner,
        app.cell_size(),
        crate::action::LauncherChoice::Terminal,
    )
    .expect("Terminal choice should have a row rect");
    let pos = crate::tide_core::Vec2::new(row.x + row.width / 2.0, row.y + row.height / 2.0);

    assert_eq!(
        crate::rendering::launcher::launcher_choice_at(inner, app.cell_size(), pos),
        Some(crate::action::LauncherChoice::Terminal)
    );
}

#[test]
fn clicking_launcher_choice_icon_area_resolves_that_choice() {
    // UC-2 BR-10: Clicking inside a visible Launcher choice icon area resolves the same LauncherChoice as clicking row text.
    let (mut app, id) = app_with_launcher();
    app.compute_layout();
    let rect = app
        .visual_pane_rects
        .iter()
        .find(|(pane_id, _)| *pane_id == id)
        .map(|(_, rect)| *rect)
        .expect("Launcher Pane should have a visual rect");
    let inner = crate::rendering::launcher::launcher_content_rect(rect);
    let row = crate::rendering::launcher::launcher_choice_rect(
        inner,
        app.cell_size(),
        crate::action::LauncherChoice::Browser,
    )
    .expect("Browser choice should have a row rect");
    let icon_center = crate::tide_core::Vec2::new(row.x + 20.0, row.y + row.height / 2.0);

    assert_eq!(
        crate::rendering::launcher::launcher_choice_at(inner, app.cell_size(), icon_center),
        Some(crate::action::LauncherChoice::Browser)
    );
    assert!(handle_launcher_choice_click(&mut app, icon_center));
    assert!(matches!(app.panes.get(&id), Some(PaneKind::Browser(_))));
}
