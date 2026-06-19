/// Launcher type selection choices.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LauncherChoice {
    Terminal,
    NewFile,
    OpenFile,
    Browser,
}

use std::path::{Path, PathBuf};

use crate::tide_core::{InputEvent, LayoutEngine, Size, SplitDirection, TerminalBackend, Vec2};
use crate::tide_editor::input::EditorAction;
use crate::tide_input::{Action, AreaSlot, GlobalAction};

use crate::pane::PaneKind;
use crate::pane::Selection;
use crate::state::FocusArea;
use crate::theme::*;
use crate::ActionPort;
use crate::App;
use crate::AppCorePort;
use crate::ClipboardSearchPort;
use crate::DockPort;
use crate::FileOpsPort;
use crate::FocusNavPort;
use crate::LayoutPort;
use crate::PaneLifecyclePort;
use crate::TextExtractPort;
use crate::WorkspaceNavPort;

fn char_index_for_display_cell_from(
    line_text: &str,
    start_char: usize,
    target_display_col: usize,
) -> usize {
    let mut display_col = 0usize;
    let mut char_idx = start_char;
    for ch in line_text.chars().skip(start_char) {
        let width = unicode_width::UnicodeWidthChar::width(ch).unwrap_or(1);
        if display_col + width > target_display_col {
            break;
        }
        display_col += width;
        char_idx += 1;
    }
    char_idx
}

fn editor_plain_click_col(
    pane: &crate::pane::editor::EditorPane,
    line: usize,
    rel_col: usize,
) -> usize {
    let start_char = pane.editor.h_scroll_offset();
    pane.editor
        .buffer
        .line(line)
        .map(|line_text| char_index_for_display_cell_from(line_text, start_char, rel_col))
        .unwrap_or(start_char + rel_col)
}

impl App {
    fn context_comment_terminal_id(
        &self,
        source_pane_id: crate::tide_core::PaneId,
    ) -> Option<crate::tide_core::PaneId> {
        if !self.is_pane_in_dock(source_pane_id) {
            return None;
        }

        self.assoc
            .associated_terminal
            .get(&source_pane_id)
            .copied()
            .or_else(|| self.terminal_owning(source_pane_id))
    }

