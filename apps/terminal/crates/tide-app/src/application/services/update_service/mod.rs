use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::tide_core::TerminalBackend;

use super::path_identity::paths_refer_to_same_file;
use crate::application::ports::outward::file_watcher_port::FileWatchEvent;
use crate::pane::PaneKind;
use crate::search;
use crate::App;
use crate::PaneLifecyclePort;

fn editor_file_parent_matches(file_path: &Path, directory_path: &Path) -> bool {
    file_path
        .parent()
        .is_some_and(|parent| paths_refer_to_same_file(parent, directory_path))
}

impl App {
    /// Start watching a file path for changes.
    pub(crate) fn watch_file(&mut self, path: &std::path::Path) {
        self.ports.file_watcher.watch(path);
    }

    /// Stop watching a file path.
    pub(crate) fn unwatch_file(&mut self, path: &std::path::Path) {
        self.ports.file_watcher.unwatch(path);
    }

    fn expand_clean_editor_paths_for_directory_watch_events(
        &self,
        changed_paths: &mut HashSet<PathBuf>,
    ) {
        let directory_paths: Vec<PathBuf> = changed_paths
            .iter()
            .filter(|path| path.is_dir())
            .cloned()
            .collect();

        for directory_path in directory_paths {
            for pane in self.panes.values() {
                let PaneKind::Editor(editor_pane) = pane else {
                    continue;
                };
                if editor_pane.editor.is_modified() {
                    continue;
                }
                let Some(file_path) = editor_pane.editor.file_path() else {
                    continue;
                };
                if editor_file_parent_matches(file_path, &directory_path) {
                    changed_paths.insert(file_path.to_path_buf());
                }
            }
        }
    }

    fn promote_existing_removed_paths_to_changes(
        &self,
        changed_paths: &mut HashSet<PathBuf>,
        removed_paths: &mut HashSet<PathBuf>,
    ) {
        let existing_removed_paths: Vec<PathBuf> = removed_paths
            .iter()
            .filter(|path| path.exists())
            .cloned()
            .collect();
        for path in existing_removed_paths {
            removed_paths.remove(&path);
            changed_paths.insert(path);
        }

        let existing_changed_paths: Vec<PathBuf> = changed_paths
            .iter()
            .filter(|path| path.exists())
            .cloned()
            .collect();
        removed_paths.retain(|removed_path| {
            !existing_changed_paths
                .iter()
                .any(|changed_path| paths_refer_to_same_file(changed_path, removed_path))
        });
    }

    pub(crate) fn drain_editor_file_watch_events(&mut self) {
            let events = self.ports.file_watcher.poll_events();
            let mut changed_paths: HashSet<PathBuf> = HashSet::new();
            let mut removed_paths: HashSet<PathBuf> = HashSet::new();
            for event in events {
                match event {
                FileWatchEvent::Modified(path) | FileWatchEvent::Created(path) => {
                    changed_paths.insert(path);
                    }
                FileWatchEvent::Removed(path) => {
                    removed_paths.insert(path);
                    }
                }
            }
            self.promote_existing_removed_paths_to_changes(&mut changed_paths, &mut removed_paths);
            self.expand_clean_editor_paths_for_directory_watch_events(&mut changed_paths);

            for changed_path in &changed_paths {
            let matching_ids: Vec<crate::tide_core::PaneId> = self
                .panes
                        .iter()
                        .filter_map(|(&id, pane)| {
                            if let PaneKind::Editor(editor) = pane {
                        if editor
                            .editor
                            .file_path()
                            .is_some_and(|path| paths_refer_to_same_file(path, changed_path))
                        {
                                    return Some(id);
                                }
                            }
                            None
                        })
                        .collect();
                let file_exists = changed_path.exists();

                for id in matching_ids {
                    if let Some(PaneKind::Editor(editor_pane)) = self.panes.get_mut(&id) {
                        if !file_exists {
                            if !editor_pane.editor.is_modified() {
                                removed_paths.insert(changed_path.clone());
                            } else {
                                editor_pane.disk_changed = true;
                                editor_pane.file_deleted = true;
                                editor_pane.diff_mode = false;
                                editor_pane.disk_content = None;
                            }
                        } else {
                            editor_pane.file_deleted = false;
                            editor_pane.diff_mode = false;
                            editor_pane.disk_content = None;
                            if !editor_pane.editor.is_modified() {
                            if let Err(error) = editor_pane.editor.reload() {
                                log::error!("Failed to reload {:?}: {}", changed_path, error);
                                }
                                editor_pane.disk_changed = false;
                            } else {
                                editor_pane.disk_changed = true;
                            }
                        }
                        self.cache.invalidate_chrome();
                        self.cache.invalidate_pane(id);
                    }
                }
            }

        let mut tabs_to_close = Vec::new();
            for removed_path in &removed_paths {
            let matching_ids: Vec<crate::tide_core::PaneId> = self
                .panes
                        .iter()
                        .filter_map(|(&id, pane)| {
                            if let PaneKind::Editor(editor) = pane {
                        if editor
                            .editor
                            .file_path()
                            .is_some_and(|path| paths_refer_to_same_file(path, removed_path))
                        {
                                    return Some(id);
                                }
                            }
                            None
                        })
                        .collect();

                for id in matching_ids {
                    if let Some(PaneKind::Editor(editor_pane)) = self.panes.get_mut(&id) {
                        if !editor_pane.editor.is_modified() {
                            tabs_to_close.push(id);
                        } else {
                            editor_pane.disk_changed = true;
                            editor_pane.file_deleted = true;
                            editor_pane.diff_mode = false;
                            editor_pane.disk_content = None;
                            self.cache.invalidate_chrome();
                            self.cache.invalidate_pane(id);
                        }
                    }
                }
            }
            for tab_id in tabs_to_close {
                self.close_editor_panel_tab(tab_id);
            }
            if !changed_paths.is_empty() || !removed_paths.is_empty() {
            self.request_git_refresh(crate::state::background::GitRefreshCause::RepositoryChanged);
        }
    }

