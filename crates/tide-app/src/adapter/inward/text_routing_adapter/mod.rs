//! Unified text input routing.
//!
//! Every path that inserts text (IME Commit, keyboard Released handler,
//! future clipboard paste, etc.) calls `send_text_to_target()` which
//! uses `text_input_target()` to determine the single correct destination.

use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::AppCorePort;
use crate::FocusNavPort;
use crate::ModalPort;
use crate::PaneAccessPort;

/// Where text input should be directed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TextInputTarget {
    ConfigPageCopyFiles,
    ConfigPageWorktree,
    FileTreeRename,
    GitSwitcher,
    FileFinder,
    SaveAsInput,
    ContextCommentComposer,
    SearchBar(crate::tide_core::PaneId),
    BrowserUrlBar(crate::tide_core::PaneId),
    Pane(crate::tide_core::PaneId),
    /// Input should be silently consumed (modal popup, file tree focus, etc.)
    Consumed,
}

// ── Trait alias for text routing ports ──

pub(crate) trait TextRoutingPorts:
    AppCorePort + FocusNavPort + ModalPort + PaneAccessPort
{
}
impl<T: AppCorePort + FocusNavPort + ModalPort + PaneAccessPort> TextRoutingPorts for T {}

/// Determine where text input should be routed based on current UI state.
/// Checks modals/popups first (highest priority), then focus area.
/// This is the single source of truth — keyboard, IME, and Released
/// handlers all use this instead of maintaining separate if-else chains.
pub(crate) fn text_input_target(ctx: &impl TextRoutingPorts) -> TextInputTarget {
    // Modal overlays (highest priority)
    let modal = ctx.modal();
    if let Some(ref page) = modal.config_page {
        return if page.copy_files_editing {
            TextInputTarget::ConfigPageCopyFiles
        } else if page.worktree_editing {
            TextInputTarget::ConfigPageWorktree
        } else {
            TextInputTarget::Consumed
        };
    }
    if modal.context_menu.is_some() || modal.save_confirm.is_some() {
        return TextInputTarget::Consumed;
    }
    // Text-input popups
    if modal.file_tree_rename.is_some() {
        return TextInputTarget::FileTreeRename;
    }
    if modal.git_switcher.is_some() {
        return TextInputTarget::GitSwitcher;
    }
    if modal.file_finder.is_some() {
        return TextInputTarget::FileFinder;
    }
    if modal.save_as_input.is_some() {
        return TextInputTarget::SaveAsInput;
    }
    if modal.context_comment_composer.is_some() {
        return TextInputTarget::ContextCommentComposer;
    }
    // Inline search bar
    if let Some(id) = ctx.search_focus() {
        return TextInputTarget::SearchBar(id);
    }
    // Focus area
    match ctx.current_focus_area() {
        FocusArea::FileTree => TextInputTarget::Consumed,
        FocusArea::Stage | FocusArea::Dock => {
            // Check if focused pane is a browser with URL bar focused
            if let Some(id) = ctx.focused_pane() {
                if let Some(PaneKind::Browser(bp)) = ctx.pane(id) {
                    if bp.url_input_focused {
                        return TextInputTarget::BrowserUrlBar(id);
                    }
                    // When URL bar not focused, consume text (webview handles its own input)
                    return TextInputTarget::Consumed;
                }
            }
            ctx.focused_pane()
                .map(TextInputTarget::Pane)
                .unwrap_or(TextInputTarget::Consumed)
        }
    }
}

/// Compute visible editor rows and columns for a given pane.
/// Used by text routing and IME commit paths to keep cursor visible.
pub(crate) fn visible_editor_size(
    ctx: &(impl AppCorePort + PaneAccessPort),
    pane_id: crate::tide_core::PaneId,
) -> (usize, usize) {
    let cs = ctx.cell_size();
    let content_top = crate::theme::TAB_BAR_HEIGHT;
    let tree_rect = ctx
        .visual_pane_rects()
        .iter()
        .find(|(pid, _)| *pid == pane_id)
        .map(|(_, r)| *r);
    if let Some(r) = tree_rect {
        let content_rect = crate::pane::pane_content_rect(r, content_top);
        if let Some(PaneKind::Editor(pane)) = ctx.pane(pane_id) {
            pane.viewport_size_for_content_rect(content_rect, cs)
        } else {
            let rows = (content_rect.height / cs.height).floor() as usize;
            let cols = (content_rect.width / cs.width).floor() as usize;
            (rows.max(1), cols.max(1))
        }
    } else {
        (30, 80)
    }
}

