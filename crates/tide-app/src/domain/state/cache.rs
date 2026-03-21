// RenderCache — render generation tracking and dirty flags.

use std::collections::HashMap;
use crate::tide_core::PaneId;

pub(crate) struct RenderCache {
    pub pane_generations: HashMap<PaneId, u64>,
    pub layout_generation: u64,
    pub chrome_generation: u64,
    pub last_chrome_generation: u64,
    pub needs_redraw: bool,
}

impl RenderCache {
    pub fn new() -> Self {
        Self {
            pane_generations: HashMap::new(),
            layout_generation: 0,
            chrome_generation: 0,
            last_chrome_generation: u64::MAX,
            needs_redraw: true,
        }
    }

    /// Bump chrome generation and mark redraw needed.
    pub fn invalidate_chrome(&mut self) {
        self.chrome_generation += 1;
        self.needs_redraw = true;
    }

    /// Remove a pane's cached generation and mark redraw needed.
    pub fn invalidate_pane(&mut self, id: PaneId) {
        self.pane_generations.remove(&id);
        self.needs_redraw = true;
    }

    /// Clear the redraw flag after a successful render.
    pub fn clear_redraw(&mut self) {
        self.needs_redraw = false;
    }

    /// Whether chrome needs re-rendering.
    #[allow(dead_code)]
    pub fn is_chrome_dirty(&self) -> bool {
        self.chrome_generation != self.last_chrome_generation
    }
}
