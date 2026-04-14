use crate::tide_core::{FileTreeSource, PaneId};
use crate::tide_editor::input::EditorAction;
use crate::tide_input::Direction;

use crate::pane::PaneKind;
use crate::state::FocusArea;
#[allow(unused_imports)]
use crate::tide_core::LayoutEngine;
use crate::App;
use crate::AppCorePort;
use crate::FocusNavPort;
use crate::WorkspaceNavPort;

impl FocusNavPort for App {
    /// Navigate file tree cursor: J(Down) = next, K(Up) = prev. H/L ignored.
    fn navigate_file_tree(&mut self, direction: Direction) {
        let entry_count = self
            .ft
            .tree
            .as_ref()
            .map(|t| t.visible_entries().len())
            .unwrap_or(0);
        if entry_count == 0 {
            return;
        }
        match direction {
            Direction::Down => {
                if self.ft.cursor + 1 < entry_count {
                    self.ft.cursor += 1;
                    self.cache.invalidate_chrome();
                    self.auto_scroll_file_tree_cursor();
                }
            }
            Direction::Up => {
                if self.ft.cursor > 0 {
                    self.ft.cursor -= 1;
                    self.cache.invalidate_chrome();
                    self.auto_scroll_file_tree_cursor();
                }
            }
            _ => {} // H/L ignored in file tree
        }
        self.cache.needs_redraw = true;
    }

    /// Handle MoveFocus direction navigation between Stage panes only.
    /// HJKL never crosses into the Dock — use Cmd+I/O for Dock navigation.
    fn handle_move_focus(&mut self, direction: Direction) {
        self.focus.focus_area = FocusArea::Stage;
        self.modal.save_as_input = None;
        let current_id = match self.focus.focused {
            Some(id) => id,
            None => return,
        };

        // Zoomed/stacked mode: cycle through all Stage panes in layout order
        if self.focus.zoomed_pane.is_some() {
            let all = self.layout.all_tabs_flat();
            if all.len() < 2 {
                return;
            }
            let pos = all.iter().position(|&id| id == current_id).unwrap_or(0);
            let next_pos = match direction {
                Direction::Right | Direction::Down => (pos + 1) % all.len(),
                Direction::Left | Direction::Up => (pos + all.len() - 1) % all.len(),
            };
            self.focus_terminal(all[next_pos]);
            return;
        }

        // HJKL navigates between TabGroups/splits spatially, not within TabGroups.
        // Use Cmd+I/O (TabPrev/TabNext) to cycle within a TabGroup.

        // Only consider Stage pane rects (exclude dock panes)
        let stage_ids: std::collections::HashSet<crate::tide_core::PaneId> =
            self.layout.pane_ids().into_iter().collect();
        let stage_rects: Vec<(crate::tide_core::PaneId, crate::tide_core::Rect)> = self
            .pane_rects
            .iter()
            .filter(|(id, _)| stage_ids.contains(id))
            .copied()
            .collect();

        if stage_rects.len() < 2 {
            return;
        }

        let current_rect = match stage_rects.iter().find(|(id, _)| *id == current_id) {
            Some((_, r)) => *r,
            None => return,
        };
        let cx = current_rect.x + current_rect.width / 2.0;
        let cy = current_rect.y + current_rect.height / 2.0;

        let mut best: Option<(crate::tide_core::PaneId, f32)> = None;
        for &(id, rect) in &stage_rects {
            if id == current_id {
                continue;
            }
            let ox = rect.x + rect.width / 2.0;
            let oy = rect.y + rect.height / 2.0;
            let dx = ox - cx;
            let dy = oy - cy;

            let (valid, overlaps, dist) = match direction {
                Direction::Left => (
                    dx < -1.0,
                    rect.y < current_rect.y + current_rect.height
                        && rect.y + rect.height > current_rect.y,
                    dx.abs(),
                ),
                Direction::Right => (
                    dx > 1.0,
                    rect.y < current_rect.y + current_rect.height
                        && rect.y + rect.height > current_rect.y,
                    dx.abs(),
                ),
                Direction::Up => (
                    dy < -1.0,
                    rect.x < current_rect.x + current_rect.width
                        && rect.x + rect.width > current_rect.x,
                    dy.abs(),
                ),
                Direction::Down => (
                    dy > 1.0,
                    rect.x < current_rect.x + current_rect.width
                        && rect.x + rect.width > current_rect.x,
                    dy.abs(),
                ),
            };

            if !valid {
                continue;
            }

            let score = if overlaps { dist } else { dist + 100000.0 };
            if best.is_none_or(|(_, d)| score < d) {
                best = Some((id, score));
            }
        }

        if let Some((next_id, _)) = best {
            self.focus_terminal(next_id);
        }
    }

