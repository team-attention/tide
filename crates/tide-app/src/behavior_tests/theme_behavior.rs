// Spec: docs/specs/theme.md
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::App;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

// --- UC-1: ToggleTheme ---

#[test]
fn app_starts_in_dark_mode() {
    // UC-1 BR-1: App starts in dark mode
    let app = test_app();
    assert!(app.window.dark_mode);
}

#[test]
fn toggle_theme_switches_between_dark_and_light() {
    // UC-1 BR-2: Toggle switches between dark and light
    let mut app = test_app();
    assert!(app.window.dark_mode);
    app.handle_global_action(tide_input::GlobalAction::ToggleTheme);
    assert!(!app.window.dark_mode);
    app.handle_global_action(tide_input::GlobalAction::ToggleTheme);
    assert!(app.window.dark_mode);
}

#[test]
fn toggle_theme_clears_all_pane_generations_in_render_cache() {
    // UC-1 BR-3: Toggle clears all pane_generations in RenderCache
    let mut app = test_app();
    let (layout, id) = tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(id, PaneKind::Editor(EditorPane::new_empty(id)));
    app.focus.focused = Some(id);
    app.cache.pane_generations.insert(id, 42);

    app.handle_global_action(tide_input::GlobalAction::ToggleTheme);
    assert!(app.cache.pane_generations.is_empty());
}

// --- UC-2: FontDefaults ---

#[test]
fn font_size_starts_at_14() {
    // UC-2 BR-4: Font size starts at 14
    let app = test_app();
    assert!((app.window.current_font_size - 14.0).abs() < f32::EPSILON);
}
