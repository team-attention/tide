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

    /// Install the spawn config (gateway socket + agent integration dirs/flag)
    /// once it is known at startup. Spawned terminals export it into their env.
    fn set_spawn_config(&mut self, config: crate::tide_terminal::TerminalSpawnConfig);

    /// Update whether agent auto-integration is enabled (settings toggle).
    fn set_auto_integration(&mut self, enabled: bool);

    /// Update scrollback line count for future terminal creation.
    fn set_scrollback_lines(&mut self, lines: usize);
}
