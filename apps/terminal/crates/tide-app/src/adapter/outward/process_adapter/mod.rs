// Process adapter implementations.

use std::ffi::OsStr;
use std::io;
use std::path::Path;

use crate::application::ports::outward::process_port::ProcessPort;

/// Real process launcher using std::process::Command.
pub(crate) struct SystemProcess;

fn bundled_tide_app_path_for_executable(exe: &Path) -> Option<&Path> {
    let macos_dir = exe.parent()?;
    if macos_dir.file_name() != Some(OsStr::new("MacOS")) {
        return None;
    }
    let contents_dir = macos_dir.parent()?;
    if contents_dir.file_name() != Some(OsStr::new("Contents")) {
        return None;
    }
    let bundle_dir = contents_dir.parent()?;
    if bundle_dir.extension() != Some(OsStr::new("app")) {
        return None;
    }
    Some(bundle_dir)
}

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

    fn launch_new_tide_window(&self) -> io::Result<()> {
        let exe = std::env::current_exe()?;
        if let Some(bundle_dir) = bundled_tide_app_path_for_executable(&exe) {
            std::process::Command::new("open")
                .arg("-n")
                .arg(bundle_dir)
                .spawn()
                .map(|_| ())
        } else {
            std::process::Command::new(exe).spawn().map(|_| ())
        }
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
