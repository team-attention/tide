// FocusNavPort — directional focus movement and scrolling.
// Source: domain/action/focus_nav.rs

use crate::tide_input::Direction;

pub(crate) trait FocusNavPort {
    fn navigate_file_tree(&mut self, direction: Direction);
    fn handle_move_focus(&mut self, direction: Direction);
    fn scroll_half_page(&mut self, direction: Direction);
}
