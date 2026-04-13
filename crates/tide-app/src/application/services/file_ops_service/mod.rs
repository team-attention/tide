use std::path::PathBuf;

use crate::tide_core::FileTreeSource;

use crate::pane::PaneKind;
use crate::App;
use crate::DockPort;
use crate::LayoutPort;
use crate::PaneLifecyclePort;

impl crate::FileOpsPort for App {
    /// Get a working directory for file operations: try focused terminal, then any terminal,
    /// then file tree root, then std::env::current_dir.
    fn resolve_base_dir(&self) -> PathBuf {
        // 1. Focused terminal CWD
        if let Some(cwd) = self.focused_terminal_cwd() {
            return cwd;
        }
        // 2. Any terminal pane's CWD
        for pane in self.panes.values() {
            if let PaneKind::Terminal(p) = pane {
                if let Some(cwd) = p.backend.detect_cwd_fallback() {
                    return cwd;
                }
            }
        }
        // 3. File tree root
        if let Some(ref tree) = self.ft.tree {
            let root = tree.root();
            if root.is_dir() {
                return root.to_path_buf();
            }
        }
        // 4. Fallback
        self.ports
            .fs
            .current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
    }

    /// Open the file finder UI (floating popup).
    /// If `replace_pane_id` is Some, the selected file will replace that pane
    /// instead of opening as a new tab.
    fn open_file_finder_with_replace(&mut self, replace_pane_id: Option<crate::tide_core::PaneId>) {
        // Cancel any in-progress drag when opening a modal
        self.interaction.pane_drag = crate::state::drag_types::PaneDragState::Idle;
        self.interaction.drop_preview_start = None;

        let base_dir = self.resolve_base_dir();
        let mut entries: Vec<PathBuf> = Vec::new();
        Self::scan_dir(&base_dir, &base_dir, &mut entries, 0, 8);
        entries.sort();

        let mut state = crate::FileFinderState::new(base_dir, entries);
        state.replace_pane_id = replace_pane_id;
        self.modal.file_finder = Some(state);
        self.cache.invalidate_chrome();
        // Hide browser webviews so they don't cover the popup
        self.sync_browser_webview_frames();
    }

    /// Open the file finder UI (floating popup).
    fn open_file_finder(&mut self) {
        self.open_file_finder_with_replace(None);
    }

    /// Close the file finder UI.
    fn close_file_finder(&mut self) {
        if self.modal.clear_file_finder() {
            self.cache.invalidate_chrome();
            // Re-show browser webviews that were hidden for the popup
            self.sync_browser_webview_frames();
        }
    }

    /// Open or focus a DiffPane for the given CWD.
    /// If a DiffPane with the same CWD already exists, focus and refresh it.
    /// Opens in the dock (right panel), same as browser/editor panes.
    fn open_diff_pane(&mut self, cwd: PathBuf) {
        // Check if already open anywhere -> refresh and focus
        for (&tab_id, pane) in &mut self.panes {
            if let PaneKind::Diff(dp) = pane {
                if dp.cwd == cwd {
                    dp.refresh();
                    self.focus.focused = Some(tab_id);
                    self.router.set_focused(tab_id);
                    self.focus.focus_area = crate::state::FocusArea::Dock;
                    self.cache.invalidate_chrome();
                    self.cache.invalidate_pane(tab_id);
                    return;
                }
            }
        }

        // Create new DiffPane in the dock
        let context_terminal = self.resolve_context_terminal_id();
        let new_id = self.layout.alloc_id();
        let dp = crate::pane::diff::DiffPane::new(new_id, cwd);
        self.panes.insert(new_id, PaneKind::Diff(dp));
        if let Some(tid) = self.live_dock_terminal_for_context(context_terminal) {
            self.add_pane_to_dock(new_id, Some(tid));
            self.assoc.associated_terminal.insert(new_id, tid);
            self.focus.focus_area = crate::state::FocusArea::Dock;
        } else {
            // Fallback: split next to focused if no terminal context
            let focused = match self.focus.focused {
                Some(id) => id,
                None => return,
            };
            self.layout.insert_pane(
                focused,
                new_id,
                crate::tide_core::SplitDirection::Vertical,
                false,
            );
        }
        self.focus.focused = Some(new_id);
        self.router.set_focused(new_id);
        self.cache.invalidate_chrome();
        self.compute_layout();
    }
}

impl App {
    /// Recursively scan a directory, collecting file paths relative to base_dir.
    fn scan_dir(
        dir: &std::path::Path,
        base_dir: &std::path::Path,
        entries: &mut Vec<PathBuf>,
        depth: usize,
        max_depth: usize,
    ) {
        if depth > max_depth {
            return;
        }
        let read_dir = match std::fs::read_dir(dir) {
            Ok(rd) => rd,
            Err(_) => return,
        };
        let mut subdirs: Vec<PathBuf> = Vec::new();
        for entry in read_dir.flatten() {
            let path = entry.path();
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy();

            // Skip .git and common large/generated directories
            if name == ".git" || name == "node_modules" || name == "target" || name == "__pycache__"
            {
                continue;
            }

            if path.is_dir() {
                subdirs.push(path);
            } else if path.is_file() {
                if let Ok(rel) = path.strip_prefix(base_dir) {
                    entries.push(rel.to_path_buf());
                }
            }
        }
        for subdir in subdirs {
            Self::scan_dir(&subdir, base_dir, entries, depth + 1, max_depth);
        }
    }
}
