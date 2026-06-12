// FileOpsPort — file finder and diff pane operations.
// Source: domain/action/file_ops.rs

use crate::tide_core::{PaneId, Vec2};
use std::path::PathBuf;

pub(crate) trait FileOpsPort {
    fn resolve_base_dir(&self) -> PathBuf;
    fn open_file_finder_with_replace(&mut self, replace_pane_id: Option<PaneId>);
    fn open_file_finder(&mut self);
    fn close_file_finder(&mut self);
    fn ensure_file_finder_workspace_symbols_loaded(&mut self);
    fn open_diff_pane(&mut self, cwd: PathBuf);
    /// Ask the background git poller to re-run for the current CWDs (e.g. the
    /// DiffRefresh header button). Diff content is produced off-thread; this
    /// never spawns git on the app thread.
    fn request_git_poll(&self);
    /// Open the editor right-click context menu (Go to Definition / Find
    /// References) for the identifier under `position` in `pane_id`. Returns
    /// `true` when an identifier was found and the menu was opened.
    fn open_editor_symbol_context_menu(&mut self, pane_id: PaneId, position: Vec2) -> bool;
}