    pub(crate) fn context_artifact_source_label(
        &self,
        source_pane_id: crate::tide_core::PaneId,
    ) -> String {
        match self.panes.get(&source_pane_id) {
            Some(PaneKind::Terminal(tp)) => tp
                .context
                .cwd
                .as_ref()
                .map(|cwd| cwd.display().to_string())
                .unwrap_or_else(|| "Terminal".to_string()),
            Some(PaneKind::Editor(ep)) => ep
                .editor
                .file_path()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| ep.title()),
            Some(PaneKind::Diff(dp)) => dp.review_source_label(),
            Some(PaneKind::Browser(bp)) => bp
                .page_selection
                .as_ref()
                .and_then(|selection| selection.page_url.clone())
                .or_else(|| {
                    bp.page_snapshot
                        .as_ref()
                        .and_then(|snapshot| snapshot.page_url.clone())
                })
                .or_else(|| Some(bp.url.clone()).filter(|url| !url.is_empty()))
                .unwrap_or_else(|| bp.title()),
            Some(PaneKind::Launcher(_)) | None => "Context Artifact".to_string(),
        }
    }

    pub(crate) fn cleanup_closed_pane_state(&mut self, pane_id: crate::tide_core::PaneId) {
        self.notify_lsp_did_close(pane_id);
        self.cache.invalidate_pane(pane_id);
        self.interaction.scroll_accumulator.remove(&pane_id);
        self.ime.pending_removes.push(pane_id);
        // Clear IME composition if the closing pane was the composition target.
        // Without this, last_target points to a deleted pane and preedit text is lost.
        if self.ime.last_target == Some(pane_id) {
            self.ime.clear_composition();
            self.ime.last_target = None;
        }
        self.ports.gpu.remove_pane_cache(pane_id);
        // Clean up terminal association
        self.assoc.associated_terminal.remove(&pane_id);
        // If no pane references a retained context, clean it up
        self.cleanup_retained_context(pane_id);
        // Remove any live ContextArtifacts owned by the closed pane or its terminal.
        self.context_artifacts.artifacts.retain(|_, artifact| {
            artifact.source_pane_id != pane_id && artifact.associated_terminal_id != pane_id
        });
    }

    fn capture_context_comment_snapshot(
        &self,
        source_pane_id: crate::tide_core::PaneId,
    ) -> Option<crate::ContextCommentComposerState> {
        let pane = self.panes.get(&source_pane_id)?;
        let associated_terminal_id = self.context_comment_terminal_id(source_pane_id)?;
        let (pane_kind, selection, content) = match pane {
            PaneKind::Terminal(tp) => {
                let selection = tp.selection.clone();
                let content = selection
                    .as_ref()
                    .map(|selection| tp.selected_text(selection))
                    .unwrap_or_default();
                ("terminal".to_string(), selection, content)
            }
            PaneKind::Editor(ep) => {
                let selection = ep.selection.clone();
                let content = selection
                    .as_ref()
                    .map(|selection| ep.selected_text(selection))
                    .unwrap_or_default();
                ("editor".to_string(), selection, content)
            }
            PaneKind::Diff(dp) => {
                let selection = dp.selection.clone();
                let content = selection
                    .as_ref()
                    .map(|selection| dp.selected_text(selection))
                    .unwrap_or_default();
                ("diff".to_string(), selection, content)
            }
            PaneKind::Browser(bp) => {
                let content = if bp.url_input_focused && bp.url_selection.is_some() {
                    bp.url_selected_text().unwrap_or_default()
                } else if bp.page_selection.is_some() {
                    bp.page_selection_content().unwrap_or_default()
                } else {
                    String::new()
                };
                let pane_kind = if bp.render_mode {
                    "browser-render".to_string()
                } else {
                    "browser".to_string()
                };
                (pane_kind, None, content)
            }
            PaneKind::Launcher(_) => return None,
        };

        Some(crate::ContextCommentComposerState::new(
            source_pane_id,
            associated_terminal_id,
            pane_kind,
            selection,
            content,
        ))
    }

    pub(crate) fn can_open_context_comment_composer(
        &self,
        source_pane_id: crate::tide_core::PaneId,
    ) -> bool {
        if !self.can_show_context_comment_badge(source_pane_id) {
            return false;
        }

        self.capture_context_comment_snapshot(source_pane_id)
            .is_some()
    }

    pub(crate) fn can_show_context_comment_badge(
        &self,
        source_pane_id: crate::tide_core::PaneId,
    ) -> bool {
        if matches!(
            self.panes.get(&source_pane_id),
            Some(PaneKind::Launcher(_)) | None
        ) {
            return false;
        }

        let Some(associated_terminal_id) = self.context_comment_terminal_id(source_pane_id) else {
            return false;
        };

        self.gateway
            .detected_agents
            .get(&associated_terminal_id)
            .is_some_and(|agent| agent.gateway_connected)
    }

    pub(crate) fn pane_agent_needs_input_attention(
        &self,
        pane_id: crate::tide_core::PaneId,
    ) -> bool {
        use crate::state::gateway_status::AgentStatus;

        let direct_status = self.pane_agent_attention_status(pane_id);
        if matches!(direct_status, Some(AgentStatus::NeedsInput)) {
            return true;
        }

        self.pane_agent_attention_status(pane_id)
            .is_some_and(|status| matches!(status, AgentStatus::NeedsInput))
    }

    pub(crate) fn pane_agent_attention_status(
        &self,
        pane_id: crate::tide_core::PaneId,
    ) -> Option<crate::state::gateway_status::AgentStatus> {
        match self.panes.get(&pane_id) {
            Some(PaneKind::Terminal(_)) => self
                .gateway
                .detected_agents
                .get(&pane_id)
                .filter(|agent| agent.wrapper_managed)
                .and_then(|agent| agent.status),
            _ => None,
        }
    }

    pub(crate) fn pane_has_unresolved_wrapped_agent_attention(
        &self,
        pane_id: crate::tide_core::PaneId,
    ) -> bool {
        use crate::state::gateway_status::AgentStatus;

        match self.pane_agent_attention_status(pane_id) {
            Some(AgentStatus::NeedsInput) => true,
            Some(AgentStatus::Idle) => self.notified_panes.contains(&pane_id),
            _ => false,
        }
    }

    fn insert_context_artifact(
        &mut self,
        source_pane_id: crate::tide_core::PaneId,
        associated_terminal_id: crate::tide_core::PaneId,
        pane_kind: String,
        selection: Option<Selection>,
        content: String,
        comment: String,
        pinned: bool,
    ) -> crate::ContextArtifact {
        let source_label = self.context_artifact_source_label(source_pane_id);
        let artifact = crate::ContextArtifact {
            artifact_id: self.context_artifacts.allocate_id(),
            source_pane_id,
            associated_terminal_id,
            pane_kind,
            source_label,
            selection,
            content,
            comment,
            pinned,
            deliveries: Vec::new(),
        };
        self.context_artifacts
            .artifacts
            .insert(artifact.artifact_id, artifact.clone());
        self.record_browser_review_from_artifact(&artifact);
        artifact
    }

    pub(crate) fn record_browser_review_from_artifact(
        &mut self,
        artifact: &crate::ContextArtifact,
    ) {
        if artifact.pane_kind != "browser" {
            return;
        }
        let Some(PaneKind::Browser(browser)) = self.panes.get_mut(&artifact.source_pane_id) else {
            return;
        };
        browser.record_review_artifact(
            artifact.artifact_id,
            artifact.comment.clone(),
            artifact.source_label.clone(),
            artifact.deliveries.len(),
        );
        self.cache.invalidate_pane(artifact.source_pane_id);
        self.cache.invalidate_chrome();
    }

    fn inject_context_artifact_into_paired_terminal(
        &mut self,
        artifact: &crate::ContextArtifact,
    ) -> bool {
        let Some(agent) = self
            .gateway
            .detected_agents
            .get(&artifact.associated_terminal_id)
        else {
            return false;
        };
        if !agent.gateway_connected {
            return false;
        }

        let terminal_input =
            crate::state::context_artifact::format_context_artifact_terminal_input(artifact);
        let input_sent_at = self.ports.clock.now();
        let Some(PaneKind::Terminal(pane)) = self.panes.get_mut(&artifact.associated_terminal_id)
        else {
            return false;
        };
        if pane.context.child_dead {
            return false;
        }

        if pane.backend.display_offset() > 0 {
            pane.backend.request_scroll_to_bottom();
        }

        if !cfg!(test) {
            let data = crate::state::context_artifact::wrap_terminal_input_for_paste(
                &terminal_input,
                pane.backend.is_bracketed_paste_mode(),
            );
            pane.backend.write(&data);
        }

        self.input.input_just_sent = true;
        self.input.input_sent_at = Some(input_sent_at);
        true
    }

    pub(crate) fn deliver_context_artifact(&mut self, artifact_id: u64) -> Option<bool> {
        let artifact = self.context_artifacts.artifacts.get(&artifact_id)?.clone();
        let terminal_input_injected = self.inject_context_artifact_into_paired_terminal(&artifact);
        let (associated_terminal_id, updated_artifact, payload) = {
            let artifact = self.context_artifacts.artifacts.get_mut(&artifact_id)?;
            artifact.record_delivery(terminal_input_injected);
            let mut payload = crate::state::context_artifact::context_artifact_json(artifact);
            if let Some(obj) = payload.as_object_mut() {
                obj.insert(
                    "terminal_input_injected".to_string(),
                    serde_json::json!(terminal_input_injected),
                );
            }
            (artifact.associated_terminal_id, artifact.clone(), payload)
        };
        self.record_browser_review_from_artifact(&updated_artifact);
        self.gateway.notify_for_owner(
            associated_terminal_id,
            "context-artifact-delivered",
            payload,
        );
        Some(terminal_input_injected)
    }

    pub(crate) fn open_context_comment_composer(
        &mut self,
        source_pane_id: crate::tide_core::PaneId,
    ) {
        if self
            .modal
            .context_comment_composer
            .as_ref()
            .is_some_and(|composer| composer.source_pane_id == source_pane_id)
        {
            self.modal.context_comment_composer = None;
            self.invalidate_chrome();
            self.request_redraw();
            return;
        }

        if !self.can_open_context_comment_composer(source_pane_id) {
            return;
        }

        let Some(composer) = self.capture_context_comment_snapshot(source_pane_id) else {
            return;
        };

        self.modal.close_all();
        self.modal.context_comment_composer = Some(composer);
        self.invalidate_chrome();
        self.request_redraw();
    }

    pub(crate) fn submit_context_comment_composer(&mut self) -> bool {
        let Some(composer) = self.modal.context_comment_composer.take() else {
            return false;
        };

        let artifact = self.insert_context_artifact(
            composer.source_pane_id,
            composer.associated_terminal_id,
            composer.pane_kind.clone(),
            composer.selection.clone(),
            composer.content.clone(),
            composer.comment.text.clone(),
            composer.pinned,
        );

        self.deliver_context_artifact(artifact.artifact_id);

        self.invalidate_chrome();
        self.request_redraw();
        true
    }

    /// Resolve the effective target pane for actions like Copy/Paste/Find.
    pub(crate) fn action_target_id(&self) -> Option<crate::tide_core::PaneId> {
        action_target_id(self.focus.focused)
    }

    pub(crate) fn editor_click_target(
        &self,
        pane_id: crate::tide_core::PaneId,
        position: Vec2,
    ) -> Option<(usize, usize)> {
        let pane = match self.panes.get(&pane_id) {
            Some(PaneKind::Editor(pane)) if !pane.preview_mode => pane,
            _ => return None,
        };
        let &(_, rect) = self
            .visual_pane_rects
            .iter()
            .find(|(pid, _)| *pid == pane_id)?;
        let cell_size = self.cell_size();
        let mut click_rect = pane.content_rect(rect, TAB_BAR_HEIGHT, cell_size);
        if let Some((editor_rect, preview_rect)) = pane.split_preview_rects(click_rect, cell_size) {
            if position.x >= preview_rect.x {
                return None;
            }
            click_rect = editor_rect;
        }

        let gutter_width = crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell_size.width;
        let content_x = click_rect.x + gutter_width;
        let rel_col = ((position.x - content_x) / cell_size.width).floor() as isize;
        let rel_row = ((position.y - click_rect.y) / cell_size.height).floor() as isize;
        if rel_row < 0 || rel_col < 0 {
            return None;
        }

        if pane.effective_soft_wrap() {
            let abs_visual_row = pane.soft_wrap_visual_scroll() + rel_row as usize;
            let (line, col) =
                pane.soft_wrap_display_position_for_visual_cell(abs_visual_row, rel_col as usize)?;
            return Some((line, col));
        }

        let line = pane.editor.scroll_offset() + rel_row as usize;
        let col = editor_plain_click_col(pane, line, rel_col as usize);
        Some((line, col))
    }

    /// Extract the identifier (word) under a buffer position, if any.
    pub(crate) fn editor_identifier_at(
        &self,
        pane_id: crate::tide_core::PaneId,
        line: usize,
        col: usize,
    ) -> Option<String> {
        let pane = match self.panes.get(&pane_id) {
            Some(PaneKind::Editor(pane)) => pane,
            _ => return None,
        };
        let line_text = pane.editor.buffer.line(line)?;
        let chars: Vec<char> = line_text.chars().collect();
        if chars.is_empty() {
            return None;
        }

        let mut idx = col.min(chars.len().saturating_sub(1));
        if !crate::tide_editor::buffer::is_word_char(chars[idx]) {
            if idx > 0 && crate::tide_editor::buffer::is_word_char(chars[idx - 1]) {
                idx -= 1;
            } else {
                return None;
            }
        }

        let mut start = idx;
        while start > 0 && crate::tide_editor::buffer::is_word_char(chars[start - 1]) {
            start -= 1;
        }
        let mut end = idx + 1;
        while end < chars.len() && crate::tide_editor::buffer::is_word_char(chars[end]) {
            end += 1;
        }
        let identifier: String = chars[start..end].iter().collect();
        if identifier.is_empty() {
            None
        } else {
            Some(identifier)
        }
    }

    /// Build the integrated-search query that takes the user to an identifier's
    /// definition: `@name` when the symbol is defined in the focused file,
    /// otherwise `#name` (workspace symbol search).
    pub(crate) fn editor_definition_query(
        &self,
        pane_id: crate::tide_core::PaneId,
        identifier: &str,
    ) -> String {
        let identifier_lower = identifier.to_lowercase();
        let is_local = matches!(self.panes.get(&pane_id), Some(PaneKind::Editor(pane))
            if crate::state::collect_symbol_matches(
                std::path::Path::new(""),
                &pane.editor.buffer.lines,
            )
            .iter()
            .any(|symbol| symbol.label.to_lowercase().contains(&identifier_lower)));
        let prefix = if is_local { '@' } else { '#' };
        format!("{prefix}{identifier}")
    }

    /// Workspace text search that lists every reference to an identifier.
    pub(crate) fn editor_references_query(identifier: &str) -> String {
        format!("/{identifier}")
    }

    /// Cmd/Ctrl+click navigation inside an editor — VS Code style: open an
    /// import/file-path link, otherwise jump to the symbol's definition. It
    /// never pops the search palette.
    pub(crate) fn editor_navigate_at(
        &mut self,
        pane_id: crate::tide_core::PaneId,
        line: usize,
        col: usize,
    ) {
        // 1. Import / file-path link under the pointer → open that file.
        if let Some(path) = self.editor_link_target_at(pane_id, line, col) {
            self.open_editor_pane_at_line(path, None);
            return;
        }

        let identifier = match self.editor_identifier_at(pane_id, line, col) {
            Some(id) => id,
            None => return,
        };

        // 2. Symbol → Go to Definition via the language server when one is
        //    serving the file (jumps when the async response arrives).
        let uri = match self.panes.get(&pane_id) {
            Some(PaneKind::Editor(p)) => p
                .editor
                .file_path()
                .map(crate::tide_lsp::manager::path_to_uri),
            _ => None,
        };
        if let Some(u) = uri {
            if self.ports.lsp.supports_navigation(&u) {
                let character = self.editor_lsp_character(pane_id, line, col);
                self.ports
                    .lsp
                    .request_definition(&u, line as u32, character as u32);
                return;
            }
        }

        // 3. No language server — jump to the definition directly (no palette):
        //    the current file first (fast and exact), then the workspace.
        let cur_path = match self.panes.get(&pane_id) {
            Some(PaneKind::Editor(p)) => p.editor.file_path().map(|x| x.to_path_buf()),
            _ => None,
        };
        if let Some(cur) = &cur_path {
            if let Some(line1) = self.find_local_definition(pane_id, &identifier) {
                self.open_editor_pane_at_line(cur.clone(), Some(line1));
                return;
            }
        }
        if let Some((path, line1)) = self.find_workspace_definition(&identifier) {
            self.open_editor_pane_at_line(path, Some(line1));
        }
    }

    /// Line (1-based) of a definition of `identifier` in the current buffer.
    fn find_local_definition(
        &self,
        pane_id: crate::tide_core::PaneId,
        identifier: &str,
    ) -> Option<usize> {
        let pane = match self.panes.get(&pane_id) {
            Some(PaneKind::Editor(p)) => p,
            _ => return None,
        };
        crate::state::collect_symbol_matches(Path::new(""), &pane.editor.buffer.lines)
            .iter()
            .find(|s| symbol_label_defines(&s.label, identifier))
            .map(|s| s.line)
    }

    /// UTF-16 character offset (LSP position) for a buffer (line, char col).
    fn editor_lsp_character(
        &self,
        pane_id: crate::tide_core::PaneId,
        line: usize,
        col: usize,
    ) -> usize {
        match self.panes.get(&pane_id) {
            Some(PaneKind::Editor(pane)) => pane
                .editor
                .buffer
                .line(line)
                .map(|text| text.chars().take(col).map(char::len_utf16).sum())
                .unwrap_or(0),
            _ => 0,
        }
    }

    /// If the click lands on an import string or file path, resolve it to an
    /// existing file (relative to the current file's directory, then the
    /// workspace root, trying common extensions and index files).
    fn editor_link_target_at(
        &self,
        pane_id: crate::tide_core::PaneId,
        line: usize,
        col: usize,
    ) -> Option<PathBuf> {
        let pane = match self.panes.get(&pane_id) {
            Some(PaneKind::Editor(p)) => p,
            _ => return None,
        };
        let line_text = pane.editor.buffer.line(line)?;
        let chars: Vec<char> = line_text.chars().collect();
        if chars.is_empty() {
            return None;
        }
        let col = col.min(chars.len() - 1);
        let candidate = enclosing_quoted(&chars, col).or_else(|| path_token(&chars, col))?;
        // Must look like a path, not a bare identifier.
        if !(candidate.contains('/') || candidate.starts_with('.')) {
            return None;
        }
        let cur = pane.editor.file_path()?;
        let file_dir = cur.parent()?.to_path_buf();
        let base = self.resolve_base_dir();
        resolve_link_path(&candidate, &file_dir, &base)
    }

    /// Find the first workspace symbol that defines `identifier`. Returns
    /// (absolute path, 1-based line) for `open_editor_pane_at_line`.
    fn find_workspace_definition(&self, identifier: &str) -> Option<(PathBuf, usize)> {
        let base = self.resolve_base_dir();
        let entries = Self::gather_finder_entries(&base, 8);
        let symbols = self.build_workspace_file_finder_symbols(&base, &entries);
        let exact = symbols
            .iter()
            .find(|s| symbol_label_defines(&s.label, identifier));
        let chosen = exact.or_else(|| {
            let lo = identifier.to_lowercase();
            symbols
                .iter()
                .find(|s| s.label.to_lowercase().contains(&lo))
        })?;
        Some((base.join(&chosen.path), chosen.line))
    }
}