// ── Thin bridge on App ──
// send_text_to_target stays as impl App (ImeStatePort forwards to it).

use crate::tide_core::TerminalBackend;
use crate::App;
use crate::PaneLifecyclePort;

impl App {
    /// Route a text string to the current input target.
    /// Handles all side effects (chrome_generation, input_sent_at, scroll-to-bottom, etc.).
    pub(crate) fn send_text_to_target(&mut self, text: &str) {
        let target = text_input_target(self);
        match target {
            TextInputTarget::ConfigPageCopyFiles => {
                if let Some(ref mut page) = self.modal.config_page {
                    for ch in text.chars() {
                        page.copy_files_input.insert_char(ch);
                    }
                    page.dirty = true;
                    crate::AppCorePort::invalidate_chrome(self);
                }
            }
            TextInputTarget::ConfigPageWorktree => {
                if let Some(ref mut page) = self.modal.config_page {
                    for ch in text.chars() {
                        page.worktree_input.insert_char(ch);
                    }
                    page.dirty = true;
                    crate::AppCorePort::invalidate_chrome(self);
                }
            }
            TextInputTarget::FileTreeRename => {
                if let Some(ref mut rename) = self.modal.file_tree_rename {
                    for ch in text.chars() {
                        rename.input.insert_char(ch);
                    }
                    crate::AppCorePort::invalidate_chrome(self);
                }
            }
            TextInputTarget::GitSwitcher => {
                if let Some(ref mut gs) = self.modal.git_switcher {
                    for ch in text.chars() {
                        gs.insert_char(ch);
                    }
                    crate::AppCorePort::invalidate_chrome(self);
                }
            }
            TextInputTarget::FileFinder => {
                let mut needs_workspace_symbols = false;
                if let Some(ref mut finder) = self.modal.file_finder {
                    for ch in text.chars() {
                        finder.insert_char(ch);
                    }
                    needs_workspace_symbols = finder.mode
                        == crate::state::FileFinderMode::WorkspaceSymbols
                        && !finder.workspace_symbols_loaded;
                    crate::AppCorePort::invalidate_chrome(self);
                }
                if needs_workspace_symbols {
                    self.ensure_file_finder_workspace_symbols_loaded();
                }
            }
            TextInputTarget::SaveAsInput => {
                if let Some(ref mut input) = self.modal.save_as_input {
                    for ch in text.chars() {
                        input.insert_char(ch);
                    }
                }
            }
            TextInputTarget::ContextCommentComposer => {
                if let Some(ref mut composer) = self.modal.context_comment_composer {
                    for ch in text.chars() {
                        composer.insert_char(ch);
                    }
                    crate::AppCorePort::invalidate_chrome(self);
                }
            }
            TextInputTarget::SearchBar(pane_id) => {
                for ch in text.chars() {
                    crate::adapter::inward::search_adapter::search_bar_insert(self, pane_id, ch);
                }
            }
            TextInputTarget::BrowserUrlBar(pane_id) => {
                if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&pane_id) {
                    bp.url_delete_selection();
                    for ch in text.chars() {
                        let byte_off = bp.cursor_byte_offset();
                        bp.url_input.insert(byte_off, ch);
                        bp.url_input_cursor += 1;
                    }
                }
                crate::AppCorePort::invalidate_chrome(self);
            }
            TextInputTarget::Pane(id) => {
                // Block text input in preview mode
                if let Some(PaneKind::Editor(pane)) = self.panes.get(&id) {
                    if pane.preview_mode {
                        crate::AppCorePort::request_redraw(self);
                        return;
                    }
                }
                // Compute visible size before mutable borrow of panes
                let editor_size = visible_editor_size(self, id);
                match self.panes.get_mut(&id) {
                    Some(PaneKind::Terminal(pane)) => {
                        if pane.context.child_dead {
                            self.respawn_terminal(id);
                        } else {
                            if pane.backend.display_offset() > 0 {
                                pane.backend.request_scroll_to_bottom();
                            }
                            pane.backend.write(text.as_bytes());
                            self.input.input_just_sent = true;
                            self.input.input_sent_at = Some(self.ports.clock.now());
                        }
                    }
                    Some(PaneKind::Editor(pane)) => {
                        let was_modified = pane.editor.is_modified();
                        // Delete selection on editing input (mirrors keybinding path)
                        if text.chars().any(|ch| {
                            !ch.is_control()
                                || ch == '\r'
                                || ch == '\n'
                                || ch == '\u{7f}'
                                || ch == '\u{8}'
                        }) {
                            pane.delete_selection();
                            pane.selection = None;
                        }
                        for ch in text.chars() {
                            // Map control characters to editor actions
                            let action = match ch {
                                '\u{7f}' | '\u{8}' => {
                                    crate::tide_editor::EditorActionKind::Backspace
                                }
                                '\r' | '\n' => crate::tide_editor::EditorActionKind::Enter,
                                ch if ch.is_control() => continue,
                                ch => crate::tide_editor::EditorActionKind::InsertChar(ch),
                            };
                            pane.editor.handle_action(action);
                        }
                        // Ensure cursor stays visible after editing (matches keybinding path)
                        let (visible_rows, visible_cols) = editor_size;
                        pane.editor.ensure_cursor_visible(visible_rows);
                        pane.editor.ensure_cursor_visible_h(visible_cols);
                        // Update completion filter or trigger new completion
                        let has_printable = text.chars().any(|ch| !ch.is_control());
                        let mut should_trigger = false;
                        if has_printable {
                            if pane.completion.is_some() {
                                // Client-side filter: append to prefix and re-filter
                                if let Some(ref mut cs) = pane.completion {
                                    for ch in text.chars() {
                                        if !ch.is_control() {
                                            cs.prefix.push(ch);
                                        }
                                    }
                                    cs.apply_filter();
                                    if cs.is_empty() {
                                        pane.completion = None;
                                        // BR-9a: filter dismissed → re-trigger for this character
                                        // (e.g. "." after a word should start new completion)
                                        should_trigger = true;
                                    }
                                }
                            } else {
                                should_trigger = true;
                            }
                        } else {
                            // Non-printable (Enter, Backspace) dismisses completion
                            pane.completion = None;
                        }
                        // Redraw tab label when modified indicator changes
                        if pane.editor.is_modified() != was_modified {
                            crate::AppCorePort::sync_file_tree_modified_editor_cache(self);
                            crate::AppCorePort::invalidate_chrome(self);
                        }
                        // Notify LSP of document change BEFORE requesting completion
                        // (server needs updated buffer to provide correct results)
                        self.notify_lsp_did_change(id);
                        // Check if this character is a trigger character (after borrow is released)
                        if should_trigger {
                            self.try_trigger_completion(id, text);
                        }
                        // Editor has no PTY output loop — must invalidate cache explicitly
                        crate::AppCorePort::invalidate_pane(self, id);
                    }
                    Some(PaneKind::Diff(_))
                    | Some(PaneKind::Browser(_))
                    | Some(PaneKind::Launcher(_))
                    | None => {}
                }
            }
            TextInputTarget::Consumed => {}
        }
        crate::AppCorePort::request_redraw(self);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::*;
    use crate::tide_core::Rect;
    use std::path::PathBuf;

