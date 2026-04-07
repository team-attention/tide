/// Launcher type selection choices.
pub(crate) enum LauncherChoice {
    Terminal,
    NewFile,
    OpenFile,
    Browser,
}

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

impl App {
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
        let (associated_terminal_id, pane_kind, selection, content) = match pane {
            PaneKind::Terminal(tp) => {
                let selection = tp.selection.clone();
                let content = selection
                    .as_ref()
                    .map(|selection| tp.selected_text(selection))
                    .unwrap_or_default();
                (source_pane_id, "terminal".to_string(), selection, content)
            }
            PaneKind::Editor(ep) => {
                let selection = ep.selection.clone();
                let content = selection
                    .as_ref()
                    .map(|selection| ep.selected_text(selection))
                    .unwrap_or_default();
                (
                    self.assoc
                        .associated_terminal
                        .get(&source_pane_id)
                        .copied()?,
                    "editor".to_string(),
                    selection,
                    content,
                )
            }
            PaneKind::Diff(dp) => {
                let selection = dp.selection.clone();
                let content = selection
                    .as_ref()
                    .map(|selection| dp.selected_text(selection))
                    .unwrap_or_default();
                (
                    self.assoc
                        .associated_terminal
                        .get(&source_pane_id)
                        .copied()?,
                    "diff".to_string(),
                    selection,
                    content,
                )
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
                (
                    self.assoc
                        .associated_terminal
                        .get(&source_pane_id)
                        .copied()?,
                    pane_kind,
                    None,
                    content,
                )
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
        if !self.is_pane_in_dock(source_pane_id) {
            return false;
        }

        let associated_terminal_id = match self.panes.get(&source_pane_id) {
            Some(PaneKind::Terminal(_)) => Some(source_pane_id),
            Some(PaneKind::Editor(_)) | Some(PaneKind::Diff(_)) | Some(PaneKind::Browser(_)) => {
                self.assoc.associated_terminal.get(&source_pane_id).copied()
            }
            Some(PaneKind::Launcher(_)) | None => None,
        };
        let Some(associated_terminal_id) = associated_terminal_id else {
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

        let direct_status = self
            .gateway
            .detected_agents
            .get(&pane_id)
            .and_then(|agent| agent.status);
        if matches!(direct_status, Some(AgentStatus::NeedsInput)) {
            return true;
        }

        let associated_terminal_id = match self.panes.get(&pane_id) {
            Some(PaneKind::Terminal(_)) => return false,
            Some(PaneKind::Editor(_)) | Some(PaneKind::Diff(_)) | Some(PaneKind::Browser(_)) => {
                self.assoc.associated_terminal.get(&pane_id).copied()
            }
            Some(PaneKind::Launcher(_)) | None => None,
        };

        associated_terminal_id
            .and_then(|terminal_id| self.gateway.detected_agents.get(&terminal_id))
            .and_then(|agent| agent.status)
            .is_some_and(|status| matches!(status, AgentStatus::NeedsInput))
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
        let artifact = crate::ContextArtifact {
            artifact_id: self.context_artifacts.allocate_id(),
            source_pane_id,
            associated_terminal_id,
            pane_kind,
            selection,
            content,
            comment,
            pinned,
        };
        self.context_artifacts
            .artifacts
            .insert(artifact.artifact_id, artifact.clone());
        artifact
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
            let data = crate::state::context_artifact::wrap_terminal_input_for_paste_and_submit(
                &terminal_input,
                pane.backend.is_bracketed_paste_mode(),
            );
            pane.backend.write(&data);
        }

        self.input.input_just_sent = true;
        self.input.input_sent_at = Some(input_sent_at);
        true
    }

    pub(crate) fn deliver_context_artifact(&mut self, artifact: &crate::ContextArtifact) -> bool {
        let terminal_input_injected = self.inject_context_artifact_into_paired_terminal(artifact);
        let mut payload = crate::state::context_artifact::context_artifact_json(artifact);
        if let Some(obj) = payload.as_object_mut() {
            obj.insert(
                "terminal_input_injected".to_string(),
                serde_json::json!(terminal_input_injected),
            );
        }
        self.gateway.notify_for_owner(
            artifact.associated_terminal_id,
            "context-artifact-delivered",
            payload,
        );
        terminal_input_injected
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

        self.deliver_context_artifact(&artifact);

        self.invalidate_chrome();
        self.request_redraw();
        true
    }

    /// Resolve the effective target pane for actions like Copy/Paste/Find.
    pub(crate) fn action_target_id(&self) -> Option<crate::tide_core::PaneId> {
        action_target_id(self.focus.focused)
    }
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
            let _ = self.ports.process.open_url(&url);
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
                                let content_top = TAB_BAR_HEIGHT;
                                let mut click_rect = crate::tide_core::Rect::new(
                                    rect.x + PANE_PADDING,
                                    rect.y + content_top,
                                    rect.width - 2.0 * PANE_PADDING,
                                    (rect.height - content_top - PANE_PADDING).max(1.0),
                                );
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
                                        if let Some(wrap_map) = pane.wrap_map() {
                                            let abs_visual_row =
                                                pane.soft_wrap_visual_scroll() + rel_row as usize;
                                            if let Some(info) = wrap_map.visual_row_to_line_info(
                                                abs_visual_row,
                                                &pane.editor.buffer.lines,
                                            ) {
                                                // col is relative to the sub-row, add the char offset
                                                // Clamp to char_end to avoid jumping to next visual row
                                                let mut col = (info.char_offset + rel_col as usize)
                                                    .min(info.char_end);
                                                // In live preview mode, reverse-map visual → buffer column
                                                if pane.live_preview {
                                                    if let Some(ref lpm) = pane.live_preview_map {
                                                        let cursor_line =
                                                            pane.editor.cursor_position().line;
                                                        let line_content = pane
                                                            .editor
                                                            .buffer
                                                            .line(info.logical_line)
                                                            .unwrap_or("")
                                                            .to_string();
                                                        col = lpm.visual_to_buffer_col(
                                                            info.logical_line,
                                                            col,
                                                            cursor_line,
                                                            &line_content,
                                                            &pane.editor.buffer.lines,
                                                        );
                                                    }
                                                }
                                                pane.handle_action(
                                                    EditorAction::SetCursor {
                                                        line: info.logical_line,
                                                        col,
                                                    },
                                                    visible_rows,
                                                );
                                            }
                                        }
                                    } else {
                                        let line = pane.editor.scroll_offset() + rel_row as usize;
                                        let visual_col =
                                            pane.editor.h_scroll_offset() + rel_col as usize;
                                        // In live preview mode, visual columns don't match buffer
                                        // columns on non-cursor lines because inline syntax is
                                        // hidden.  Reverse-map visual → buffer column.
                                        let col = if pane.live_preview {
                                            if let Some(ref lpm) = pane.live_preview_map {
                                                let cursor_line =
                                                    pane.editor.cursor_position().line;
                                                let line_content = pane
                                                    .editor
                                                    .buffer
                                                    .line(line)
                                                    .unwrap_or("")
                                                    .to_string();
                                                lpm.visual_to_buffer_col(
                                                    line,
                                                    visual_col,
                                                    cursor_line,
                                                    &line_content,
                                                    &pane.editor.buffer.lines,
                                                )
                                            } else {
                                                visual_col
                                            }
                                        } else {
                                            visual_col
                                        };
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
                                        crate::tide_core::Rect::new(
                                            r.x + PANE_PADDING,
                                            r.y + TAB_BAR_HEIGHT,
                                            r.width - 2.0 * PANE_PADDING,
                                            (r.height - TAB_BAR_HEIGHT - PANE_PADDING).max(1.0),
                                        )
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
                                    self.close_specific_pane(id);
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
                if let Some(InputEvent::MouseScroll { delta, .. }) = event {
                    let cs = self.cell_size();
                    let content_rect = self
                        .visual_pane_rects
                        .iter()
                        .find(|(pid, _)| *pid == id)
                        .map(|(_, r)| {
                            crate::tide_core::Rect::new(
                                r.x + PANE_PADDING,
                                r.y + TAB_BAR_HEIGHT,
                                r.width - 2.0 * PANE_PADDING,
                                (r.height - TAB_BAR_HEIGHT - PANE_PADDING).max(1.0),
                            )
                        });
                    match self.panes.get_mut(&id) {
                        Some(PaneKind::Editor(pane)) if pane.preview_mode => {
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
                                pane.scroll_display(lines);
                                pane.backend.process();
                                self.cache.invalidate_pane(id);
                            }
                        }
                        Some(PaneKind::Diff(dp)) => {
                            let visible_rows = content_rect
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
        // Unzoom before splitting so both panes are visible
        if self.focus.zoomed_pane.is_some() {
            self.focus.zoomed_pane = None;
            self.cache.pane_generations.clear();
        }
        let new_id = self.layout.split(source, direction);
        self.create_terminal_pane(new_id, cwd);
        self.focus.focused = Some(new_id);
        self.router.set_focused(new_id);
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
                    self.close_specific_pane(focused);
                }
            }
            GlobalAction::FocusArea(slot) => {
                if matches!(slot, AreaSlot::Slot1) {
                    // Cmd+1: toggle workspace sidebar
                    self.ws.show_sidebar = !self.ws.show_sidebar;
                    self.cache.invalidate_chrome();
                    self.compute_layout();
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
                self.handle_focus_area(FocusArea::FileTree);
            }
            GlobalAction::ToggleWorkspaceSidebar => {
                self.ws.show_sidebar = !self.ws.show_sidebar;
                self.cache.invalidate_chrome();
                self.compute_layout();
            }
            GlobalAction::Navigate(direction) => {
                self.handle_navigate(direction);
            }
            GlobalAction::DockNavigate(direction) => {
                // Navigate within Dock without changing FocusArea (auto-opens dock)
                self.dock.dock_open = true;
                let saved_area = self.focus.focus_area;
                self.focus.focus_area = FocusArea::Dock;
                self.handle_navigate(direction);
                self.focus.focus_area = saved_area;
            }
            GlobalAction::TabPrev => {
                self.cycle_tab(-1);
            }
            GlobalAction::TabNext => {
                self.cycle_tab(1);
            }
            GlobalAction::DockTabPrev => {
                // Cycle dock tab without changing FocusArea (UC-4 BR-2: opens dock if closed)
                self.dock.dock_open = true;
                let saved_area = self.focus.focus_area;
                self.focus.focus_area = FocusArea::Dock;
                self.cycle_tab(-1);
                self.focus.focus_area = saved_area;
            }
            GlobalAction::DockTabNext => {
                // Cycle dock tab without changing FocusArea (UC-4 BR-2: opens dock if closed)
                self.dock.dock_open = true;
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
                self.dock.dock_open = true;
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
                if let Ok(exe) = std::env::current_exe() {
                    let _ = std::process::Command::new(exe).spawn();
                }
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
                self.dock.dock_open = true;
                let saved_area = self.focus.focus_area;
                self.focus.focus_area = FocusArea::Dock;
                self.handle_toggle_stacked();
                self.focus.focus_area = saved_area;
            }
            GlobalAction::ToggleDockPin => {
                self.toggle_dock_pin();
            }
            GlobalAction::ToggleLivePreview => {
                if let Some(focused) = self.focus.focused {
                    if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&focused) {
                        if pane.is_markdown() {
                            pane.toggle_live_preview();
                            self.cache.invalidate_chrome();
                            self.cache.invalidate_pane(focused);
                        }
                    }
                }
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
            crate::tide_core::SplitDirection::Horizontal,
            false,
        );
    }

    /// Route a non-terminal pane next to the correct pane.
    /// If focused is a terminal → add to right (split horizontally).
    /// If focused is non-terminal → add as vertical split next to the same pane.
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
