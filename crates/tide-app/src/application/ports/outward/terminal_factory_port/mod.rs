// TerminalFactoryPort — PTY creation and terminal pane construction.

use crate::pane::TerminalPane;
use crate::tide_core::{PaneId, TideWindowId};
use std::path::Path;

type BoxErr = Box<dyn std::error::Error>;

pub(crate) trait TerminalFactoryPort {
    fn create_terminal(
        &self,
        id: PaneId,
        cols: u16,
        rows: u16,
        cwd: Option<&Path>,
        dark_mode: bool,
        tide_window_id: TideWindowId,
        workspace_name: Option<&str>,
    ) -> Result<TerminalPane, BoxErr>;
    fn pre_spawn_terminal(
        &self,
        cols: u16,
        rows: u16,
        dark_mode: bool,
        pane_id: Option<PaneId>,
        tide_window_id: TideWindowId,
        workspace_name: Option<&str>,
    ) -> Result<crate::tide_terminal::Terminal, BoxErr>;
}
