use std::path::{Path, PathBuf};

use crate::tide_core::FileTreeSource;

use crate::pane::PaneKind;
use crate::App;
use crate::AppCorePort;
use crate::DockPort;
use crate::FileOpsPort;
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
        let mut entries: Vec<PathBuf> = Self::gather_finder_entries(&base_dir, 8);
        crate::state::sort_file_finder_entries(&mut entries);

        let (symbol_source_pane_id, current_file_symbols) =
            self.build_current_file_finder_symbols(&base_dir);

        let mut state = crate::FileFinderState::new(base_dir, entries).with_symbol_sources(
            symbol_source_pane_id,
            current_file_symbols,
            Vec::new(),
        );
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

    fn ensure_file_finder_workspace_symbols_loaded(&mut self) {
        App::ensure_file_finder_workspace_symbols_loaded(self);
    }

    fn open_editor_symbol_context_menu(
        &mut self,
        pane_id: crate::tide_core::PaneId,
        position: crate::tide_core::Vec2,
    ) -> bool {
        let (line, col) = match self.editor_click_target(pane_id, position) {
            Some(target) => target,
            None => return false,
        };
        let identifier = match self.editor_identifier_at(pane_id, line, col) {
            Some(id) => id,
            None => return false,
        };
        // LSP position: 0-based line + UTF-16 character offset within the line.
        // `col` from editor_click_target is a CHARACTER index.
        let character = match self.panes.get(&pane_id) {
            Some(PaneKind::Editor(pane)) => pane
                .editor
                .buffer
                .line(line)
                .map(|text| text.chars().take(col).map(char::len_utf16).sum())
                .unwrap_or(0),
            _ => 0,
        };
        self.modal.file_tree_rename = None;
        self.modal.context_menu = Some(crate::ContextMenuState {
            target: crate::ContextMenuTarget::EditorSymbol {
                pane_id,
                identifier,
                line,
                character,
            },
            position,
            selected: 0,
        });
        self.cache.invalidate_chrome();
        true
    }

    /// Open or focus a DiffPane for the given CWD.
    /// If a DiffPane with the same CWD already exists, focus and refresh it.
    /// Opens in the dock (right panel), same as browser/editor panes.
    fn open_diff_pane(&mut self, cwd: PathBuf) {
        // Check if already open anywhere -> focus and request a fresh poll.
        // Diff content is produced by the background git poller (no synchronous
        // git on the app thread).
        let existing = self.panes.iter().find_map(|(&tab_id, pane)| match pane {
            PaneKind::Diff(dp) if dp.cwd == cwd => Some(tab_id),
            _ => None,
        });
        if let Some(tab_id) = existing {
            self.focus.focused = Some(tab_id);
            self.router.set_focused(tab_id);
            self.focus.focus_area = crate::state::FocusArea::Dock;
            self.cache.invalidate_chrome();
            self.cache.invalidate_pane(tab_id);
            self.trigger_git_poll();
            return;
        }

        // Create new (empty) DiffPane in the dock; the poller populates it.
        let context_terminal = self.resolve_context_terminal_id();
        let new_id = self.layout.alloc_id();
        let dp = crate::pane::diff::DiffPane::new_empty(new_id, cwd);
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
        // Ask the poller for this cwd's diff now that a DiffPane wants it.
        self.trigger_git_poll();
    }

    fn request_git_poll(&self) {
        self.trigger_git_poll();
    }
}

impl App {
    pub(crate) fn open_file_finder_with_query(
        &mut self,
        query: &str,
        replace_pane_id: Option<crate::tide_core::PaneId>,
    ) {
        self.open_file_finder_with_replace(replace_pane_id);
        if let Some(ref mut finder) = self.modal.file_finder {
            finder.set_query(query.to_string());
        }
        self.ensure_file_finder_workspace_symbols_loaded();
    }

