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
        let needs_workspace_symbols = self
            .modal
            .file_finder
            .as_ref()
            .map(|finder| {
                finder.mode == crate::state::FileFinderMode::WorkspaceSymbols
                    && !finder.workspace_symbols_loaded
            })
            .unwrap_or(false);
        if !needs_workspace_symbols {
            return;
        }

        let (base_dir, entries) = {
            let finder = self.modal.file_finder.as_ref().expect("file finder");
            (finder.base_dir.clone(), finder.entries.clone())
        };
        let workspace_symbols = self.build_workspace_file_finder_symbols(&base_dir, &entries);

        if let Some(ref mut finder) = self.modal.file_finder {
            if !finder.workspace_symbols_loaded {
                finder.set_workspace_symbols(workspace_symbols);
            }
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
}
