// PaneLifecyclePort — pane creation, closing, and replacement.
// Source: domain/action/pane_create.rs + domain/action/pane_close.rs

use crate::tide_core::PaneId;
use std::path::PathBuf;

pub(crate) trait PaneLifecyclePort {
    // ── Creation ──
    fn create_terminal_pane(&mut self, id: PaneId, cwd: Option<PathBuf>);
    fn respawn_terminal(&mut self, id: PaneId);
    fn resolve_context_terminal_id(&self) -> Option<PaneId>;
    fn focused_terminal_cwd(&self) -> Option<PathBuf>;
    fn new_editor_pane(&mut self);
    fn new_terminal_tab(&mut self);
    fn open_launcher_pane(&mut self);
    fn open_stacked_launcher_pane(&mut self);
    fn resolve_launcher(&mut self, launcher_id: PaneId, choice: crate::action::LauncherChoice);
    fn split_with_launcher(&mut self, direction: crate::tide_core::SplitDirection);
    fn open_browser_pane(&mut self, url: Option<String>);
    fn open_browser_pane_in_context_with_activation(
        &mut self,
        url: Option<String>,
        context_terminal: Option<PaneId>,
        activate: bool,
    ) -> Option<PaneId>;
    fn replace_pane_with_editor(&mut self, pane_id: PaneId, path: PathBuf);
    fn open_editor_pane(&mut self, path: PathBuf);
    fn open_editor_pane_in_context_with_activation(
        &mut self,
        path: PathBuf,
        context_terminal: Option<PaneId>,
        activate: bool,
    ) -> Option<PaneId>;
    fn open_editor_pane_at_line(&mut self, path: PathBuf, line: Option<usize>);
    fn open_render_pane(&mut self, title: String, html: String) -> PaneId;
    fn open_render_stream_pane(&mut self, title: String) -> PaneId;

    // ── Closing ──
    fn close_editor_panel_tab(&mut self, tab_id: PaneId);
    fn force_close_editor_panel_tab(&mut self, tab_id: PaneId);
    fn complete_save_as(&mut self, pane_id: PaneId, filename: &str);
    fn close_specific_pane_with_split_animation(&mut self, pane_id: PaneId);
    fn close_specific_pane(&mut self, pane_id: PaneId);
    fn force_close_specific_pane(&mut self, pane_id: PaneId);
    fn confirm_save_and_close(&mut self);
    fn confirm_discard_and_close(&mut self);
    fn cancel_save_confirm(&mut self);
    fn confirm_branch_delete(&mut self);
    fn confirm_branch_keep(&mut self);
    fn cancel_branch_cleanup(&mut self);
}