/// True when `identifier` appears as a whole word in a symbol signature label.
fn symbol_label_defines(label: &str, identifier: &str) -> bool {
    label
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .any(|word| word == identifier)
}

/// The string literal enclosing `col`, if the click sits inside `"…"`, `'…'`
/// or a template literal — i.e. an import specifier.
fn enclosing_quoted(chars: &[char], col: usize) -> Option<String> {
    let quotes = ['"', '\'', '`'];
    if quotes.contains(&chars[col]) {
        return None;
    }
    let mut l = col;
    while l > 0 && !quotes.contains(&chars[l - 1]) {
        l -= 1;
    }
    if l == 0 || !quotes.contains(&chars[l - 1]) {
        return None;
    }
    let q = chars[l - 1];
    let mut r = col;
    while r < chars.len() && chars[r] != q {
        r += 1;
    }
    if r >= chars.len() {
        return None;
    }
    Some(chars[l..r].iter().collect())
}

/// A path-like token (no quotes) around `col`.
fn path_token(chars: &[char], col: usize) -> Option<String> {
    let is_path =
        |c: char| c.is_alphanumeric() || matches!(c, '/' | '\\' | '.' | '-' | '_' | '~' | '@');
    if !is_path(chars[col]) {
        return None;
    }
    let mut s = col;
    while s > 0 && is_path(chars[s - 1]) {
        s -= 1;
    }
    let mut e = col;
    while e < chars.len() && is_path(chars[e]) {
        e += 1;
    }
    Some(chars[s..e].iter().collect())
}