    /// Scroll the focused pane by half a page (Cmd+U / Cmd+D).
    fn scroll_half_page(&mut self, direction: Direction) {
        let pane_id = match self.focus.focused {
            Some(id) => id,
            None => return,
        };

        let cs = self.cell_size();
        let rect = self
            .visual_pane_rects
            .iter()
            .find(|(pid, _)| *pid == pane_id)
            .map(|(_, r)| *r);
        let visible_rows = rect
            .map(|r| (r.height / cs.height).floor() as usize)
            .unwrap_or(30);
        let half = (visible_rows / 2).max(1) as f32;

        match self.panes.get_mut(&pane_id) {
            Some(PaneKind::Terminal(tp)) => {
                let lines = match direction {
                    Direction::Up => half as i32,
                    Direction::Down => -(half as i32),
                    _ => return,
                };
                tp.scroll_display(lines);
            }
            Some(PaneKind::Editor(ep)) => {
                if ep.preview_mode {
                    let total = ep.preview_line_count();
                    let max_scroll = total.saturating_sub(visible_rows);
                    let half_usize = half as usize;
                    match direction {
                        Direction::Up => {
                            ep.preview_scroll = ep.preview_scroll.saturating_sub(half_usize);
                        }
                        Direction::Down => {
                            ep.preview_scroll = (ep.preview_scroll + half_usize).min(max_scroll);
                        }
                        _ => return,
                    }
                } else {
                    let action = match direction {
                        Direction::Up => EditorAction::ScrollUp(half),
                        Direction::Down => EditorAction::ScrollDown(half),
                        _ => return,
                    };
                    ep.handle_action(action, visible_rows);
                }
            }
            _ => return,
        }
        self.cache.invalidate_pane(pane_id);
    }

    // ── Focus state queries ──

    fn focused_pane(&self) -> Option<PaneId> {
        self.focus.focused
    }

    fn current_focus_area(&self) -> FocusArea {
        self.focus.focus_area
    }

    fn zoomed_pane(&self) -> Option<PaneId> {
        self.focus.zoomed_pane
    }

    fn search_focus(&self) -> Option<PaneId> {
        self.focus.search_focus
    }

    // ── Focus state mutations ──

    fn focus_pane(&mut self, id: PaneId) {
        // Clear url_input_focused on the previously focused browser pane
        // so stale IME preedit doesn't render in its URL bar.
        if let Some(prev) = self.focus.focused {
            if prev != id {
                if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&prev) {
                    bp.url_input_focused = false;
                    bp.url_selection = None;
                }
            }
        }
        self.focus.focused = Some(id);
        self.router.set_focused(id);
        // Focus acknowledges completion notifications but does not clear
        // the Wrapped Agent lifecycle state itself.
        self.notified_panes.remove(&id);
        self.refresh_workspace_agent_notification(self.ws.active);
        self.cache.invalidate_chrome();
        self.reroute_backgrounded_wrapped_agent_attention();
    }

    fn set_focus_area(&mut self, area: FocusArea) {
        self.focus.focus_area = area;
        self.cache.invalidate_chrome();
    }

    fn set_zoom(&mut self, pane_id: Option<PaneId>) {
        self.focus.zoomed_pane = pane_id;
        self.cache.invalidate_chrome();
    }

    fn set_search_focus(&mut self, pane_id: Option<PaneId>) {
        self.focus.search_focus = pane_id;
        self.cache.invalidate_chrome();
    }
}
