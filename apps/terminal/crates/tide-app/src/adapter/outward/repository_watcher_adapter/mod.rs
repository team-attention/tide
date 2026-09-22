use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::application::ports::outward::repository_watcher_port::{
    RepositoryChangeSignal, RepositoryWatchPaths, RepositoryWatcherPort,
};

pub(crate) struct RealRepositoryWatcher {
    watcher: Option<notify::RecommendedWatcher>,
    rx: Option<std::sync::mpsc::Receiver<notify::Result<notify::Event>>>,
    waker: Option<crate::tide_platform::WakeCallback>,
    repositories: HashMap<RepositoryWatchPaths, usize>,
    watched_paths: HashSet<PathBuf>,
}

impl RealRepositoryWatcher {
    pub(crate) fn new() -> Self {
        Self {
            watcher: None,
            rx: None,
            waker: None,
            repositories: HashMap::new(),
            watched_paths: HashSet::new(),
        }
    }

    fn ensure_watcher(&mut self) -> bool {
        if self.watcher.is_some() {
            return true;
        }
        let (tx, rx) = std::sync::mpsc::channel();
        let waker = self.waker.clone();
        match notify::recommended_watcher(move |event| {
            let _ = tx.send(event);
            if let Some(wake) = &waker {
                wake();
            }
        }) {
            Ok(watcher) => {
                self.watcher = Some(watcher);
                self.rx = Some(rx);
                true
            }
            Err(error) => {
                log::error!("Failed to create repository watcher: {error}");
                false
            }
        }
    }

    fn desired_paths(repositories: &HashMap<RepositoryWatchPaths, usize>) -> HashSet<PathBuf> {
        repositories
            .iter()
            .filter(|(_, count)| **count > 0)
            .flat_map(|(paths, _)| {
                [
                    paths.worktree_root.clone(),
                    paths.git_dir.clone(),
                    paths.git_common_dir.clone(),
                ]
            })
            .collect()
    }

    fn watch(&mut self, path: &Path) -> bool {
        let Some(watcher) = self.watcher.as_mut() else {
            return false;
        };
        use notify::Watcher;
        if let Err(error) = watcher.watch(path, notify::RecursiveMode::Recursive) {
            log::error!("Failed to watch repository path {:?}: {error}", path);
            return false;
        }
        true
    }

    fn unwatch(&mut self, path: &Path) {
        let Some(watcher) = self.watcher.as_mut() else {
            return;
        };
        use notify::Watcher;
        let _ = watcher.unwatch(path);
    }
}

impl RepositoryWatcherPort for RealRepositoryWatcher {
    fn init(&mut self, waker: Option<crate::tide_platform::WakeCallback>) {
        self.waker = waker;
    }

    fn reconcile(&mut self, desired: HashMap<RepositoryWatchPaths, usize>) {
        self.repositories = desired;
        let desired_paths = Self::desired_paths(&self.repositories);
        if !desired_paths.is_empty() && !self.ensure_watcher() {
            return;
        }

        for path in self
            .watched_paths
            .difference(&desired_paths)
            .cloned()
            .collect::<Vec<_>>()
        {
            self.unwatch(&path);
            self.watched_paths.remove(&path);
        }
        for path in desired_paths
            .difference(&self.watched_paths)
            .cloned()
            .collect::<Vec<_>>()
        {
            if self.watch(&path) {
                self.watched_paths.insert(path);
            }
        }
    }

    fn drain_changes(&mut self) -> Vec<RepositoryChangeSignal> {
        let Some(rx) = &self.rx else {
            return Vec::new();
        };
        let mut changes = Vec::new();
        while let Ok(result) = rx.try_recv() {
            match result {
                Ok(event) if matches!(event.kind, notify::EventKind::Other) => {
                    changes.extend(
                        self.repositories.keys().map(|paths| {
                            RepositoryChangeSignal::Rescan(paths.worktree_root.clone())
                        }),
                    );
                }
                Ok(event) => {
                    changes.extend(event.paths.into_iter().map(RepositoryChangeSignal::Changed));
                }
                Err(_) => {
                    changes.extend(
                        self.repositories.keys().map(|paths| {
                            RepositoryChangeSignal::Rescan(paths.worktree_root.clone())
                        }),
                    );
                }
            }
        }
        changes
    }
}

pub(crate) struct NoopRepositoryWatcher;

impl RepositoryWatcherPort for NoopRepositoryWatcher {
    fn init(&mut self, _waker: Option<crate::tide_platform::WakeCallback>) {}
    fn reconcile(&mut self, _desired: HashMap<RepositoryWatchPaths, usize>) {}
    fn drain_changes(&mut self) -> Vec<RepositoryChangeSignal> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_watch_registration_is_retried_on_next_reconciliation() {
        let root = std::env::temp_dir().join(format!(
            "tide-repository-watch-retry-{}",
            std::process::id()
        ));
        let paths = RepositoryWatchPaths {
            worktree_root: root.clone(),
            git_dir: root.clone(),
            git_common_dir: root.clone(),
        };
        let desired = HashMap::from([(paths, 1)]);
        let mut watcher = RealRepositoryWatcher::new();

        watcher.reconcile(desired.clone());
        assert!(!watcher.watched_paths.contains(&root));

        std::fs::create_dir_all(&root).unwrap();
        watcher.reconcile(desired);
        assert!(watcher.watched_paths.contains(&root));
        let _ = std::fs::remove_dir_all(root);
    }
}