    pub(crate) fn update(&mut self) {
        // Rapid-update detection: when frames are coming faster than 8ms,
        // skip non-critical work (browser sync, file tree, badge updates)
        // to keep drag and resize interactions smooth.
        let now = self.ports.clock.now();
        let is_rapid =
            now.duration_since(self.timing.last_frame) < std::time::Duration::from_millis(8);

        // Process PTY output for terminal panes only
        for pane in self.panes.values_mut() {
            if let PaneKind::Terminal(terminal) = pane {
                if terminal.cursor_suppress > 0 {
                    terminal.cursor_suppress -= 1;
                    self.cache.needs_redraw = true;
                }
                let old_gen = terminal.backend.grid_generation();
                let t0 = std::time::Instant::now();
                terminal.backend.process();
                let elapsed = t0.elapsed();
                if elapsed.as_micros() > 0 {
                    log::trace!("process: {}us", elapsed.as_micros());
                }
                // Re-execute search when terminal output changes
                if terminal.backend.grid_generation() != old_gen {
                    if let Some(ref mut s) = terminal.search {
                        if !s.input.is_empty() {
                            search::execute_search_terminal(s, &terminal.backend);
                        }
                    }
                }
            }
        }

        // Poll file tree events — skip during rapid updates
        if !is_rapid {
            if let Some(tree) = self.ft.tree.as_mut() {
                if matches!(
                    tree.drain_events(now),
                    crate::tide_tree::FsTreeDrain::Refreshed
                ) {
                    // Trigger git poller to refresh status asynchronously
                    // instead of blocking the app-thread with synchronous git calls.
                    self.sync_file_tree_path_identity_cache();
                    self.request_git_refresh(
                        crate::state::background::GitRefreshCause::RepositoryChanged,
                    );
                    self.cache.invalidate_chrome();
                }
            }
        }

        self.drain_repository_changes(now);
        self.refresh_repository_if_due(now);

        // Detect editor is_modified() transitions (catches undo back to clean state).
        // Only re-check when the buffer generation has changed to avoid expensive
        // Vec<String> comparison on every frame.
        {
            let mut modified_changed = false;
            for pane in self.panes.values_mut() {
                if let PaneKind::Editor(ep) = pane {
                    let gen = ep.editor.generation();
                    if gen != ep.last_checked_gen {
                        ep.last_checked_gen = gen;
                        let current = ep.editor.is_modified();
                        if current != ep.last_is_modified {
                            ep.last_is_modified = current;
                            modified_changed = true;
                        }
                    }
                }
            }
            if modified_changed {
                self.sync_file_tree_modified_editor_cache();
                self.cache.invalidate_chrome();
            }
        }

        self.drain_editor_file_watch_events();

        // Clamp file tree scroll to valid range after resize, collapse, or tree changes.
        if self.ft.visible {
            let max = self.file_tree_max_scroll();
            if self.ft.scroll_target > max {
                self.ft.scroll_target = max;
            }
            if self.ft.scroll > max {
                self.ft.scroll = max;
            }
        }

        // Smooth scroll animation
        const SCROLL_LERP: f32 = 0.45;
        const SCROLL_SNAP: f32 = 0.5;

        let ft_diff = self.ft.scroll_target - self.ft.scroll;
        if ft_diff.abs() > SCROLL_SNAP {
            self.ft.scroll += ft_diff * SCROLL_LERP;
            self.cache.invalidate_chrome();
        } else if ft_diff.abs() > 0.0 {
            // Final snap (< 0.5px) — set position but skip chrome rebuild.
            // Next natural chrome rebuild will use the correct final value.
            self.ft.scroll = self.ft.scroll_target;
        }

        // Consume git info from background poller (non-blocking).
        // Skip during rapid updates — badge refresh is cosmetic, not critical.
        if !is_rapid {
            self.update_terminal_badges();
        }

        // Start git poller if not yet running
        if self.bg.git_worker_handle.is_none() {
            self.start_git_refresh_worker();
            self.request_git_refresh(crate::state::background::GitRefreshCause::Startup);
        }
    }
}