/// Resolve an import specifier / path to an existing file, trying the current
/// file's directory and the workspace root, with common extensions and index
/// files (TS/JS module resolution, plus Rust `mod.rs`).
fn resolve_link_path(candidate: &str, file_dir: &Path, base: &Path) -> Option<PathBuf> {
    let cand = candidate.split(':').next().unwrap_or(candidate).trim();
    if cand.is_empty() {
        return None;
    }
    const EXTS: [&str; 12] = [
        "", ".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".rs", ".json", ".md", ".css", ".html",
    ];
    const INDEX: [&str; 5] = ["index.ts", "index.tsx", "index.js", "index.jsx", "mod.rs"];
    for root in [file_dir, base] {
        let joined = root.join(cand);
        for ext in EXTS {
            let mut s = joined.clone().into_os_string();
            s.push(ext);
            let p = PathBuf::from(s);
            if p.is_file() {
                return Some(p);
            }
        }
        for idx in INDEX {
            let p = joined.join(idx);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

impl crate::application::ports::inward::ActionPort for App {
    fn cleanup_retained_context(&mut self, _closed_pane_id: crate::tide_core::PaneId) {
        // Check if the closed pane's associated terminal is in retained_contexts
        // and no other pane still references it
        let terminal_ids: Vec<crate::tide_core::PaneId> =
            self.assoc.retained_contexts.keys().copied().collect();
        for tid in terminal_ids {
            let still_referenced = self.assoc.associated_terminal.values().any(|&v| v == tid);
            if !still_referenced {
                self.assoc.retained_contexts.remove(&tid);
            }
        }
    }

    fn exit_app(&self) {
        self.save_full_session();
        self.ports.persistence.delete_running_marker();
        std::process::exit(0);
    }

    fn open_focused_browser_externally(&mut self) {
        let focused = match self.focus.focused {
            Some(id) => id,
            None => return,
        };
        let url = match self.panes.get(&focused) {
            Some(PaneKind::Browser(bp)) => bp.url_state_for_external_open(),
            _ => None,
        };
        if let Some(url) = url {
            if self.ports.process.open_url(&url).is_ok() {
                if let Some(PaneKind::Browser(browser)) = self.panes.get_mut(&focused) {
                    browser.record_external_handoff(Some("user_open_external"), Some(&url));
                }
            }
        }
    }

    fn open_context_comment_composer(&mut self, source_pane_id: crate::tide_core::PaneId) {
        App::open_context_comment_composer(self, source_pane_id);
    }

    fn submit_context_comment_composer(&mut self) -> bool {
        App::submit_context_comment_composer(self)
    }

    fn handle_action(&mut self, action: Action, event: Option<InputEvent>) {
        match action {
            Action::RouteToPane(id) => {
                // Update focus
                if let Some(InputEvent::MouseClick { position, .. }) = event {
                    self.focus_terminal(id);

                    // Browser Pane content clicks are stateful: empty/loading
                    // panes and active URL-bar editing keep the URL bar focused.
                    if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&id) {
                        if bp.handle_content_click() {
                            self.cache.invalidate_chrome();
                        }
                    }

                    // Ctrl+Click / Cmd+Click on terminal -> try to open URL or file at click position
                    let mods = self.window.modifiers;
                    if mods.ctrl || mods.meta {
                        // Try URL first — open in embedded browser panel
                        if let Some(url) = self.extract_url_at(id, position) {
                            self.open_browser_pane(Some(url));
                            return;
                        }
                        if let Some((path, line)) = self.extract_file_path_at(id, position) {
                            self.open_editor_pane_at_line(path, line);
                            return;
                        }
                        if let Some((line, col)) = self.editor_click_target(id, position) {
                            // Open the import/file link or jump to the symbol's
                            // definition — don't pop the search palette.
                            self.editor_navigate_at(id, line, col);
                            return;
                        }
                    }

                    // Click on editor pane -> move cursor (skip in preview mode)
                    if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&id) {
                        if pane.preview_mode {
                            return;
                        }
                    }
                    let cell_size = self.cell_size();
                    if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&id) {
                        {
                            if let Some(&(_, rect)) =
                                self.visual_pane_rects.iter().find(|(pid, _)| *pid == id)
                            {
                                let mut click_rect =
                                    pane.content_rect(rect, TAB_BAR_HEIGHT, cell_size);
                                if let Some((editor_rect, preview_rect)) =
                                    pane.split_preview_rects(click_rect, cell_size)
                                {
                                    if position.x >= preview_rect.x {
                                        return;
                                    }
                                    click_rect = editor_rect;
                                }

                                let gutter_width = crate::pane::editor::GUTTER_WIDTH_CELLS as f32
                                    * cell_size.width;
                                let content_x = click_rect.x + gutter_width;
                                let rel_col =
                                    ((position.x - content_x) / cell_size.width).floor() as isize;
                                let rel_row = ((position.y - click_rect.y) / cell_size.height)
                                    .floor() as isize;

                                if rel_row >= 0 && rel_col >= 0 {
                                    let visible_rows =
                                        (click_rect.height / cell_size.height).floor() as usize;
                                    if pane.effective_soft_wrap() {
                                        // Click-to-cursor must build the current WrapMap even before the first render.
                                        let wrap_cols =
                                            pane.wrap_cols_for_rect(click_rect, cell_size).max(1);
                                        pane.ensure_wrap_map(wrap_cols);
                                        let abs_visual_row =
                                            pane.soft_wrap_visual_scroll() + rel_row as usize;
                                        if let Some((line, col)) = pane
                                            .soft_wrap_display_position_for_visual_cell(
                                                abs_visual_row,
                                                rel_col as usize,
                                            )
                                        {
                                            pane.handle_action(
                                                EditorAction::SetCursor { line, col },
                                                visible_rows,
                                            );
                                        }
                                    } else {
                                        let line = pane.editor.scroll_offset() + rel_row as usize;
                                        let col =
                                            editor_plain_click_col(pane, line, rel_col as usize);
                                        pane.handle_action(
                                            EditorAction::SetCursor { line, col },
                                            visible_rows,
                                        );
                                    }
                                }
                            }
                        }
                    }
                }

                // Forward keyboard input to the pane
                let cs_for_keys = self.cell_size();
                if let Some(InputEvent::KeyPress { key, modifiers }) = event {
                    match self.panes.get_mut(&id) {
                        Some(PaneKind::Terminal(pane)) => {
                            if pane.context.child_dead {
                                // Dead terminal: any key respawns a new shell
                                self.respawn_terminal(id);
                            } else {
                                pane.selection = None; // Clear selection on key input
                                pane.handle_key(&key, &modifiers);
                                self.input.input_just_sent = true;
                                self.input.input_sent_at = Some(self.ports.clock.now());
                            }
                        }
                        Some(PaneKind::Editor(pane)) => {
                            if (modifiers.meta || modifiers.ctrl)
                                && modifiers.shift
                                && modifiers.alt
                            {
                                if let crate::tide_core::Key::Char('m')
                                | crate::tide_core::Key::Char('M') = &key
                                {
                                    pane.toggle_split_preview();
                                    self.cache.invalidate_chrome();
                                    self.cache.invalidate_pane(id);
                                    return;
                                }
                            }

                            // Cmd+Shift+M / Ctrl+Shift+M: toggle markdown preview
                            if (modifiers.meta || modifiers.ctrl) && modifiers.shift {
                                if let crate::tide_core::Key::Char('m')
                                | crate::tide_core::Key::Char('M') = &key
                                {
                                    if pane.is_markdown() {
                                        pane.toggle_preview();
                                        self.cache.invalidate_chrome();
                                        self.cache.invalidate_pane(id);
                                        return;
                                    }
                                }
                            }

                            // Preview mode: Escape exits, all other keys ignored.
                            // Scrolling handled by Cmd+D/U (ScrollHalfPage) and mouse/trackpad.
                            if pane.preview_mode {
                                if matches!(key, crate::tide_core::Key::Escape) {
                                    pane.toggle_preview();
                                    self.cache.invalidate_chrome();
                                    self.cache.invalidate_pane(id);
                                }
                                return;
                            }

                            if let Some(action) =
                                crate::tide_editor::key_to_editor_action(&key, &modifiers)
                            {
                                // Handle SelectAll: set selection, don't clear it
                                if matches!(action, crate::tide_editor::EditorActionKind::SelectAll)
                                {
                                    pane.select_all();
                                    return;
                                }
                                // Delete selection on editing actions (insert, backspace, delete, enter)
                                match &action {
                                    crate::tide_editor::EditorActionKind::InsertChar(_)
                                    | crate::tide_editor::EditorActionKind::Backspace
                                    | crate::tide_editor::EditorActionKind::Delete
                                    | crate::tide_editor::EditorActionKind::Enter => {
                                        pane.delete_selection();
                                    }
                                    _ => {}
                                }
                                // Clear selection on movement and editing keys
                                pane.selection = None;
                                let is_save =
                                    matches!(action, crate::tide_editor::EditorActionKind::Save);
                                // Intercept Save on untitled files -> open save-as input
                                if is_save && pane.editor.file_path().is_none() {
                                    let base_dir = self.resolve_base_dir();
                                    let anchor = self
                                        .visual_pane_rects
                                        .iter()
                                        .find(|(pid, _)| *pid == id)
                                        .map(|(_, r)| {
                                            crate::tide_core::Rect::new(
                                                r.x,
                                                r.y,
                                                r.width,
                                                crate::theme::TAB_BAR_HEIGHT,
                                            )
                                        })
                                        .unwrap_or_else(|| {
                                            crate::tide_core::Rect::new(0.0, 0.0, 0.0, 0.0)
                                        });
                                    self.modal.save_as_input =
                                        Some(crate::SaveAsInput::new(id, base_dir, anchor));
                                    return;
                                }
                                let was_modified = pane.editor.is_modified();
                                let content_rect = self
                                    .visual_pane_rects
                                    .iter()
                                    .find(|(pid, _)| *pid == id)
                                    .map(|(_, r)| {
                                        pane.content_rect(*r, TAB_BAR_HEIGHT, cs_for_keys)
                                    });
                                let (visible_rows, visible_cols) = content_rect
                                    .map(|rect| {
                                        pane.viewport_size_for_content_rect(rect, cs_for_keys)
                                    })
                                    .unwrap_or((30, 80));
                                pane.handle_action_with_size(action, visible_rows, visible_cols);
                                // Clear disk_changed on save (user's version wins)
                                if is_save {
                                    pane.disk_changed = false;
                                    pane.diff_mode = false;
                                    pane.disk_content = None;
                                    pane.file_deleted = false;
                                }
                                // Redraw tab label when modified indicator changes
                                if pane.editor.is_modified() != was_modified || is_save {
                                    self.sync_file_tree_modified_editor_cache();
                                    self.cache.invalidate_chrome();
                                }
                                // Refresh git status on save (async via git poller)
                                if is_save {
                                    self.trigger_git_poll();
                                    self.notify_lsp_did_save(id);
                                }
                                // Invalidate cached pane texture and request redraw
                                self.cache.invalidate_pane(id);
                            }
                        }
                        Some(PaneKind::Diff(dp)) => match key {
                            crate::tide_core::Key::Char('j') | crate::tide_core::Key::Down => {
                                dp.move_selection(1);
                                self.cache.invalidate_pane(id);
                            }
                            crate::tide_core::Key::Char('k') | crate::tide_core::Key::Up => {
                                dp.move_selection(-1);
                                self.cache.invalidate_pane(id);
                            }
                            crate::tide_core::Key::Enter | crate::tide_core::Key::Char(' ') => {
                                dp.toggle_selected();
                                self.cache.invalidate_pane(id);
                            }
                            _ => {}
                        },
                        Some(PaneKind::Browser(_)) => {} // Browser keyboard handled by webview / URL bar
                        Some(PaneKind::Launcher(_)) => {
                            // Launcher key handling: T/E/O/B to select pane type, Escape to close
                            let choice = match key {
                                crate::tide_core::Key::Char('t')
                                | crate::tide_core::Key::Char('T') => {
                                    Some(crate::action::LauncherChoice::Terminal)
                                }
                                crate::tide_core::Key::Char('e')
                                | crate::tide_core::Key::Char('E') => {
                                    Some(crate::action::LauncherChoice::NewFile)
                                }
                                crate::tide_core::Key::Char('o')
                                | crate::tide_core::Key::Char('O') => {
                                    Some(crate::action::LauncherChoice::OpenFile)
                                }
                                crate::tide_core::Key::Char('b')
                                | crate::tide_core::Key::Char('B') => {
                                    Some(crate::action::LauncherChoice::Browser)
                                }
                                crate::tide_core::Key::Escape => {
                                    self.close_specific_pane_with_split_animation(id);
                                    None
                                }
                                _ => None,
                            };
                            if let Some(c) = choice {
                                self.resolve_launcher(id, c);
                            }
                        }
                        None => {}
                    }
                }

                // Forward mouse scroll to pane
                if let Some(InputEvent::MouseScroll { delta, position }) = event {
                    let cs = self.cell_size();
                    let diff_content_rect = self
                        .visual_pane_rects
                        .iter()
                        .find(|(pid, _)| *pid == id)
                        .map(|(_, r)| crate::pane::pane_content_rect(*r, TAB_BAR_HEIGHT));
                    // 0-based terminal cell under the cursor — used only when the
                    // wheel is forwarded to a mouse-reporting program.
                    let (wheel_col, wheel_row) = self
                        .visual_pane_rects
                        .iter()
                        .find(|(pid, _)| *pid == id)
                        .map(|(_, r)| {
                            let inner = crate::pane::pane_content_rect(
                                *r,
                                crate::theme::terminal_content_top(cs.height),
                            );
                            let origin = crate::pane::terminal_grid_origin(inner);
                            let c = ((position.x - origin.x) / cs.width).floor().max(0.0) as u16;
                            let rrow =
                                ((position.y - origin.y) / cs.height).floor().max(0.0) as u16;
                            (c, rrow)
                        })
                        .unwrap_or((0, 0));
                    match self.panes.get_mut(&id) {
                        Some(PaneKind::Editor(pane)) if pane.preview_mode => {
                            let content_rect = self
                                .visual_pane_rects
                                .iter()
                                .find(|(pid, _)| *pid == id)
                                .map(|(_, r)| pane.content_rect(*r, TAB_BAR_HEIGHT, cs));
                            let (visible_rows, _) = content_rect
                                .map(|rect| pane.viewport_size_for_content_rect(rect, cs))
                                .unwrap_or((30, 80));
                            let acc = self.interaction.scroll_accumulator.entry(id).or_insert(0.0);
                            *acc += delta;
                            let lines = acc.trunc() as i32;
                            if lines != 0 {
                                *acc -= lines as f32;
                                let total = pane.preview_line_count();
                                let max_scroll = total.saturating_sub(visible_rows);
                                if lines > 0 {
                                    pane.preview_scroll = pane
                                        .preview_scroll
                                        .saturating_sub(lines.unsigned_abs() as usize);
                                } else {
                                    pane.preview_scroll = (pane.preview_scroll
                                        + lines.unsigned_abs() as usize)
                                        .min(max_scroll);
                                }
                                self.cache.invalidate_pane(id);
                            }
                        }
                        Some(PaneKind::Editor(pane)) => {
                            let content_rect = self
                                .visual_pane_rects
                                .iter()
                                .find(|(pid, _)| *pid == id)
                                .map(|(_, r)| pane.content_rect(*r, TAB_BAR_HEIGHT, cs));
                            let (visible_rows, visible_cols) = content_rect
                                .map(|rect| pane.viewport_size_for_content_rect(rect, cs))
                                .unwrap_or((30, 80));
                            // Accumulate sub-pixel scroll deltas (like terminal)
                            let acc = self.interaction.scroll_accumulator.entry(id).or_insert(0.0);
                            *acc += delta;
                            let lines = acc.trunc();
                            if lines.abs() >= 1.0 {
                                *acc -= lines;
                                if lines > 0.0 {
                                    pane.handle_action_with_size(
                                        EditorAction::ScrollUp(lines.abs()),
                                        visible_rows,
                                        visible_cols,
                                    );
                                } else {
                                    pane.handle_action_with_size(
                                        EditorAction::ScrollDown(lines.abs()),
                                        visible_rows,
                                        visible_cols,
                                    );
                                }
                                self.cache.invalidate_pane(id);
                            }
                        }
                        Some(PaneKind::Terminal(pane)) => {
                            // Accumulate sub-pixel scroll deltas to prevent jitter
                            let acc = self.interaction.scroll_accumulator.entry(id).or_insert(0.0);
                            *acc += delta;
                            let lines = acc.trunc() as i32;
                            if lines != 0 {
                                *acc -= lines as f32;
                                // Positive delta scrolls up (toward history).
                                let up = lines > 0;
                                let notches = lines.unsigned_abs() as usize;
                                // Wheel Forwarding: when the foreground program owns
                                // the wheel (mouse reporting or Alternate Screen +
                                // Alternate Scroll), send it to the PTY instead of
                                // scrolling local scrollback.
                                if let Some(bytes) = pane
                                    .backend
                                    .wheel_to_bytes(up, notches, wheel_col, wheel_row)
                                {
                                    pane.backend.write(&bytes);
                                } else {
                                    pane.scroll_display(lines);
                                    pane.backend.process();
                                    self.cache.invalidate_pane(id);
                                }
                            }
                        }
                        Some(PaneKind::Diff(dp)) => {
                            let visible_rows = diff_content_rect
                                .map(|rect| (rect.height / cs.height).floor() as usize)
                                .unwrap_or(30)
                                .max(1);
                            let total = dp.total_lines();
                            let max_scroll = total.saturating_sub(visible_rows) as f32;
                            dp.scroll_target = (dp.scroll_target - delta).clamp(0.0, max_scroll);
                            dp.scroll = dp.scroll_target;
                            dp.generation = dp.generation.wrapping_add(1);
                            self.cache.invalidate_pane(id);
                        }
                        Some(PaneKind::Browser(_)) => {} // Scroll handled by native WKWebView
                        Some(PaneKind::Launcher(_)) => {}
                        None => {}
                    }
                }
            }
            Action::GlobalAction(global) => {
                self.handle_global_action(global);
            }
            Action::DragBorder(pos) => {
                // Use pane_area_rect for correct coordinate mapping.
                // pane_area_rect accounts for top_inset, workspace sidebar,
                // file tree, dock, and all PANE_GAP spacing.
                //
                // Only call begin_drag here — border selection is deferred to
                // the first cursor_moved (drag_border) so drag direction can
                // disambiguate T-junction overlaps.
                if let Some(pa) = self.pane_area_rect {
                    let drag_pos = Vec2::new(pos.x - pa.x, pos.y - pa.y);
                    let terminal_area = Size::new(pa.width, pa.height);
                    self.layout.begin_drag(drag_pos, terminal_area);
                }
            }
            Action::None => {}
        }
    }

    fn split_pane(&mut self, direction: SplitDirection, cwd: Option<std::path::PathBuf>) {
        if let Some(focused) = self.focus.focused {
            self.split_pane_from(focused, direction, cwd);
        }
    }

    /// Split from a specific source pane, creating a new terminal pane with
    /// proper focus, chrome updates.
    /// Returns the new pane ID on success.
    fn split_pane_from(
        &mut self,
        source: crate::tide_core::PaneId,
        direction: SplitDirection,
        cwd: Option<std::path::PathBuf>,
    ) -> Option<crate::tide_core::PaneId> {
        self.split_pane_from_with_activation(source, direction, cwd, true)
    }

    fn split_pane_from_with_activation(
        &mut self,
        source: crate::tide_core::PaneId,
        direction: SplitDirection,
        cwd: Option<std::path::PathBuf>,
        activate: bool,
    ) -> Option<crate::tide_core::PaneId> {
        // Unzoom before splitting so both panes are visible
        if activate && self.focus.zoomed_pane.is_some() {
            self.focus.zoomed_pane = None;
            self.cache.pane_generations.clear();
        }
        let new_id = self.layout.split(source, direction);
        self.create_terminal_pane(new_id, cwd);
        if self.panes.contains_key(&new_id) {
            self.begin_split_transition_animation(
                crate::state::SplitTransitionScope::Stage,
                new_id,
            );
        }
        if activate {
            self.focus_terminal(new_id);
        }
        self.cache.invalidate_chrome();
        self.compute_layout();
        Some(new_id)
    }

    fn handle_global_action(&mut self, action: GlobalAction) {
        match action {
            GlobalAction::SplitVertical => {
                self.split_with_launcher(SplitDirection::Vertical);
            }
            GlobalAction::SplitHorizontal => {
                self.split_with_launcher(SplitDirection::Horizontal);
            }
            GlobalAction::DockSplitHorizontal => {
                self.dock_split_new_tab_group(SplitDirection::Horizontal);
            }
            GlobalAction::DockSplitVertical => {
                self.dock_split_new_tab_group(SplitDirection::Vertical);
            }
            GlobalAction::ClosePane => {
                if let Some(focused) = self.focus.focused {
                    self.close_specific_pane_with_split_animation(focused);
                }
            }
            GlobalAction::FocusArea(slot) => {
                if matches!(slot, AreaSlot::Slot1) {
                    // Legacy slot action kept for saved settings compatibility.
                    self.set_workspace_sidebar_visible_with_animation(!self.ws.show_sidebar);
                    self.cache.invalidate_chrome();
                    self.compute_layout();
                } else if matches!(slot, AreaSlot::Slot2) {
                    // Legacy FocusArea slot mirrors the titlebar FileTree button: visibility, not focus.
                    self.toggle_file_tree_visibility();
                } else {
                    let target = self.resolve_slot(slot);
                    self.handle_focus_area(target);
                }
            }
            GlobalAction::WorkspacePrev => {
                let len = self.ws.workspaces.len();
                if len > 0 {
                    let prev = if self.ws.active == 0 {
                        len - 1
                    } else {
                        self.ws.active - 1
                    };
                    self.switch_workspace(prev);
                }
            }
            GlobalAction::WorkspaceNext => {
                let len = self.ws.workspaces.len();
                if len > 0 {
                    let next = if self.ws.active + 1 >= len {
                        0
                    } else {
                        self.ws.active + 1
                    };
                    self.switch_workspace(next);
                }
            }
            GlobalAction::NewWorkspace => {
                self.new_workspace();
            }
            GlobalAction::CloseWorkspace => {
                self.close_workspace();
            }
            GlobalAction::ToggleFileTree => {
                self.toggle_file_tree_visibility();
            }
            GlobalAction::ToggleDock => {
                self.toggle_dock();
            }
            GlobalAction::ToggleWorkspaceSidebar => {
                self.set_workspace_sidebar_visible_with_animation(!self.ws.show_sidebar);
                self.cache.invalidate_chrome();
                self.compute_layout();
            }
            GlobalAction::Navigate(direction) => {
                self.handle_navigate(direction);
            }
            GlobalAction::DockNavigate(direction) => {
                self.dock_navigate(direction);
            }
            GlobalAction::TabPrev => {
                self.cycle_tab(-1);
            }
            GlobalAction::TabNext => {
                self.cycle_tab(1);
            }
            GlobalAction::DockTabPrev => {
                // Cycle dock tab without changing FocusArea (UC-4 BR-2: opens dock if closed)
                self.set_dock_visible_with_animation(true);
                let saved_area = self.focus.focus_area;
                self.focus.focus_area = FocusArea::Dock;
                self.cycle_tab(-1);
                self.focus.focus_area = saved_area;
            }
            GlobalAction::DockTabNext => {
                // Cycle dock tab without changing FocusArea (UC-4 BR-2: opens dock if closed)
                self.set_dock_visible_with_animation(true);
                let saved_area = self.focus.focus_area;
                self.focus.focus_area = FocusArea::Dock;
                self.cycle_tab(1);
                self.focus.focus_area = saved_area;
            }
            GlobalAction::NewTab => {
                // Open a new terminal pane next to the focused pane
                self.new_terminal_tab();
            }
            GlobalAction::DockNewTab => {
                // Create a new tab in Dock and move focus there (Launcher needs interaction)
                self.set_dock_visible_with_animation(true);
                self.focus.focus_area = FocusArea::Dock;
                self.new_terminal_tab();
            }
            GlobalAction::FileFinder => {
                self.open_file_finder();
            }
            GlobalAction::ToggleFullscreen => {
                self.window.pending_fullscreen_toggle = true;
            }
            GlobalAction::Paste => {
                self.handle_paste();
            }
            GlobalAction::Copy => {
                self.handle_copy();
            }
            GlobalAction::Find => {
                self.handle_find();
            }
            GlobalAction::FontSizeUp => {
                self.apply_font_size(self.window.current_font_size + 1.0);
            }
            GlobalAction::FontSizeDown => {
                self.apply_font_size(self.window.current_font_size - 1.0);
            }
            GlobalAction::FontSizeReset => {
                self.apply_font_size(14.0);
            }
            GlobalAction::NewWindow => {
                let size = self.window.logical_size();
                self.pending_platform_commands.push(
                    crate::tide_platform::WindowCommand::CreateWindow {
                        width: size.width as f64,
                        height: size.height as f64,
                    },
                );
            }
            GlobalAction::NewFile => {
                self.new_editor_pane();
            }
            GlobalAction::OpenBrowser => {
                self.open_browser_pane(None);
            }
            GlobalAction::BrowserReload => {
                if let Some(focused) = self.focus.focused {
                    if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&focused) {
                        bp.reload();
                    }
                }
            }
            GlobalAction::OpenConfig => {
                self.toggle_config_page();
            }
            GlobalAction::ToggleTheme => {
                self.window.dark_mode = !self.window.dark_mode;
                self.settings.appearance.theme =
                    crate::state::settings::ThemePreference::from_dark_mode(self.window.dark_mode);
                self.ports.persistence.save_settings(&self.settings);
                self.pending_platform_commands
                    .push(crate::tide_platform::WindowCommand::BroadcastSettingsChanged);
                let border_color = self.palette().border_color;
                self.ports.gpu.set_clear_color(border_color);
                let dark = self.window.dark_mode;
                for pane in self.panes.values_mut() {
                    match pane {
                        crate::pane::PaneKind::Terminal(tp) => {
                            tp.backend.set_dark_mode(dark);
                        }
                        crate::pane::PaneKind::Editor(ep) => {
                            ep.editor.set_dark_mode(dark);
                        }
                        crate::pane::PaneKind::Diff(_) => {}
                        crate::pane::PaneKind::Browser(bp) => {
                            // BR-32: Update theme CSS vars in render panes
                            if bp.render_mode {
                                bp.sync_theme_vars(dark);
                            }
                        }
                        crate::pane::PaneKind::Launcher(_) => {}
                    }
                }
                self.cache.invalidate_chrome();
                self.cache.layout_generation = self.cache.layout_generation.wrapping_add(1);
                self.cache.pane_generations.clear();
            }
            GlobalAction::ScrollHalfPageUp => {
                self.scroll_half_page(crate::tide_input::Direction::Up);
            }
            GlobalAction::ScrollHalfPageDown => {
                self.scroll_half_page(crate::tide_input::Direction::Down);
            }
            GlobalAction::ToggleStacked => {
                self.handle_toggle_stacked();
            }
            GlobalAction::DockToggleStacked => {
                // Toggle dock stacked mode (auto-opens dock)
                self.set_dock_visible_with_animation(true);
                let saved_area = self.focus.focus_area;
                self.focus.focus_area = FocusArea::Dock;
                self.handle_toggle_stacked();
                self.focus.focus_area = saved_area;
            }
            GlobalAction::ToggleDockPin => {
                self.toggle_dock_pin();
            }
        }
    }

    // toggle_config_page, open_config_page, close_config_page, navigate_panes → workspace.rs
}

