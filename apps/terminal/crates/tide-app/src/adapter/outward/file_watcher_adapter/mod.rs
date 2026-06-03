// FileWatcher adapter implementations.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::application::ports::outward::file_watcher_port::{FileWatchEvent, FileWatcherPort};

// ── Real implementation (production) ──

struct WatchedFile {
    file_watch_path: PathBuf,
    parent_key: Option<PathBuf>,
    ref_count: usize,
}

struct WatchedDirectory {
    watch_path: PathBuf,
    ref_count: usize,
}

pub(crate) struct RealFileWatcher {
    watcher: Option<notify::RecommendedWatcher>,
    rx: Option<std::sync::mpsc::Receiver<notify::Result<notify::Event>>>,
    dirty: Arc<AtomicBool>,
    waker: Option<crate::tide_platform::WakeCallback>,
    watched_files: HashMap<PathBuf, WatchedFile>,
    watched_directories: HashMap<PathBuf, WatchedDirectory>,
}

impl RealFileWatcher {
    pub fn new() -> Self {
        Self {
            watcher: None,
            rx: None,
            dirty: Arc::new(AtomicBool::new(false)),
            waker: None,
            watched_files: HashMap::new(),
            watched_directories: HashMap::new(),
        }
    }

    fn ensure_watcher(&mut self) -> bool {
        if self.watcher.is_some() {
            return true;
        }
        let (tx, rx) = std::sync::mpsc::channel();
        let waker = self.waker.clone();
        let dirty_flag = self.dirty.clone();
        match notify::recommended_watcher(move |event| {
            let _ = tx.send(event);
            dirty_flag.store(true, Ordering::Relaxed);
            if let Some(ref w) = waker {
                w();
            }
        }) {
            Ok(watcher) => {
                self.watcher = Some(watcher);
                self.rx = Some(rx);
                true
            }
            Err(e) => {
                log::error!("Failed to create file watcher: {}", e);
                false
            }
        }
    }

    fn watch_path_key(path: &Path) -> PathBuf {
        if let Ok(canonical) = std::fs::canonicalize(path) {
            return canonical;
        }

        if let (Some(parent), Some(file_name)) = (path.parent(), path.file_name()) {
            if let Ok(canonical_parent) = std::fs::canonicalize(parent) {
                return canonical_parent.join(file_name);
            }
        }

        path.to_path_buf()
    }

    fn watch_parent_directory(&mut self, parent_path: &Path) -> Option<PathBuf> {
        let parent_key = Self::watch_path_key(parent_path);
        if let Some(watched) = self.watched_directories.get_mut(&parent_key) {
            watched.ref_count += 1;
            return Some(parent_key);
        }

        if let Some(watcher) = self.watcher.as_mut() {
            use notify::Watcher;
            if let Err(e) = watcher.watch(parent_path, notify::RecursiveMode::NonRecursive) {
                log::error!("Failed to watch parent directory {:?}: {}", parent_path, e);
                return None;
            }
        }

        self.watched_directories.insert(
            parent_key.clone(),
            WatchedDirectory {
                watch_path: parent_path.to_path_buf(),
                ref_count: 1,
            },
        );
        Some(parent_key)
    }

    fn unwatch_parent_directory(&mut self, parent_key: &Path) {
        let mut remove = false;
        if let Some(watched) = self.watched_directories.get_mut(parent_key) {
            watched.ref_count = watched.ref_count.saturating_sub(1);
            remove = watched.ref_count == 0;
        }
        if !remove {
            return;
        }

        let Some(watched) = self.watched_directories.remove(parent_key) else {
            return;
        };
        if let Some(watcher) = self.watcher.as_mut() {
            use notify::Watcher;
            let _ = watcher.unwatch(&watched.watch_path);
        }
    }
}

impl FileWatcherPort for RealFileWatcher {
    fn init(&mut self, waker: Option<crate::tide_platform::WakeCallback>) {
        self.waker = waker;
    }

    fn watch(&mut self, path: &Path) {
        if !self.ensure_watcher() {
            return;
        }
        let file_key = Self::watch_path_key(path);
        if let Some(watched) = self.watched_files.get_mut(&file_key) {
            watched.ref_count += 1;
            return;
        }

        if let Some(watcher) = self.watcher.as_mut() {
            use notify::Watcher;
            if let Err(e) = watcher.watch(path, notify::RecursiveMode::NonRecursive) {
                log::error!("Failed to watch {:?}: {}", path, e);
            }
        }

        let parent_key = path
            .parent()
            .and_then(|parent| self.watch_parent_directory(parent));
        self.watched_files.insert(
            file_key,
            WatchedFile {
                file_watch_path: path.to_path_buf(),
                parent_key,
                ref_count: 1,
            },
        );
    }

