// InteractionState — mouse/drag/scroll interaction state.

use std::collections::HashMap;
use crate::tide_core::{PaneId, Rect};

pub(crate) struct InteractionState {
    pub pane_drag: crate::event_handler::drag_drop::PaneDragState,
    pub scroll_accumulator: HashMap<PaneId, f32>,
    pub mouse_left_pressed: bool,
    pub scrollbar_dragging: Option<PaneId>,
    pub scrollbar_drag_rect: Option<Rect>,
    pub hover_target: Option<crate::event_handler::drag_drop::HoverTarget>,
}

impl InteractionState {
    pub fn new() -> Self {
        Self {
            pane_drag: crate::event_handler::drag_drop::PaneDragState::Idle,
            scroll_accumulator: HashMap::new(),
            mouse_left_pressed: false,
            scrollbar_dragging: None,
            scrollbar_drag_rect: None,
            hover_target: None,
        }
    }
}
