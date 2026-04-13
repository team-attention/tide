// FileOpsPort — file finder and diff pane operations.
// Source: domain/action/file_ops.rs

use crate::tide_core::PaneId;
use std::path::PathBuf;

pub(crate) trait FileOpsPort {
    fn resolve_base_dir(&self) -> PathBuf;
    fn open_file_finder_with_replace(&mut self, replace_pane_id: Option<PaneId>);
    fn open_file_finder(&mut self);
    fn close_file_finder(&mut self);
    fn open_diff_pane(&mut self, cwd: PathBuf);
}