    fn unwatch(&mut self, path: &Path) {
        let file_key = Self::watch_path_key(path);
        if let Some(watched) = self.watched_files.get_mut(&file_key) {
            watched.ref_count = watched.ref_count.saturating_sub(1);
            if watched.ref_count > 0 {
                return;
            }
        }
        let watched_file = self.watched_files.remove(&file_key);
        if let Some(watcher) = self.watcher.as_mut() {
            use notify::Watcher;
            let unwatch_path = watched_file
                .as_ref()
                .map(|watched| watched.file_watch_path.as_path())
                .unwrap_or(path);
            let _ = watcher.unwatch(unwatch_path);
        }
        if let Some(parent_key) = watched_file.and_then(|watched| watched.parent_key) {
            self.unwatch_parent_directory(&parent_key);
        }
    }

    fn poll_events(&mut self) -> Vec<FileWatchEvent> {
        let rx = match self.rx.as_ref() {
            Some(rx) => rx,
            None => return Vec::new(),
        };
        let mut events = Vec::new();
        while let Ok(event_result) = rx.try_recv() {
            if let Ok(event) = event_result {
                use notify::EventKind;
                match event.kind {
                    EventKind::Modify(_)
                    | EventKind::Create(_)
                    | EventKind::Any
                    | EventKind::Other => {
                        for path in event.paths {
                            if matches!(event.kind, EventKind::Create(_)) {
                                events.push(FileWatchEvent::Created(path));
                            } else {
                                events.push(FileWatchEvent::Modified(path));
                            }
                        }
                    }
                    EventKind::Remove(_) => {
                        for path in event.paths {
                            events.push(FileWatchEvent::Removed(path));
                        }
                    }
                    _ => {}
                }
            }
        }
        events
    }

    fn is_dirty(&self) -> bool {
        self.dirty.load(Ordering::Relaxed)
    }

    fn clear_dirty(&self) {
        self.dirty.store(false, Ordering::Relaxed);
    }
}

// ── Noop implementation (tests) ──

pub(crate) struct NoopFileWatcher;

impl FileWatcherPort for NoopFileWatcher {
    fn init(&mut self, _waker: Option<crate::tide_platform::WakeCallback>) {}
    fn watch(&mut self, _path: &Path) {}
    fn unwatch(&mut self, _path: &Path) {}
    fn poll_events(&mut self) -> Vec<FileWatchEvent> {
        Vec::new()
    }
    fn is_dirty(&self) -> bool {
        false
    }
    fn clear_dirty(&self) {}
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    static NEXT_TEST_DIR_ID: AtomicUsize = AtomicUsize::new(0);

    fn temp_fixture_dir(label: &str) -> PathBuf {
        let id = NEXT_TEST_DIR_ID.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "tide_file_watcher_adapter_{}_{}_{}",
            std::process::id(),
            id,
            label
        ))
    }

    #[test]
    fn parent_directory_watches_are_reference_counted() {
        let fixture_root = temp_fixture_dir("parent-ref-count");
        std::fs::create_dir_all(&fixture_root).unwrap();

        let mut watcher = RealFileWatcher::new();
        let parent_key = watcher.watch_parent_directory(&fixture_root).unwrap();
        let duplicate_key = watcher.watch_parent_directory(&fixture_root).unwrap();

        assert_eq!(parent_key, duplicate_key);
        assert_eq!(watcher.watched_directories.len(), 1);
        assert_eq!(
            watcher
                .watched_directories
                .get(&parent_key)
                .map(|watched| watched.ref_count),
            Some(2)
        );

        watcher.unwatch_parent_directory(&parent_key);
        assert_eq!(
            watcher
                .watched_directories
                .get(&parent_key)
                .map(|watched| watched.ref_count),
            Some(1)
        );

        watcher.unwatch_parent_directory(&parent_key);
        assert!(watcher.watched_directories.is_empty());

        let _ = std::fs::remove_dir_all(fixture_root);
    }
}