/// Resolve the effective target pane for actions like Copy/Paste/Find.
fn action_target_id(focused: Option<crate::tide_core::PaneId>) -> Option<crate::tide_core::PaneId> {
    focused
}

// ── Pane lifecycle helpers (formerly in pane_lifecycle/mod.rs) ──

impl App {
    /// Add a pane to the right of the focused pane.
    /// Splits the focused pane horizontally.
    pub(crate) fn add_pane_to_right(
        &mut self,
        focused: crate::tide_core::PaneId,
        new_id: crate::tide_core::PaneId,
    ) {
        self.layout.insert_pane(
            focused,
            new_id,
            crate::tide_core::SplitDirection::Vertical,
            false,
        );
    }

    /// Route a non-terminal pane next to the correct pane.
    /// If focused is a terminal → add to right (split horizontally).
    /// If focused is non-terminal → add to right of the same pane.
    pub(crate) fn add_to_non_terminal_group(
        &mut self,
        focused: crate::tide_core::PaneId,
        new_id: crate::tide_core::PaneId,
    ) {
        if matches!(
            self.panes.get(&focused),
            Some(crate::pane::PaneKind::Terminal(_))
        ) {
            self.add_pane_to_right(focused, new_id);
        } else {
            self.layout.insert_pane(
                focused,
                new_id,
                crate::tide_core::SplitDirection::Vertical,
                false,
            );
        }
    }
}

