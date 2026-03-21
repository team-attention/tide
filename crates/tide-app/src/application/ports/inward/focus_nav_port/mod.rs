// FocusNavPort — directional focus movement, scrolling, and focus state queries/mutations.
// Source: domain/action/focus_nav.rs

use crate::tide_core::PaneId;
use crate::tide_input::Direction;
use crate::state::FocusArea;

pub(crate) trait FocusNavPort {
    // ── Directional navigation ──
    fn navigate_file_tree(&mut self, direction: Direction);
    fn handle_move_focus(&mut self, direction: Direction);
    fn scroll_half_page(&mut self, direction: Direction);

    // ── Focus state queries ──
    fn focused_pane(&self) -> Option<PaneId>;
    fn current_focus_area(&self) -> FocusArea;
    fn zoomed_pane(&self) -> Option<PaneId>;
    fn search_focus(&self) -> Option<PaneId>;

    // ── Focus state mutations (handles router + cache internally) ──
    fn focus_pane(&mut self, id: PaneId);
    fn set_focus_area(&mut self, area: FocusArea);
    fn set_zoom(&mut self, pane_id: Option<PaneId>);
    fn set_search_focus(&mut self, pane_id: Option<PaneId>);
}
