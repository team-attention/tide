// TextExtractPort — URL and file path extraction from pane content.
// Source: domain/action/text_extract.rs

use crate::tide_core::{PaneId, Vec2};
use std::path::PathBuf;

pub(crate) trait TextExtractPort {
    fn extract_url_at(&self, pane_id: PaneId, position: Vec2) -> Option<String>;
    fn extract_file_path_at(
        &self,
        pane_id: PaneId,
        position: Vec2,
    ) -> Option<(PathBuf, Option<usize>)>;
}
