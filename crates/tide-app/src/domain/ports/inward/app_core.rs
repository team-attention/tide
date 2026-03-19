// AppCorePort — core App helpers: sizing, font, dock zoom.
// Source: app.rs

use tide_core::{PaneId, Size};

pub(crate) trait AppCorePort {
    fn dock_zoomed_pane(&self) -> Option<PaneId>;
    fn logical_size(&self) -> Size;
    fn cell_size(&self) -> Size;
    fn apply_font_size(&mut self, size: f32);
    fn flush_pending_font_size(&mut self);
}
