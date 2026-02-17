use tide_input::Direction;

use crate::{App, PaneAreaMode};

impl App {
    /// Handle MoveFocus direction navigation.
    /// Moves focus between terminal panes only (dock tabs use DockTabPrev/Next).
    pub(super) fn handle_move_focus(&mut self, direction: Direction) {
        self.sub_focus = None;
        self.save_as_input = None;
        let current_id = match self.focused {
            Some(id) => id,
            None => return,
        };

        // Stacked mode: linear tab cycling (no wrap)
        if matches!(self.pane_area_mode, PaneAreaMode::Stacked(_)) {
            let pane_ids = self.layout.pane_ids();
            if let Some(pos) = pane_ids.iter().position(|&id| id == current_id) {
                match direction {
                    Direction::Left if pos > 0 => {
                        let next_id = pane_ids[pos - 1];
                        self.pane_area_mode = PaneAreaMode::Stacked(next_id);
                        self.focus_terminal(next_id);
                        self.compute_layout();
                        return;
                    }
                    Direction::Right if pos + 1 < pane_ids.len() => {
                        let next_id = pane_ids[pos + 1];
                        self.pane_area_mode = PaneAreaMode::Stacked(next_id);
                        self.focus_terminal(next_id);
                        self.compute_layout();
                        return;
                    }
                    Direction::Up | Direction::Down => return,
                    _ => return, // boundary reached
                }
            }
        }

        // Split mode: spatial navigation
        if self.editor_panel_maximized {
            self.editor_panel_maximized = false;
            self.compute_layout();
        }

        let all_rects = self.pane_rects.clone();
        if all_rects.len() < 2 {
            return;
        }

        let current_rect = match all_rects.iter().find(|(id, _)| *id == current_id) {
            Some((_, r)) => *r,
            None => return,
        };
        let cx = current_rect.x + current_rect.width / 2.0;
        let cy = current_rect.y + current_rect.height / 2.0;

        let mut best: Option<(tide_core::PaneId, f32)> = None;
        for &(id, rect) in &all_rects {
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
                    rect.y < current_rect.y + current_rect.height && rect.y + rect.height > current_rect.y,
                    dx.abs(),
                ),
                Direction::Right => (
                    dx > 1.0,
                    rect.y < current_rect.y + current_rect.height && rect.y + rect.height > current_rect.y,
                    dx.abs(),
                ),
                Direction::Up => (
                    dy < -1.0,
                    rect.x < current_rect.x + current_rect.width && rect.x + rect.width > current_rect.x,
                    dy.abs(),
                ),
                Direction::Down => (
                    dy > 1.0,
                    rect.x < current_rect.x + current_rect.width && rect.x + rect.width > current_rect.x,
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
}
