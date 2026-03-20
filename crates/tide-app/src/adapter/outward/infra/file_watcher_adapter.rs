// FileWatcher adapter implementations.

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::application::ports::outward::file_watcher_port::{FileWatcherPort, FileWatchEvent};

// ── Real implementation (production) ──

pub(crate) struct RealFileWatcher {
    watcher: Option<notify::RecommendedWatcher>,
    rx: Option<std::sync::mpsc::Receiver<notify::Result<notify::Event>>>,
    dirty: Arc<AtomicBool>,
    waker: Option<crate::tide_platform::WakeCallback>,
}

impl RealFileWatcher {
    pub fn new() -> Self {
        Self {
            watcher: None,
            rx: None,
            dirty: Arc::new(AtomicBool::new(false)),
            waker: None,
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
}

impl FileWatcherPort for RealFileWatcher {
    fn init(&mut self, waker: Option<crate::tide_platform::WakeCallback>) {
        self.waker = waker;
    }

    fn watch(&mut self, path: &Path) {
        if !self.ensure_watcher() {
            return;
        }
        if let Some(watcher) = self.watcher.as_mut() {
            use notify::Watcher;
            if let Err(e) = watcher.watch(path, notify::RecursiveMode::NonRecursive) {
                log::error!("Failed to watch {:?}: {}", path, e);
            }
        }
    }

    fn unwatch(&mut self, path: &Path) {
        if let Some(watcher) = self.watcher.as_mut() {
            use notify::Watcher;
            let _ = watcher.unwatch(path);
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
                    EventKind::Modify(_) | EventKind::Create(_) => {
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
    fn poll_events(&mut self) -> Vec<FileWatchEvent> { Vec::new() }
    fn is_dirty(&self) -> bool { false }
    fn clear_dirty(&self) {}
}