    pub(crate) fn ensure_file_finder_workspace_symbols_loaded(&mut self) {
        // Dispatch the `#` workspace-symbol index build to the background worker
        // (it reads every workspace file — never on the app thread). The
        // `workspace_symbols_loading` guard prevents re-dispatching per keystroke.
        let request = {
            let finder = match self.modal.file_finder.as_mut() {
                Some(f) => f,
                None => return,
            };
            let needs = finder.mode == crate::state::FileFinderMode::WorkspaceSymbols
                && !finder.workspace_symbols_loaded
                && !finder.workspace_symbols_loading;
            if !needs {
                return;
            }
            let request_id = finder.begin_workspace_symbols_load();
            crate::state::background::WorkspaceScanRequest::Symbols {
                request_id,
                base_dir: finder.base_dir.clone(),
                entries: finder.entries_arc(),
            }
        };
        self.start_workspace_scan_worker();
        if let Some(tx) = &self.bg.workspace_scan_tx {
            let _ = tx.send(request);
        }
        self.cache.invalidate_chrome();
    }

    fn build_current_file_finder_symbols(
        &self,
        base_dir: &Path,
    ) -> (
        Option<crate::tide_core::PaneId>,
        Vec<crate::state::SymbolMatch>,
    ) {
        self.focus
            .focused
            .and_then(|pane_id| match self.panes.get(&pane_id) {
                Some(PaneKind::Editor(pane)) => pane.editor.file_path().map(|path| {
                    let rel_path = path
                        .strip_prefix(base_dir)
                        .map(|rel| rel.to_path_buf())
                        .unwrap_or_else(|_| {
                            path.file_name()
                                .map(PathBuf::from)
                                .unwrap_or_else(|| path.to_path_buf())
                        });
                    let symbols =
                        crate::state::collect_symbol_matches(&rel_path, &pane.editor.buffer.lines);
                    (pane_id, symbols)
                }),
                _ => None,
            })
            .map(|(pane_id, symbols)| (Some(pane_id), symbols))
            .unwrap_or((None, Vec::new()))
    }

    pub(crate) fn build_workspace_file_finder_symbols(
        &self,
        base_dir: &Path,
        entries: &[PathBuf],
    ) -> Vec<crate::state::SymbolMatch> {
        let mut workspace_symbols = Vec::new();
        for rel_path in entries {
            let full_path = base_dir.join(rel_path);
            let Ok(contents) = self.read_file_to_string(&full_path) else {
                continue;
            };
            if contents.len() > 256 * 1024 {
                continue;
            }
            let lines: Vec<String> = contents.lines().map(|line| line.to_string()).collect();
            workspace_symbols.extend(crate::state::collect_symbol_matches(rel_path, &lines));
            if workspace_symbols.len() >= 3000 {
                break;
            }
        }
        workspace_symbols
    }

    /// Gather file finder candidates under `base_dir`, respecting `.gitignore`,
    /// `.ignore`, and the global gitignore — the same rules ripgrep/VS Code use,
    /// so generated output (`dist/`, `build/`, `target/`, `node_modules/`, …)
    /// never floods the finder. Returns paths relative to `base_dir`.
    pub(crate) fn gather_finder_entries(
        base_dir: &std::path::Path,
        max_depth: usize,
    ) -> Vec<PathBuf> {
        let mut builder = ignore::WalkBuilder::new(base_dir);
        builder
            .max_depth(Some(max_depth))
            .hidden(true) // skip dotfiles (.git, .DS_Store, …)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .parents(true)
            .require_git(false) // honor .gitignore even outside a git repo
            .follow_links(false);
        // Safety net: always skip heavy generated/VCS directories even when a
        // project ships no `.gitignore` (ripgrep would otherwise descend into
        // `node_modules`/`target` unless they are explicitly ignored).
        builder.filter_entry(|entry| {
            !matches!(
                entry.file_name().to_str(),
                Some(".git" | "node_modules" | "target" | "__pycache__")
            )
        });

        let mut entries: Vec<PathBuf> = Vec::new();
        for result in builder.build() {
            let entry = match result {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            // Files only (the walker yields directories too).
            if entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                if let Ok(rel) = entry.path().strip_prefix(base_dir) {
                    entries.push(rel.to_path_buf());
                }
            }
        }
        entries
    }

