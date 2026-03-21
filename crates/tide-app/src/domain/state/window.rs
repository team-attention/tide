// WindowState — window/display state: scale, size, font, dark mode, fullscreen, modifiers.

use super::focus::LayoutSide;

pub(crate) struct WindowState {
    pub scale_factor: f32,
    pub window_size: (u32, u32),
    pub cached_cell_size: crate::tide_core::Size,
    pub current_font_size: f32,
    pub cell_size_table: Vec<crate::tide_core::Size>,
    pub pending_font_size: Option<f32>,
    pub dark_mode: bool,
    pub top_inset: f32,
    pub is_fullscreen: bool,
    pub pending_fullscreen_toggle: bool,
    pub is_occluded: bool,
    pub modifiers: crate::tide_core::Modifiers,
    pub last_cursor_pos: crate::tide_core::Vec2,
    pub sidebar_side: LayoutSide,
    pub sidebar_handle_dragging: bool,
    /// Whether the window currently has OS focus. Tracked via `PlatformEvent::Focused`.
    pub is_focused: bool,
}

impl WindowState {
    pub fn new(top_inset: f32) -> Self {
        Self {
            scale_factor: 1.0,
            window_size: (1200, 800),
            cached_cell_size: crate::tide_core::Size::new(0.0, 0.0),
            current_font_size: 14.0,
            cell_size_table: Vec::new(),
            pending_font_size: None,
            dark_mode: true,
            top_inset,
            is_fullscreen: false,
            pending_fullscreen_toggle: false,
            is_occluded: false,
            modifiers: crate::tide_core::Modifiers::default(),
            last_cursor_pos: crate::tide_core::Vec2::new(0.0, 0.0),
            sidebar_side: LayoutSide::Left,
            sidebar_handle_dragging: false,
            is_focused: true,
        }
    }

    pub fn lookup_cell_size(&self, font_size: f32) -> crate::tide_core::Size {
        let idx = (font_size.round() as u32).saturating_sub(8) as usize;
        self.cell_size_table.get(idx).copied().unwrap_or(self.cached_cell_size)
    }

    #[allow(dead_code)]
    pub fn cell_size(&self) -> crate::tide_core::Size { self.cached_cell_size }

    pub fn palette(&self) -> &'static crate::theme::ThemePalette {
        if self.dark_mode { &crate::theme::DARK } else { &crate::theme::LIGHT }
    }

    pub fn logical_size(&self) -> crate::tide_core::Size {
        crate::tide_core::Size::new(
            self.window_size.0 as f32 / self.scale_factor,
            self.window_size.1 as f32 / self.scale_factor,
        )
    }
}
