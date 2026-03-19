// ProcessPort — abstracts external process launching for testability.

use std::io;
use std::path::Path;

pub(crate) trait ProcessPort {
    fn open_with_default_app(&self, path: &Path) -> io::Result<()>;
    fn reveal_in_finder(&self, path: &Path) -> io::Result<()>;
    fn open_url(&self, url: &str) -> io::Result<()>;
}

/// Real process launcher using std::process::Command.
pub(crate) struct SystemProcess;

impl ProcessPort for SystemProcess {
    fn open_with_default_app(&self, path: &Path) -> io::Result<()> {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map(|_| ())
    }

    fn reveal_in_finder(&self, path: &Path) -> io::Result<()> {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map(|_| ())
    }

    fn open_url(&self, url: &str) -> io::Result<()> {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map(|_| ())
    }
}

/// Noop process launcher for tests.
pub(crate) struct NoopProcess;

impl ProcessPort for NoopProcess {
    fn open_with_default_app(&self, _path: &Path) -> io::Result<()> {
        Ok(())
    }

    fn reveal_in_finder(&self, _path: &Path) -> io::Result<()> {
        Ok(())
    }

    fn open_url(&self, _url: &str) -> io::Result<()> {
        Ok(())
    }
}
