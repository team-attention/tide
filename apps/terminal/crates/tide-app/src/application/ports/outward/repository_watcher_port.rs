use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) struct RepositoryWatchPaths {
    pub worktree_root: PathBuf,
    pub git_dir: PathBuf,
    pub git_common_dir: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum RepositoryChangeSignal {
    Changed(PathBuf),
    Rescan(PathBuf),
}

pub(crate) trait RepositoryWatcherPort {
    fn init(&mut self, waker: Option<crate::tide_platform::WakeCallback>);
    fn reconcile(&mut self, desired: HashMap<RepositoryWatchPaths, usize>);
    fn drain_changes(&mut self) -> Vec<RepositoryChangeSignal>;
}