    // ── Workspace text search (FileFinder `/` mode) — background worker (P-1) ──

    /// Dispatch a pending workspace text search to the background worker.
    /// `filter` marks `pending_search` when the query changed; this drains it
    /// and hands the scan off-thread (no filesystem I/O on the app thread).
    pub(crate) fn dispatch_pending_file_finder_search(&mut self) {
        let request = {
            let finder = match self.modal.file_finder.as_mut() {
                Some(f) if f.pending_search => f,
                _ => return,
            };
            finder.pending_search = false;
            let query = finder
                .input
                .text
                .strip_prefix('/')
                .unwrap_or(&finder.input.text)
                .to_string();
            crate::state::background::WorkspaceScanRequest::Search {
                query_id: finder.search_request_id,
                base_dir: finder.base_dir.clone(),
                entries: finder.entries_arc(),
                query,
            }
        };
        self.start_workspace_scan_worker();
        if let Some(tx) = &self.bg.workspace_scan_tx {
            let _ = tx.send(request);
        }
    }

    /// Consume workspace-scan results (`/` search + `#` symbols) from the
    /// background worker. Returns true when results were applied (the finder
    /// must repaint). Stale results are dropped by the finder's id checks.
    pub(crate) fn consume_workspace_scan_results(&mut self) -> bool {
        use crate::state::background::WorkspaceScanResult;
        let results: Vec<WorkspaceScanResult> = match self.bg.workspace_scan_rx {
            Some(ref rx) => rx.try_iter().collect(),
            None => return false,
        };
        if results.is_empty() {
            return false;
        }
        let mut changed = false;
        if let Some(finder) = self.modal.file_finder.as_mut() {
            for result in results {
                let applied = match result {
                    WorkspaceScanResult::Search { query_id, hits } => {
                        finder.apply_workspace_search_results(query_id, hits)
                    }
                    WorkspaceScanResult::Symbols {
                        request_id,
                        symbols,
                    } => finder.apply_workspace_symbols(request_id, symbols),
                };
                changed |= applied;
            }
        }
        changed
    }

    /// Start the background workspace-scan worker thread (idempotent).
    pub(crate) fn start_workspace_scan_worker(&mut self) {
        if self.bg.workspace_scan_handle.is_some() {
            return;
        }
        let (req_tx, req_rx) =
            std::sync::mpsc::channel::<crate::state::background::WorkspaceScanRequest>();
        let (res_tx, res_rx) =
            std::sync::mpsc::channel::<crate::state::background::WorkspaceScanResult>();
        self.bg.workspace_scan_tx = Some(req_tx);
        self.bg.workspace_scan_rx = Some(res_rx);

        let stop_flag = self.bg.workspace_scan_stop.clone();
        let waker = self.bg.event_loop_waker.clone();

        let handle = std::thread::Builder::new()
            .name("tide-workspace-scan".to_string())
            .spawn(move || {
                run_workspace_scan_worker(req_rx, res_tx, stop_flag, waker);
            })
            .expect("failed to spawn workspace scan worker");
        self.bg.workspace_scan_handle = Some(handle);
    }
}

fn run_workspace_scan_worker(
    req_rx: std::sync::mpsc::Receiver<crate::state::background::WorkspaceScanRequest>,
    res_tx: std::sync::mpsc::Sender<crate::state::background::WorkspaceScanResult>,
    stop_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
    waker: Option<crate::tide_platform::WakeCallback>,
) {
    use crate::state::background::{WorkspaceScanRequest, WorkspaceScanResult};
    while !stop_flag.load(std::sync::atomic::Ordering::Relaxed) {
        let first = match req_rx.recv_timeout(std::time::Duration::from_secs(2)) {
            Ok(request) => request,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        };

        // Drain the queued batch. Coalesce searches (only the latest matters,
        // fast typing) but run every symbol-index build.
        let mut batch = vec![first];
        while let Ok(more) = req_rx.try_recv() {
            batch.push(more);
        }
        let mut latest_search = None;
        let mut symbol_jobs = Vec::new();
        for request in batch {
            match request {
                search @ WorkspaceScanRequest::Search { .. } => latest_search = Some(search),
                symbols @ WorkspaceScanRequest::Symbols { .. } => symbol_jobs.push(symbols),
            }
        }

        let post = |result: WorkspaceScanResult| {
            let _ = res_tx.send(result);
            if let Some(ref w) = waker {
                w();
            }
        };

        for job in symbol_jobs {
            if let WorkspaceScanRequest::Symbols {
                request_id,
                base_dir,
                entries,
            } = job
            {
                let symbols = scan_workspace_symbols(&base_dir, &entries, &stop_flag);
                post(WorkspaceScanResult::Symbols {
                    request_id,
                    symbols,
                });
            }
        }
        if let Some(WorkspaceScanRequest::Search {
            query_id,
            base_dir,
            entries,
            query,
        }) = latest_search
        {
            let hits = scan_workspace_for_query(&base_dir, &entries, &query, &stop_flag);
            post(WorkspaceScanResult::Search { query_id, hits });
        }
    }
}

