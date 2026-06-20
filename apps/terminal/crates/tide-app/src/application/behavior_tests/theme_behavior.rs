// Spec: docs/specs/theme.md
use crate::adapter::outward::view::{
    config_page_osc52_read_status_text, config_page_osc52_read_toggle_text,
    config_page_theme_palette_status_text, config_page_theme_palette_toggle_text,
    config_page_theme_status_text, config_page_theme_toggle_text, file_tree_disclosure_color,
};
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::settings::{ThemePalettePreference, ThemePreference};
use crate::state::{ConfigPageState, ConfigSection};
use crate::theme::{
    palette_for, DARK, GRAPHITE_DARK, GRAPHITE_LIGHT, LIGHT, SAGE_DARK, SAGE_LIGHT,
};
use crate::tide_core::{Key, Modifiers};
use crate::tide_editor::highlight::{Highlighter, DARK_SYNTAX_THEME_NAME, LIGHT_SYNTAX_THEME_NAME};
use crate::tide_editor::markdown::MarkdownTheme;
use crate::tide_terminal::Terminal;
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

fn assert_color_near(actual: crate::tide_core::Color, expected: crate::tide_core::Color) {
    assert!(
        color_distance(actual, expected) < 0.006,
        "expected color near {:?}, got {:?}",
        (expected.r, expected.g, expected.b, expected.a),
        (actual.r, actual.g, actual.b, actual.a)
    );
    assert!((actual.a - expected.a).abs() < 0.006);
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

#[test]
fn loaded_user_settings_apply_font_theme_and_pending_renderer_values() {
    let mut app = test_app();
    app.settings.appearance.font_family = "JetBrains Mono".to_string();
    app.settings.appearance.font_size = 18.0;
    app.settings.appearance.theme = ThemePreference::Light;
    app.settings.appearance.palette = ThemePalettePreference::Graphite;

    app.apply_loaded_user_settings();

    assert_eq!(app.window.current_font_family, "JetBrains Mono");
    assert!((app.window.current_font_size - 18.0).abs() < f32::EPSILON);
    assert!(!app.window.dark_mode);
    assert_eq!(app.window.theme_palette, ThemePalettePreference::Graphite);
    assert_color_near(app.window.palette().surface_bg, GRAPHITE_LIGHT.surface_bg);
    assert_eq!(
        app.window.pending_font_family.as_deref(),
        Some("JetBrains Mono")
    );
    assert_eq!(app.window.pending_font_size, Some(18.0));
}

// --- UC-3: LightModeChrome ---

#[test]
fn light_mode_palette_keeps_borders_subtle_and_text_readable() {
    // UC-3 BR-5/BR-6/BR-7: Light mode uses VS Code Light-style editor surface, separators, and readable chrome text.
    assert_color_near(LIGHT.pane_bg, crate::tide_core::Color::rgb(1.0, 1.0, 1.0));
    assert_color_near(
        LIGHT.surface_bg,
        crate::tide_core::Color::rgb(0.953, 0.953, 0.953),
    );
    assert_color_near(
        LIGHT.border_subtle,
        crate::tide_core::Color::rgb(0.831, 0.831, 0.831),
    );
    assert!(contrast_ratio(LIGHT.tab_text_focused, LIGHT.pane_bg) >= 4.5);
    assert!(contrast_ratio(LIGHT.tree_text, LIGHT.file_tree_bg) >= 4.5);
    assert!(contrast_ratio(LIGHT.tree_dir, LIGHT.file_tree_bg) >= 4.5);
}

#[test]
fn light_mode_palette_separates_chrome_layers_and_current_line() {
    // UC-3 BR-15/BR-16: Light mode chrome and editor support values follow VS Code Light-style neutral steps.
    assert_color_near(
        LIGHT.tab_bar_bg,
        crate::tide_core::Color::rgb(0.953, 0.953, 0.953),
    );
    assert_color_near(
        LIGHT.active_tab_bg,
        crate::tide_core::Color::rgb(1.0, 1.0, 1.0),
    );
    assert_color_near(
        LIGHT.tab_text_focused,
        crate::tide_core::Color::rgb(0.18, 0.18, 0.18),
    );
    assert_color_near(
        LIGHT.tab_text,
        crate::tide_core::Color::rgb(0.435, 0.435, 0.435),
    );
    assert_color_near(
        LIGHT.current_line_bg,
        crate::tide_core::Color::rgb(0.935, 0.940, 0.945),
    );
    assert_color_near(
        LIGHT.indent_guide,
        crate::tide_core::Color::rgb(0.827, 0.827, 0.827),
    );
    assert_color_near(
        LIGHT.active_indent_guide,
        crate::tide_core::Color::rgb(0.576, 0.576, 0.576),
    );
    assert_color_near(
        LIGHT.gutter_text,
        crate::tide_core::Color::rgb(0.420, 0.545, 0.620),
    );
}

#[test]
fn dark_mode_editor_surface_has_document_depth_without_loud_overlays() {
    // UC-6 BR-20/BR-21: Dark mode Pane content is lifted from the shell while editor overlays stay quiet.
    assert!(luminance(DARK.pane_bg) > luminance(DARK.surface_bg) + 0.020);
    assert!(luminance(DARK.file_tree_bg) > luminance(DARK.surface_bg));
    assert!(DARK.current_line_bg.a <= 0.045);
    assert!(DARK.indent_guide.a <= 0.085);
    assert!(DARK.active_indent_guide.a > DARK.indent_guide.a);
    assert!(DARK.active_indent_guide.a <= 0.16);
    assert!(DARK.scrollbar_thumb.a <= 0.11);
}

#[test]
fn named_builtin_palettes_resolve_to_distinct_quiet_chrome() {
    let graphite_dark = palette_for(true, ThemePalettePreference::Graphite);
    let graphite_light = palette_for(false, ThemePalettePreference::Graphite);
    let sage_dark = palette_for(true, ThemePalettePreference::Sage);
    let sage_light = palette_for(false, ThemePalettePreference::Sage);

    assert_color_near(graphite_dark.surface_bg, GRAPHITE_DARK.surface_bg);
    assert_color_near(graphite_light.surface_bg, GRAPHITE_LIGHT.surface_bg);
    assert_color_near(sage_dark.surface_bg, SAGE_DARK.surface_bg);
    assert_color_near(sage_light.surface_bg, SAGE_LIGHT.surface_bg);
    assert!(color_distance(graphite_dark.dock_tab_underline, DARK.dock_tab_underline) >= 0.10);
    assert!(color_distance(sage_dark.dock_tab_underline, DARK.dock_tab_underline) >= 0.10);
    assert!(contrast_ratio(graphite_light.tab_text_focused, graphite_light.pane_bg) >= 4.5);
    assert!(contrast_ratio(sage_light.tab_text_focused, sage_light.pane_bg) >= 4.5);
    assert!(graphite_dark.current_line_bg.a <= 0.050);
    assert!(sage_dark.current_line_bg.a <= 0.050);
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

// (Removed editor_live_preview_rendering_uses_mode_aware_markdown_theme: the
// LivePreviewMode render path it grepped for was removed.)

#[test]
fn light_markdown_theme_uses_vscode_light_plus_role_colors() {
    // UC-4 BR-10: Light Markdown heading and code colors stay readable while following VS Code Light+ role colors.
    let theme = MarkdownTheme::light();

    assert!(contrast_ratio(theme.body, LIGHT.pane_bg) >= 7.0);
    assert!(contrast_ratio(theme.h1, LIGHT.pane_bg) >= 3.0);
    assert!(contrast_ratio(theme.h2, LIGHT.pane_bg) >= 2.1);
    assert!(contrast_ratio(theme.h3, LIGHT.pane_bg) >= 2.1);
    assert!(contrast_ratio(theme.code_fg, LIGHT.pane_bg) >= 4.0);
    assert_color_near(theme.h2, crate::tide_core::Color::rgb(0.149, 0.498, 0.6));
    assert_color_near(
        theme.code_fg,
        crate::tide_core::Color::rgb(0.639, 0.082, 0.082),
    );
    assert_color_near(
        theme.list_marker,
        crate::tide_core::Color::rgb(0.686, 0.0, 0.859),
    );
}

#[test]
fn light_syntax_highlighting_uses_vscode_light_plus_role_colors() {
    // UC-4 BR-11: Light syntax highlighting uses VS Code Light+ role colors.
    assert_eq!(LIGHT_SYNTAX_THEME_NAME, "tide-light");
}

#[test]
fn light_syntax_highlighting_gives_typescript_source_solid_token_colors() {
    // UC-4 BR-17: Light syntax highlighting keeps source identifiers readable while preserving token-role color separation.
    let mut highlighter = Highlighter::new();
    highlighter.set_dark_mode(false);
    let syntax = highlighter
        .syntax_set()
        .find_syntax_by_extension("ts")
        .expect("typescript syntax should be available");
    let lines = vec![
        "import type { NavigateFunction } from 'react-router-dom'".to_string(),
        "export class WebNavigationAdapter implements INavigationPort {".to_string(),
        "  constructor(private navigate: NavigateFunction) {}".to_string(),
        "  navigateToHome(): void { this.navigate('/') }".to_string(),
    ];
    let spans = highlighter.highlight_lines(&lines, syntax, 0, lines.len());

    let mut distinct_colors = std::collections::HashSet::new();
    let mut checked = 0usize;
    for span in spans
        .iter()
        .flatten()
        .filter(|span| !span.text.trim().is_empty())
    {
        assert!(
            contrast_ratio(span.style.foreground, LIGHT.pane_bg) >= 2.1,
            "light syntax span {:?} has contrast {} and luminance {}",
            span.text,
            contrast_ratio(span.style.foreground, LIGHT.pane_bg),
            luminance(span.style.foreground)
        );
        distinct_colors.insert((
            (span.style.foreground.r * 255.0).round() as u8,
            (span.style.foreground.g * 255.0).round() as u8,
            (span.style.foreground.b * 255.0).round() as u8,
        ));
        checked += 1;
    }
    assert!(checked > 0);
    assert!(
        distinct_colors.len() >= 5,
        "typescript syntax should not collapse into one gray foreground"
    );
}

#[test]
fn light_syntax_highlighting_gives_rust_source_distinct_token_colors() {
    // UC-4 BR-25: Light syntax highlighting separates representative Rust token roles with distinct colors.
    let mut highlighter = Highlighter::new();
    highlighter.set_dark_mode(false);
    let syntax = highlighter
        .syntax_set()
        .find_syntax_by_extension("rs")
        .expect("rust syntax should be available");
    let lines = vec![
        "#[derive(Clone)]".to_string(),
        "pub struct EditorPane { id: PaneId }".to_string(),
        "fn render_cursor(value: usize) -> Option<String> {".to_string(),
        "    let label = format!(\"cursor {value}\");".to_string(),
        "    Some(label)".to_string(),
        "}".to_string(),
        "// comment".to_string(),
    ];
    let spans = highlighter.highlight_lines(&lines, syntax, 0, lines.len());

    let mut distinct_colors = std::collections::HashSet::new();
    let mut checked = 0usize;
    for span in spans
        .iter()
        .flatten()
        .filter(|span| !span.text.trim().is_empty())
    {
        assert!(
            contrast_ratio(span.style.foreground, LIGHT.pane_bg) >= 2.1,
            "light rust syntax span {:?} has weak contrast {}",
            span.text,
            contrast_ratio(span.style.foreground, LIGHT.pane_bg)
        );
        distinct_colors.insert((
            (span.style.foreground.r * 255.0).round() as u8,
            (span.style.foreground.g * 255.0).round() as u8,
            (span.style.foreground.b * 255.0).round() as u8,
        ));
        checked += 1;
    }

    assert!(checked > 0);
    assert!(
        distinct_colors.len() >= 7,
        "rust syntax should expose at least seven distinct token colors, got {:?}",
        distinct_colors
    );
}

#[test]
fn light_syntax_highlighting_separates_rust_import_blocks_from_plain_text() {
    // UC-4 BR-25: Rust import blocks in light mode must not collapse into a single gray text color.
    let mut highlighter = Highlighter::new();
    highlighter.set_dark_mode(false);
    let syntax = highlighter
        .syntax_set()
        .find_syntax_by_extension("rs")
        .expect("rust syntax should be available");
    let lines = vec![
        "use crate::tide_input::{Action, AreaSlot, GlobalAction};".to_string(),
        "use crate::pane::PaneKind;".to_string(),
        "use crate::application::ports::outward::ClipboardSearchPort;".to_string(),
        "impl App {".to_string(),
    ];
    let spans = highlighter.highlight_lines(&lines, syntax, 0, lines.len());

    let mut distinct_colors = std::collections::HashSet::new();
    for span in spans
        .iter()
        .flatten()
        .filter(|span| !span.text.trim().is_empty())
    {
        distinct_colors.insert((
            (span.style.foreground.r * 255.0).round() as u8,
            (span.style.foreground.g * 255.0).round() as u8,
            (span.style.foreground.b * 255.0).round() as u8,
        ));
        assert!(
            contrast_ratio(span.style.foreground, LIGHT.pane_bg) >= 2.1,
            "import span {:?} should have solid light-mode ink",
            span.text
        );
    }

    assert!(
        distinct_colors.len() >= 4,
        "rust import blocks need visible role separation, got {:?}",
        distinct_colors
    );
    assert!(distinct_colors.contains(&(175, 0, 219)));
    assert!(distinct_colors.contains(&(0, 16, 128)));
    assert!(distinct_colors.contains(&(38, 127, 153)));
    assert!(distinct_colors.contains(&(0, 0, 0)));
}

#[test]
fn light_markdown_theme_separates_content_roles() {
    // UC-4 BR-26: Light Markdown theme separates headings, code, links, and body text.
    let theme = MarkdownTheme::light();
    let roles = [
        theme.body,
        theme.h1,
        theme.h2,
        theme.h3,
        theme.code_fg,
        theme.link,
        theme.list_marker,
        theme.blockquote,
    ];
    for (idx, a) in roles.iter().enumerate() {
        for b in roles.iter().skip(idx + 1) {
            assert!(
                color_distance(*a, *b) >= 0.08,
                "light markdown roles should not collapse into one tone"
            );
        }
    }
}

#[test]
fn dark_syntax_highlighting_uses_vscode_dark_plus_role_colors() {
    // UC-4A BR-22: Dark syntax highlighting uses VS Code Dark+ role colors.
    assert_eq!(DARK_SYNTAX_THEME_NAME, "tide-dark");
}

#[test]
fn dark_syntax_highlighting_gives_rust_source_distinct_token_colors() {
    // UC-4A BR-23: Dark syntax highlighting separates representative Rust token roles with distinct colors.
    let mut highlighter = Highlighter::new();
    highlighter.set_dark_mode(true);
    let syntax = highlighter
        .syntax_set()
        .find_syntax_by_extension("rs")
        .expect("rust syntax should be available");
    let lines = vec![
        "#[derive(Clone)]".to_string(),
        "pub struct EditorPane { id: PaneId }".to_string(),
        "fn render_cursor(value: usize) -> Option<String> {".to_string(),
        "    let label = format!(\"cursor {value}\");".to_string(),
        "    Some(label)".to_string(),
        "}".to_string(),
        "// comment".to_string(),
    ];
    let spans = highlighter.highlight_lines(&lines, syntax, 0, lines.len());

    let mut distinct_colors = std::collections::HashSet::new();
    let mut checked = 0usize;
    for span in spans
        .iter()
        .flatten()
        .filter(|span| !span.text.trim().is_empty())
    {
        distinct_colors.insert((
            (span.style.foreground.r * 255.0).round() as u8,
            (span.style.foreground.g * 255.0).round() as u8,
            (span.style.foreground.b * 255.0).round() as u8,
        ));
        checked += 1;
    }

    assert!(checked > 0);
    assert!(
        distinct_colors.len() >= 7,
        "rust syntax should expose at least seven distinct token colors, got {:?}",
        distinct_colors
    );
}

#[test]
fn dark_typescript_generics_color_as_types_not_jsx_tags() {
    // UC-4A BR-27: TypeScript generic arguments color as types, never JSX tags.
    let mut highlighter = Highlighter::new();
    highlighter.set_dark_mode(true);
    let syntax = highlighter
        .syntax_set()
        .find_syntax_by_extension("ts")
        .expect("typescript syntax should be available");
    assert_eq!(
        syntax.name, "TypeScript",
        ".ts must resolve to the dedicated TypeScript grammar, not JSX"
    );
    let lines = vec![
        "async preflight(): Promise<AgentIntegrationPreflight> {".to_string(),
        "const arr: Array<Map<string, number>> = [];".to_string(),
        "if (a < b && c > d) return;".to_string(),
    ];
    let spans = highlighter.highlight_lines(&lines, syntax, 0, lines.len());

    // VS Code Dark+ role colors from the dark syntax theme.
    let type_color = (78u8, 201u8, 176u8); // entity.name.type / support.type
    let tag_color = (86u8, 156u8, 214u8); // entity.name.tag (JSX) — must NOT appear

    let rgb = |c: crate::tide_core::Color| {
        (
            (c.r * 255.0).round() as u8,
            (c.g * 255.0).round() as u8,
            (c.b * 255.0).round() as u8,
        )
    };

    let mut saw_type_arg = false;
    for span in spans.iter().flatten() {
        let text = span.text.trim();
        // No token anywhere may take the JSX tag color: there is no JSX in `.ts`.
        assert_ne!(
            rgb(span.style.foreground),
            tag_color,
            "TypeScript token {text:?} was colored as a JSX tag"
        );
        // Generic argument type names must read as types.
        if matches!(
            text,
            "AgentIntegrationPreflight" | "Map" | "string" | "number" | "Promise" | "Array"
        ) {
            assert_eq!(
                rgb(span.style.foreground),
                type_color,
                "generic type {text:?} should use the type role color"
            );
            saw_type_arg = true;
        }
    }
    assert!(
        saw_type_arg,
        "expected generic type arguments to be checked"
    );
}

#[test]
fn dark_markdown_theme_separates_content_roles() {
    // UC-4A BR-24: Dark Markdown theme separates headings, code, links, and body text.
    let theme = MarkdownTheme::dark();
    let roles = [
        theme.body,
        theme.h1,
        theme.h2,
        theme.h3,
        theme.code_fg,
        theme.link,
        theme.list_marker,
        theme.blockquote,
    ];
    for (idx, a) in roles.iter().enumerate() {
        for b in roles.iter().skip(idx + 1) {
            assert!(
                color_distance(*a, *b) >= 0.08,
                "dark markdown roles should not collapse into one tone"
            );
        }
    }
}

#[test]
fn light_editor_support_text_is_crisper_than_inactive_chrome_text() {
    // UC-4 BR-18: Light editor support text such as gutter numbers stays darker than low-priority chrome text.
    assert!(luminance(LIGHT.gutter_text) >= 0.45);
    assert_color_near(
        LIGHT.gutter_text,
        crate::tide_core::Color::rgb(0.420, 0.545, 0.620),
    );
}

#[test]
fn light_mode_accent_colors_stay_lighter_than_normal_text_weight() {
    // UC-4 BR-19: Light accent and semantic colors stay visibly lighter than normal foreground text.
    let normal_text_lum = luminance(LIGHT.tab_text_focused);
    for color in [
        LIGHT.gutter_text,
        LIGHT.dock_tab_underline,
        LIGHT.link_color,
        LIGHT.badge_git_branch,
        LIGHT.badge_git_worktree,
        LIGHT.badge_git_additions,
        LIGHT.badge_git_deletions,
        LIGHT.git_added,
        LIGHT.git_modified,
        LIGHT.git_conflict,
    ] {
        assert!(luminance(color) >= normal_text_lum + 0.12);
    }

    let markdown = MarkdownTheme::light();
    assert!(color_distance(markdown.code_fg, LIGHT.tab_text_focused) >= 0.12);
    assert!(color_distance(markdown.link, LIGHT.tab_text_focused) >= 0.12);
    assert!(contrast_ratio(markdown.code_fg, LIGHT.pane_bg) >= 4.0);

    let terminal_blue =
        Terminal::named_color_to_rgb(false, alacritty_terminal::vte::ansi::NamedColor::Blue);
    assert!(luminance(terminal_blue) >= normal_text_lum + 0.12);
    assert!(contrast_ratio(terminal_blue, LIGHT.pane_bg) >= 2.1);
}

// --- UC-5: ConfigureAppearanceTheme ---

#[test]
fn config_page_appearance_theme_uses_text_status() {
    // UC-5 BR-12/BR-13: ConfigPage Appearance exposes current theme and next theme action as text.
    assert_eq!(config_page_theme_status_text(true), "Dark");
    assert_eq!(config_page_theme_status_text(false), "Light");
    assert_eq!(config_page_theme_toggle_text(true), "Switch to Light");
    assert_eq!(config_page_theme_toggle_text(false), "Switch to Dark");
    assert_eq!(
        config_page_theme_palette_status_text(ThemePalettePreference::Graphite),
        "Graphite"
    );
    assert_eq!(
        config_page_theme_palette_toggle_text(ThemePalettePreference::Graphite),
        "Next: Sage"
    );
}

#[test]
fn config_page_terminal_osc52_read_uses_text_status() {
    assert_eq!(config_page_osc52_read_status_text(true), "Allowed");
    assert_eq!(config_page_osc52_read_status_text(false), "Blocked");
    assert_eq!(config_page_osc52_read_toggle_text(true), "Block");
    assert_eq!(config_page_osc52_read_toggle_text(false), "Allow");
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

#[test]
fn config_page_appearance_palette_row_cycles_named_palette() {
    let mut app = test_app();
    let mut page = ConfigPageState::new(vec![], String::new(), String::new());
    page.section = ConfigSection::Appearance;
    page.selected_field = 1;
    app.modal.config_page = Some(page);

    assert_eq!(
        app.settings.appearance.palette,
        ThemePalettePreference::Tide
    );
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        Key::Enter,
        Modifiers::default(),
        None,
    );

    assert_eq!(
        app.settings.appearance.palette,
        ThemePalettePreference::Graphite
    );
    assert_eq!(app.window.theme_palette, ThemePalettePreference::Graphite);
    assert_color_near(app.window.palette().surface_bg, GRAPHITE_DARK.surface_bg);
    assert!(app.modal.config_page.is_some());
}
