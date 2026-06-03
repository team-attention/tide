// FileWatcherPort — watch files for external changes.

use std::path::{Path, PathBuf};

/// Simplified file watch event for the domain layer.
pub(crate) enum FileWatchEvent {
    Modified(PathBuf),
    Created(PathBuf),
    Removed(PathBuf),
}

pub(crate) trait FileWatcherPort {
    fn init(&mut self, waker: Option<crate::tide_platform::WakeCallback>);
    fn watch(&mut self, path: &Path);
    fn unwatch(&mut self, path: &Path);
    fn poll_events(&mut self) -> Vec<FileWatchEvent>;
    fn is_dirty(&self) -> bool;
    fn clear_dirty(&self);
}
