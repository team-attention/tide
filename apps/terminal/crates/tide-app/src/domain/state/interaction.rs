// InteractionState — mouse/drag/scroll interaction state.

use super::drag_types::{HoverTarget, PaneDragState};
use crate::tide_core::{MouseButton, PaneId, Rect};
use std::collections::{HashMap, HashSet};
use std::time::Instant;

pub(crate) struct InteractionState {
    pub pane_drag: PaneDragState,
    pub scroll_accumulator: HashMap<PaneId, f32>,
    pub mouse_left_pressed: bool,
    pub mouse_pressed_button: Option<MouseButton>,
    pub terminal_mouse_source: Option<PaneId>,
    pub text_selection_drag_source: Option<PaneId>,
    pub scrollbar_dragging: Option<PaneId>,
    pub scrollbar_drag_rect: Option<Rect>,
    pub hover_target: Option<HoverTarget>,
    pub drop_preview_start: Option<Instant>,
    /// Horizontal scroll offset for tab bars, keyed by the pane_id that owns the tab bar.
    pub tab_scroll_offset: HashMap<PaneId, f32>,
    /// Timestamp of the last shared-tab scroll event for a tab bar owner pane.
    pub tab_scroll_last_at: HashMap<PaneId, Instant>,
    /// Last shared-tab scroll direction for a tab bar owner pane.
    pub tab_scroll_last_direction: HashMap<PaneId, f32>,
    /// Pane-owned shared tab bars that the user has manually scrolled away from the active tab.
    pub tab_manual_scroll: HashSet<PaneId>,
}

impl InteractionState {
    pub fn new() -> Self {
        Self {
            pane_drag: PaneDragState::Idle,
            scroll_accumulator: HashMap::new(),
            mouse_left_pressed: false,
            mouse_pressed_button: None,
            terminal_mouse_source: None,
            text_selection_drag_source: None,
            scrollbar_dragging: None,
            scrollbar_drag_rect: None,
            hover_target: None,
            drop_preview_start: None,
            tab_scroll_offset: HashMap::new(),
            tab_scroll_last_at: HashMap::new(),
            tab_scroll_last_direction: HashMap::new(),
            tab_manual_scroll: HashSet::new(),
        }
    }
}
