// InteractionState — mouse/drag/scroll interaction state.

use std::collections::HashMap;
use std::time::Instant;
use crate::tide_core::{PaneId, Rect};
use super::drag_types::{PaneDragState, HoverTarget};

pub(crate) struct InteractionState {
    pub pane_drag: PaneDragState,
    pub scroll_accumulator: HashMap<PaneId, f32>,
    pub mouse_left_pressed: bool,
    pub scrollbar_dragging: Option<PaneId>,
    pub scrollbar_drag_rect: Option<Rect>,
    pub hover_target: Option<HoverTarget>,
    pub drop_preview_start: Option<Instant>,
    /// Horizontal scroll offset for tab bars, keyed by the pane_id that owns the tab bar.
    pub tab_scroll_offset: HashMap<PaneId, f32>,
}

impl InteractionState {
    pub fn new() -> Self {
        Self {
            pane_drag: PaneDragState::Idle,
            scroll_accumulator: HashMap::new(),
            mouse_left_pressed: false,
            scrollbar_dragging: None,
            scrollbar_drag_rect: None,
            hover_target: None,
            drop_preview_start: None,
            tab_scroll_offset: HashMap::new(),
        }
    }
}