#[cfg(test)]
mod cmd_click_nav_tests {
    use super::{enclosing_quoted, path_token, resolve_link_path, symbol_label_defines};

    fn chars(s: &str) -> Vec<char> {
        s.chars().collect()
    }

    #[test]
    fn enclosing_quoted_extracts_import_specifier() {
        let line = chars("} from \"../app/agent-chat-shell-state.ts\";");
        // click somewhere inside the quoted path
        let col = "} from \"../app/agent".chars().count();
        assert_eq!(
            enclosing_quoted(&line, col).as_deref(),
            Some("../app/agent-chat-shell-state.ts")
        );
    }

    #[test]
    fn enclosing_quoted_none_outside_quotes() {
        let line = chars("const x = foo();");
        assert_eq!(enclosing_quoted(&line, 2), None);
    }

    #[test]
    fn path_token_expands_path_like_run() {
        let line = chars("see ./src/main.rs here");
        let col = "see ./sr".chars().count();
        assert_eq!(path_token(&line, col).as_deref(), Some("./src/main.rs"));
    }

    #[test]
    fn symbol_label_defines_matches_whole_word() {
        assert!(symbol_label_defines("export function fooBar(", "fooBar"));
        assert!(symbol_label_defines(
            "class BackendAdapter implements",
            "BackendAdapter"
        ));
        assert!(!symbol_label_defines("fooBarBaz()", "fooBar"));
    }

    #[test]
    fn resolve_link_path_finds_file_with_added_extension() {
        let dir = std::env::temp_dir().join(format!("tide_link_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/b.ts"), "export const b = 1;\n").unwrap();
        let file_dir = dir.join("src");
        // "./b" resolves to src/b.ts via the appended extension.
        let resolved = resolve_link_path("./b", &file_dir, &dir).unwrap();
        assert!(resolved.ends_with("b.ts"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
