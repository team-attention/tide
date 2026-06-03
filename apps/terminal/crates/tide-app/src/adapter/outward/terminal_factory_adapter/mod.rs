// TerminalFactory adapter implementations.

use crate::application::ports::outward::terminal_factory_port::TerminalFactoryPort;
use crate::pane::TerminalPane;
use crate::tide_core::{PaneId, TideWindowId};
use std::path::Path;

type BoxErr = Box<dyn std::error::Error>;

// ── Real implementation (production) ──

pub(crate) struct RealTerminalFactory;

impl TerminalFactoryPort for RealTerminalFactory {
    fn create_terminal(
        &self,
        id: PaneId,
        cols: u16,
        rows: u16,
        cwd: Option<&Path>,
        dark_mode: bool,
        tide_window_id: TideWindowId,
        workspace_name: Option<&str>,
    ) -> Result<TerminalPane, BoxErr> {
        TerminalPane::with_cwd_for_window(
            id,
            cols,
            rows,
            cwd.map(|p| p.to_path_buf()),
            dark_mode,
            tide_window_id,
            workspace_name,
        )
    }

    fn pre_spawn_terminal(
        &self,
        cols: u16,
        rows: u16,
        dark_mode: bool,
        pane_id: Option<PaneId>,
        tide_window_id: TideWindowId,
        workspace_name: Option<&str>,
    ) -> Result<crate::tide_terminal::Terminal, BoxErr> {
        crate::tide_terminal::Terminal::with_cwd_for_window(
            cols,
            rows,
            None,
            dark_mode,
            pane_id.map(|id| id as u64),
            Some(tide_window_id),
            workspace_name,
        )
    }
}

// ── Noop implementation (tests) ──

pub(crate) struct NoopTerminalFactory;

impl TerminalFactoryPort for NoopTerminalFactory {
    fn create_terminal(
        &self,
        _id: PaneId,
        _cols: u16,
        _rows: u16,
        _cwd: Option<&Path>,
        _dark_mode: bool,
        _tide_window_id: TideWindowId,
        _workspace_name: Option<&str>,
    ) -> Result<TerminalPane, BoxErr> {
        Err("NoopTerminalFactory: no terminal in tests".into())
    }

    fn pre_spawn_terminal(
        &self,
        _cols: u16,
        _rows: u16,
        _dark_mode: bool,
        _pane_id: Option<PaneId>,
        _tide_window_id: TideWindowId,
        _workspace_name: Option<&str>,
    ) -> Result<crate::tide_terminal::Terminal, BoxErr> {
        Err("NoopTerminalFactory: no terminal in tests".into())
    }
}
