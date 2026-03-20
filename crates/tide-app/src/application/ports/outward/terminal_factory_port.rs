// TerminalFactoryPort — PTY creation and terminal pane construction.
//
// Abstracts the IO-heavy PTY spawn from domain logic.

use std::path::Path;
use crate::tide_core::PaneId;
use crate::pane::TerminalPane;

type BoxErr = Box<dyn std::error::Error>;

pub(crate) trait TerminalFactoryPort {
    fn create_terminal(&self, id: PaneId, cols: u16, rows: u16, cwd: Option<&Path>, dark_mode: bool) -> Result<TerminalPane, BoxErr>;
    fn pre_spawn_terminal(&self, cols: u16, rows: u16, dark_mode: bool) -> Result<crate::tide_terminal::Terminal, BoxErr>;
}

// ── Real implementation (production) ──

pub(crate) struct RealTerminalFactory;

impl TerminalFactoryPort for RealTerminalFactory {
    fn create_terminal(&self, id: PaneId, cols: u16, rows: u16, cwd: Option<&Path>, dark_mode: bool) -> Result<TerminalPane, BoxErr> {
        TerminalPane::with_cwd(id, cols, rows, cwd.map(|p| p.to_path_buf()), dark_mode)
    }

    fn pre_spawn_terminal(&self, cols: u16, rows: u16, dark_mode: bool) -> Result<crate::tide_terminal::Terminal, BoxErr> {
        crate::tide_terminal::Terminal::with_cwd(cols, rows, None, dark_mode)
    }
}

// ── Noop implementation (tests) ──

pub(crate) struct NoopTerminalFactory;

impl TerminalFactoryPort for NoopTerminalFactory {
    fn create_terminal(&self, _id: PaneId, _cols: u16, _rows: u16, _cwd: Option<&Path>, _dark_mode: bool) -> Result<TerminalPane, BoxErr> {
        Err("NoopTerminalFactory: no terminal in tests".into())
    }

    fn pre_spawn_terminal(&self, _cols: u16, _rows: u16, _dark_mode: bool) -> Result<crate::tide_terminal::Terminal, BoxErr> {
        Err("NoopTerminalFactory: no terminal in tests".into())
    }
}
