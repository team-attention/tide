// Spec: docs/specs/theme.md
use crate::adapter::outward::view::{
    config_page_theme_status_text, config_page_theme_toggle_text, file_tree_disclosure_color,
};
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::{ConfigPageState, ConfigSection};
use crate::theme::{DARK, LIGHT};
use crate::tide_core::{Key, Modifiers};
use crate::tide_editor::highlight::LIGHT_SYNTAX_THEME_NAME;
use crate::tide_editor::markdown::MarkdownTheme;
use crate::ActionPort;
use crate::App;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn luminance(color: crate::tide_core::Color) -> f32 {
    0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
}

fn contrast_ratio(a: crate::tide_core::Color, b: crate::tide_core::Color) -> f32 {
    let l1 = luminance(a);
    let l2 = luminance(b);
    let (lighter, darker) = if l1 > l2 { (l1, l2) } else { (l2, l1) };
    (lighter + 0.05) / (darker + 0.05)
}

fn color_distance(a: crate::tide_core::Color, b: crate::tide_core::Color) -> f32 {
    ((a.r - b.r).powi(2) + (a.g - b.g).powi(2) + (a.b - b.b).powi(2)).sqrt()
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
    app.handle_global_action(crate::tide_input::GlobalAction::ToggleTheme);
    assert!(!app.window.dark_mode);
    app.handle_global_action(crate::tide_input::GlobalAction::ToggleTheme);
    assert!(app.window.dark_mode);
}

#[test]
fn toggle_theme_clears_all_pane_generations_in_render_cache() {
    // UC-1 BR-3: Toggle clears all pane_generations in RenderCache
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes
        .insert(id, PaneKind::Editor(EditorPane::new_empty(id)));
    app.focus.focused = Some(id);
    app.cache.pane_generations.insert(id, 42);

    app.handle_global_action(crate::tide_input::GlobalAction::ToggleTheme);
    assert!(app.cache.pane_generations.is_empty());
}

// --- UC-2: FontDefaults ---

#[test]
fn font_size_starts_at_14() {
    // UC-2 BR-4: Font size starts at 14
    let app = test_app();
    assert!((app.window.current_font_size - 14.0).abs() < f32::EPSILON);
}

// --- UC-3: LightModeChrome ---

#[test]
fn light_mode_palette_keeps_borders_subtle_and_text_readable() {
    // UC-3 BR-5/BR-6/BR-7: Light mode gaps and borders stay subtle while primary chrome text remains readable.
    assert!(color_distance(LIGHT.border_color, LIGHT.pane_bg) < 0.055);
    assert!(LIGHT.border_subtle.a <= 0.09);
    assert!(contrast_ratio(LIGHT.tab_text_focused, LIGHT.pane_bg) >= 7.0);
    assert!(contrast_ratio(LIGHT.tree_text, LIGHT.file_tree_bg) >= 4.5);
    assert!(contrast_ratio(LIGHT.tree_dir, LIGHT.file_tree_bg) >= 4.5);
}

#[test]
fn file_tree_disclosure_chevrons_use_mode_aware_opacity() {
    // UC-3 BR-8: Disclosure chevrons are more opaque in dark mode than light mode to keep visibility consistent.
    let dark = file_tree_disclosure_color(&DARK);
    let light = file_tree_disclosure_color(&LIGHT);

    assert!(dark.a >= 0.80);
    assert!(light.a <= 0.58);
    assert!(dark.a > light.a);
}

// --- UC-4: LightModeEditorText ---

#[test]
fn editor_live_preview_rendering_uses_mode_aware_markdown_theme() {
    // UC-4 BR-9: Editor live-preview rendering must choose MarkdownTheme from the active theme mode.
    let source = include_str!("../../domain/pane/editor_rendering.rs");

    assert!(source.contains("MarkdownTheme::for_dark_mode(dark_mode)"));
    assert!(!source.contains("let theme = MarkdownTheme::dark();"));
}

#[test]
fn light_markdown_theme_uses_quiet_readable_colors() {
    // UC-4 BR-10: Light Markdown heading and code colors stay darker than the light pane surface.
    let theme = MarkdownTheme::light();

    assert!(contrast_ratio(theme.body, LIGHT.pane_bg) >= 7.0);
    assert!(contrast_ratio(theme.h2, LIGHT.pane_bg) >= 4.5);
    assert!(contrast_ratio(theme.h3, LIGHT.pane_bg) >= 4.5);
    assert!(contrast_ratio(theme.code_fg, LIGHT.pane_bg) >= 4.5);
    assert!(luminance(theme.h2) < 0.38);
    assert!(luminance(theme.h3) < 0.38);
}

#[test]
fn light_syntax_highlighting_uses_base16_ocean_theme() {
    // UC-4 BR-11: Light syntax highlighting uses the restrained base16-ocean.light theme.
    assert_eq!(LIGHT_SYNTAX_THEME_NAME, "base16-ocean.light");
}

// --- UC-5: ConfigureAppearanceTheme ---

#[test]
fn config_page_appearance_theme_uses_text_status() {
    // UC-5 BR-12/BR-13: ConfigPage Appearance exposes current theme and next theme action as text.
    assert_eq!(config_page_theme_status_text(true), "Dark");
    assert_eq!(config_page_theme_status_text(false), "Light");
    assert_eq!(config_page_theme_toggle_text(true), "Switch to Light");
    assert_eq!(config_page_theme_toggle_text(false), "Switch to Dark");
}

#[test]
fn config_page_appearance_theme_toggle_switches_theme() {
    // UC-5 BR-14: Activating the Appearance theme row toggles theme through GlobalAction::ToggleTheme.
    let mut app = test_app();
    let mut page = ConfigPageState::new(vec![], String::new(), String::new());
    page.section = ConfigSection::Appearance;
    app.modal.config_page = Some(page);

    assert!(app.window.dark_mode);
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        Key::Enter,
        Modifiers::default(),
        None,
    );

    assert!(!app.window.dark_mode);
    assert!(app.modal.config_page.is_some());
}