/// Scan workspace `entries` (relative to `base_dir`) for symbol definitions
/// (P-2 `#` mode). Metadata-first 256 KB skip, capped at 3000 symbols. Runs on
/// the background worker — never the app thread.
pub(crate) fn scan_workspace_symbols(
    base_dir: &Path,
    entries: &[PathBuf],
    stop_flag: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Vec<crate::state::SymbolMatch> {
    let mut symbols = Vec::new();
    for rel_path in entries.iter() {
        if stop_flag.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
        let full_path = base_dir.join(rel_path);
        match std::fs::metadata(&full_path) {
            Ok(meta) if meta.len() <= 256 * 1024 => {}
            _ => continue,
        }
        let Ok(contents) = std::fs::read_to_string(&full_path) else {
            continue;
        };
        let lines: Vec<String> = contents.lines().map(|line| line.to_string()).collect();
        symbols.extend(crate::state::collect_symbol_matches(rel_path, &lines));
        if symbols.len() >= 3000 {
            break;
        }
    }
    symbols
}

/// Scan workspace `entries` (relative to `base_dir`) for `query`, case-insensitively,
/// without allocating a lowercased copy of every line. Skips files larger than
/// 256 KB via metadata (no read) and caps results.
pub(crate) fn scan_workspace_for_query(
    base_dir: &Path,
    entries: &[PathBuf],
    query: &str,
    stop_flag: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Vec<crate::state::WorkspaceSearchHit> {
    let mut hits = Vec::new();
    if query.chars().count() < 2 {
        return hits;
    }
    for rel_path in entries.iter() {
        if stop_flag.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
        let full_path = base_dir.join(rel_path);
        // Metadata-first: skip oversized files WITHOUT reading them.
        match std::fs::metadata(&full_path) {
            Ok(meta) if meta.len() <= 256 * 1024 => {}
            _ => continue,
        }
        let Ok(contents) = std::fs::read_to_string(&full_path) else {
            continue;
        };
        for (line_idx, line) in contents.lines().enumerate() {
            if let Some(byte_col) = find_ascii_case_insensitive(line, query) {
                if !line.is_char_boundary(byte_col) {
                    continue;
                }
                let col = line[..byte_col].chars().count() + 1;
                hits.push(crate::state::WorkspaceSearchHit {
                    path: rel_path.clone(),
                    line: line_idx + 1,
                    col,
                    preview: line.trim().to_string(),
                });
                if hits.len() >= crate::state::FILE_FINDER_MAX_WORKSPACE_SEARCH_HITS {
                    return hits;
                }
            }
        }
    }
    hits
}

/// Case-insensitive (ASCII-folded) substring search returning the byte offset of
/// the first match, without allocating. Non-ASCII bytes compare exactly, so
/// UTF-8 content is matched literally.
fn find_ascii_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    let h = haystack.as_bytes();
    let n = needle.as_bytes();
    if n.is_empty() {
        return Some(0);
    }
    if n.len() > h.len() {
        return None;
    }
    (0..=(h.len() - n.len())).find(|&i| h[i..i + n.len()].eq_ignore_ascii_case(n))
}
