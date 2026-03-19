mod file_tree;
mod tab_bar;
mod titlebar;

use tide_core::Rect;

use crate::header;
use crate::theme::*;
use crate::App;

/// Render the chrome layer: file tree panel, editor panel + tabs, pane backgrounds,
/// focused borders, headers, and grip dots.
///
/// This is called only when `chrome_dirty` is true (i.e. chrome_generation changed).
/// Returns the computed header hit zones for click handling.
pub(crate) fn render_chrome(
    app: &App,
    renderer: &mut tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    logical: tide_core::Size,
    focused: Option<u64>,
    show_file_tree: bool,
    file_tree_scroll: f32,
    visual_pane_rects: &[(u64, Rect)],
    _all_pane_ids: &[u64],
) -> Vec<header::HeaderHitZone> {
    renderer.invalidate_chrome();

    // Titlebar + workspace sidebar
    titlebar::render_titlebar_and_sidebar(app, renderer, p, logical);

    // File tree panel
    if show_file_tree {
        file_tree::render_file_tree(app, renderer, p, logical, file_tree_scroll);
    }

    // Dock background, pane borders, headers, browser nav bars
    tab_bar::render_pane_chrome(app, renderer, p, logical, focused, visual_pane_rects)
}