    fn test_app() -> App {
        let mut app = App::new();
        app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
        app.window.window_size = (960, 640);
        app
    }

    #[test]
    fn default_no_focus_consumed() {
        let app = test_app();
        assert_eq!(text_input_target(&app), TextInputTarget::Consumed);
    }

    #[test]
    fn focused_editor_routes_to_pane() {
        let mut app = test_app();
        let id: crate::tide_core::PaneId = 1;
        app.panes.insert(
            id,
            PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(id)),
        );
        app.focus.focused = Some(id);
        assert_eq!(text_input_target(&app), TextInputTarget::Pane(id));
    }

    #[test]
    fn file_finder_overrides_pane() {
        let mut app = test_app();
        let id: crate::tide_core::PaneId = 1;
        app.panes.insert(
            id,
            PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(id)),
        );
        app.focus.focused = Some(id);
        app.modal.file_finder = Some(FileFinderState::new(PathBuf::from("/tmp"), vec![]));
        assert_eq!(text_input_target(&app), TextInputTarget::FileFinder);
    }

    #[test]
    fn git_switcher_overrides_pane() {
        let mut app = test_app();
        let id: crate::tide_core::PaneId = 1;
        app.panes.insert(
            id,
            PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(id)),
        );
        app.focus.focused = Some(id);
        app.modal.git_switcher = Some(GitSwitcherState::new(
            id,
            vec![],
            Rect::new(0.0, 0.0, 100.0, 30.0),
        ));
        assert_eq!(text_input_target(&app), TextInputTarget::GitSwitcher);
    }

    #[test]
    fn config_page_consumed_by_default() {
        let mut app = test_app();
        app.modal.config_page = Some(ConfigPageState::new(vec![], String::new(), String::new()));
        assert_eq!(text_input_target(&app), TextInputTarget::Consumed);
    }

    #[test]
    fn config_page_copy_files_editing() {
        let mut app = test_app();
        let mut cp = ConfigPageState::new(vec![], String::new(), String::new());
        cp.copy_files_editing = true;
        app.modal.config_page = Some(cp);
        assert_eq!(
            text_input_target(&app),
            TextInputTarget::ConfigPageCopyFiles
        );
    }

    #[test]
    fn config_page_worktree_editing() {
        let mut app = test_app();
        let mut cp = ConfigPageState::new(vec![], String::new(), String::new());
        cp.worktree_editing = true;
        app.modal.config_page = Some(cp);
        assert_eq!(text_input_target(&app), TextInputTarget::ConfigPageWorktree);
    }

    #[test]
    fn config_page_overrides_file_finder() {
        let mut app = test_app();
        app.modal.file_finder = Some(FileFinderState::new(PathBuf::from("/tmp"), vec![]));
        app.modal.config_page = Some(ConfigPageState::new(vec![], String::new(), String::new()));
        // config_page has higher priority
        assert_eq!(text_input_target(&app), TextInputTarget::Consumed);
    }

    #[test]
    fn search_bar_routes_to_search() {
        let mut app = test_app();
        let id: crate::tide_core::PaneId = 1;
        app.panes.insert(
            id,
            PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(id)),
        );
        app.focus.focused = Some(id);
        app.focus.search_focus = Some(id);
        assert_eq!(text_input_target(&app), TextInputTarget::SearchBar(id));
    }

    #[test]
    fn file_tree_focus_consumed() {
        let mut app = test_app();
        let id: crate::tide_core::PaneId = 1;
        app.panes.insert(
            id,
            PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(id)),
        );
        app.focus.focused = Some(id);
        app.focus.focus_area = FocusArea::FileTree;
        assert_eq!(text_input_target(&app), TextInputTarget::Consumed);
    }

    #[test]
    fn save_as_input_routes() {
        let mut app = test_app();
        app.modal.save_as_input = Some(SaveAsInput::new(
            1,
            PathBuf::from("/tmp"),
            Rect::new(0.0, 0.0, 100.0, 30.0),
        ));
        assert_eq!(text_input_target(&app), TextInputTarget::SaveAsInput);
    }

    #[test]
    fn file_tree_rename_routes() {
        let mut app = test_app();
        app.modal.file_tree_rename = Some(FileTreeRenameState {
            entry_index: 0,
            original_path: PathBuf::from("/tmp/file.txt"),
            input: InputLine::with_text("file.txt".to_string()),
        });
        assert_eq!(text_input_target(&app), TextInputTarget::FileTreeRename);
    }

    #[test]
    fn context_menu_consumed() {
        let mut app = test_app();
        let id: crate::tide_core::PaneId = 1;
        app.panes.insert(
            id,
            PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(id)),
        );
        app.focus.focused = Some(id);
        app.modal.context_menu = Some(ContextMenuState {
            target: crate::ContextMenuTarget::FileTreeEntry {
                entry_index: 0,
                path: PathBuf::from("/tmp"),
                is_dir: false,
                is_app_bundle: false,
                shell_idle: true,
            },
            position: crate::tide_core::Vec2::new(0.0, 0.0),
            selected: 0,
        });
        assert_eq!(text_input_target(&app), TextInputTarget::Consumed);
    }

    #[test]
    fn priority_git_switcher_over_search_bar() {
        let mut app = test_app();
        let id: crate::tide_core::PaneId = 1;
        app.panes.insert(
            id,
            PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(id)),
        );
        app.focus.focused = Some(id);
        app.focus.search_focus = Some(id);
        app.modal.git_switcher = Some(GitSwitcherState::new(
            id,
            vec![],
            Rect::new(0.0, 0.0, 100.0, 30.0),
        ));
        // git_switcher has higher priority than search_focus
        assert_eq!(text_input_target(&app), TextInputTarget::GitSwitcher);
    }
}
