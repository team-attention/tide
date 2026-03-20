// LayoutPort — layout computation, hit testing, and geometry queries.
// Source: layout_compute.rs

use crate::tide_core::Vec2;

pub(crate) trait LayoutPort {
    fn compute_layout(&mut self);
    fn sync_browser_webview_frames(&mut self);
    fn update_cursor_icon(&self, window: &crate::tide_platform::WindowProxy);
    fn file_finder_item_at(&self, pos: Vec2) -> Option<usize>;
    fn git_switcher_item_at(&self, pos: Vec2) -> Option<usize>;
    fn git_switcher_contains(&self, pos: Vec2) -> bool;
    fn git_switcher_tab_at(&self, pos: Vec2) -> Option<crate::GitSwitcherMode>;
    fn git_switcher_button_at(&self, pos: Vec2) -> Option<crate::SwitcherButton>;
    fn file_finder_contains(&self, pos: Vec2) -> bool;
    fn save_as_contains(&self, pos: Vec2) -> bool;
    fn context_menu_item_at(&self, pos: Vec2) -> Option<usize>;
    fn palette(&self) -> &'static crate::theme::ThemePalette;
}
