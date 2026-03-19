// Platform event dispatch and app thread main loop.

use std::time::{Duration, Instant};

use tide_core::TerminalBackend;
use tide_platform::{PlatformEvent, PlatformWindow, WindowProxy};

use crate::pane::PaneKind;
use crate::update::session;
use crate::theme::*;
use crate::state::FocusArea;
use crate::App;

/// Events delivered to the app thread.
pub(crate) enum AppEvent {
    /// A platform event forwarded from the main thread.
    Platform(PlatformEvent),
    /// Wake signal from a background thread (PTY output, file watcher, etc.).
    Wake,
}

impl App {
    // ── Phase 1: one-time initialization on the main thread ──────────

    /// Perform one-time initialization that requires the real window handle
    /// (GPU surface creation, PTY pre-spawn, session restore).
    /// Called on the main thread before the app thread is spawned.
    pub(crate) fn init_phase1(&mut self, window: &dyn PlatformWindow) {
        self.platform.content_view_ptr = window.content_view_ptr();
        self.platform.window_ptr = window.window_ptr();

        let saved_session = session::load_session();
        let is_crash = session::is_crash_recovery();

        // Clean up stale shell init lock files (pyenv rehash, rbenv rehash, etc.)
        // before spawning any terminals. These tools use file-based locks that can
        // become stale if the shell process is killed mid-rehash (e.g. on app quit).
        cleanup_stale_shell_locks();

        if is_crash {
            // In crash recovery, skip pre-spawning a shell: restore_from_session
            // will create its own terminals, and the pre-spawned shell would just
            // be killed mid-init (potentially leaving pyenv-rehash locks).
            self.init_gpu(window);

            if let Some(session) = saved_session {
                if !self.restore_from_session(session) {
                    self.create_initial_pane(None);
                }
            } else {
                self.create_initial_pane(None);
            }
        } else {
            // Pre-spawn PTY with estimated dimensions (80x24) BEFORE GPU init.
            // The shell starts loading ~/.zshrc in parallel with GPU initialization,
            // so the prompt appears sooner after launch.
            let early_terminal =
                tide_terminal::Terminal::with_cwd(80, 24, None, self.window.dark_mode).ok();

            self.init_gpu(window); // Shell is loading in parallel

            if let Some(ref session) = saved_session {
                self.restore_preferences(session, early_terminal);
            } else {
                self.create_initial_pane(early_terminal);
            }
        }

        session::create_running_marker();

        // Initialize LSP manager for code completion
        self.init_lsp();
    }

    // ── Phase 2: app thread main loop ────────────────────────────────

    /// Run the app thread event loop.  Blocks on the event channel, processes
    /// events, polls background sources, and renders when needed.
    pub(crate) fn app_thread_run(
        mut self,
        event_rx: std::sync::mpsc::Receiver<AppEvent>,
        window: WindowProxy,
    ) {
        loop {
            let timeout = self.next_timeout();

            // Block until an event arrives or a timer fires
            let event = match event_rx.recv_timeout(timeout) {
                Ok(e) => Some(e),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => None,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            };

            // Process the received event and drain the queue
            for app_event in event.into_iter().chain(event_rx.try_iter()) {
                if let AppEvent::Platform(event) = app_event {
                    self.handle_platform_event(event, &window);
                }
            }

            // Poll background sources (PTY output, file watcher, git)
            self.poll_background_events(&window);

            // Periodic session auto-save for crash recovery (every 30s)
            {
                let now = Instant::now();
                if now.duration_since(self.timing.last_session_save) >= Duration::from_secs(30) {
                    self.save_full_session();
                    self.timing.last_session_save = now;
                }
            }

            // Cursor blink
            let blink_elapsed = Instant::now().duration_since(self.timing.cursor_blink_at);
            let blink_phase = (blink_elapsed.as_millis() / 530) % 2 == 0;
            if blink_phase != self.timing.cursor_visible {
                self.timing.cursor_visible = blink_phase;
                self.cache.needs_redraw = true;
            }

            // Render if needed
            if self.cache.needs_redraw && !self.window.is_occluded && self.input.batch_depth == 0 {
                let now = Instant::now();
                let skip_coalesce = self.input.input_just_sent
                    || self.input.input_sent_at.map_or(false, |at| {
                        now.duration_since(at) < Duration::from_millis(16)
                    })
                    || self.input.scroll_at.map_or(false, |at| {
                        now.duration_since(at) < Duration::from_millis(32)
                    });
                if skip_coalesce
                    || now.duration_since(self.timing.last_frame) >= Duration::from_millis(2)
                {
                    self.update();
                    if self.render() {
                        self.cache.needs_redraw = false;
                        self.timing.last_frame = now;

                        // Reveal window after first frame
                        if !self.platform.window_shown {
                            window.show_window();
                            // Re-establish first responder: macOS may reset
                            // it during window lifecycle initialization
                            // (delegate is set after makeKeyAndOrderFront,
                            // so the initial Focused event is missed).
                            if let Some(target) = self.effective_ime_target() {
                                window.focus_ime_proxy(target);
                            }
                            self.platform.window_shown = true;
                        }
                    }
                    // If render() returned false (render thread busy),
                    // the render thread waker will wake us when it finishes.
                }
            }
        }
    }

    /// Compute the timeout for the next `recv_timeout` call.
    fn next_timeout(&self) -> Duration {
        let now = Instant::now();
        let mut timeout = Duration::from_millis(100); // default max sleep

        // Cursor blink: next toggle
        if self.focus.focused.is_some() {
            let blink_elapsed = now.duration_since(self.timing.cursor_blink_at);
            let next_toggle_ms = 530 - (blink_elapsed.as_millis() % 530) as u64;
            timeout = timeout.min(Duration::from_millis(next_toggle_ms));
        }

        // Deferred resize
        if let Some(at) = self.timing.resize_deferred_at {
            if at > now {
                timeout = timeout.min(at - now);
            } else {
                return Duration::ZERO;
            }
        }

        // Badge check
        if let Some(at) = self.timing.badge_check_at {
            if at > now {
                timeout = timeout.min(at - now);
            } else {
                return Duration::ZERO;
            }
        }

        // Frame pacing: if we need to render but are within 2ms coalescing window
        if self.cache.needs_redraw && !self.window.is_occluded && self.input.batch_depth == 0 {
            let skip_coalesce = self.input.input_just_sent
                || self.input.input_sent_at.map_or(false, |at| {
                    now.duration_since(at) < Duration::from_millis(16)
                })
                || self.input.scroll_at.map_or(false, |at| {
                    now.duration_since(at) < Duration::from_millis(32)
                });
            if skip_coalesce {
                return Duration::ZERO; // render immediately
            }
            let since_last = now.duration_since(self.timing.last_frame);
            if since_last < Duration::from_millis(2) {
                timeout = timeout.min(Duration::from_millis(2) - since_last);
            } else {
                return Duration::ZERO; // past coalescing window, render now
            }
        }

        timeout
    }

    // ── Event handler (runs on app thread) ───────────────────────────

    /// Process a single platform event.  Called from the app thread loop.
    pub(crate) fn handle_platform_event(
        &mut self,
        event: PlatformEvent,
        window: &WindowProxy,
    ) {
        match event {
            PlatformEvent::BatchStart => {
                self.input.batch_depth += 1;
                return;
            }
            PlatformEvent::BatchEnd => {
                self.input.batch_depth = self.input.batch_depth.saturating_sub(1);
                // Fall through to IME sync below
            }
            PlatformEvent::RedrawRequested => {
                // Rendering is handled by the app thread loop, not here.
                // RedrawRequested from the main thread is just a wake signal.
                self.cache.needs_redraw = true;
                return;
            }
            PlatformEvent::CloseRequested => {
                // Check if there are running terminals or dirty editors
                let has_terminals = self.panes.values().any(|pk| matches!(pk, crate::pane::PaneKind::Terminal(_)));
                let has_dirty = self.panes.values().any(|pk| {
                    if let crate::pane::PaneKind::Editor(ep) = pk {
                        ep.editor.is_modified() && ep.editor.file_path().is_some()
                    } else { false }
                });
                if has_terminals || has_dirty {
                    if !tide_platform::show_close_confirm() {
                        return;
                    }
                }
                self.save_full_session();
                session::delete_running_marker();
                std::process::exit(0);
            }
            PlatformEvent::Resized { width, height } => {
                self.window.window_size = (width, height);
                self.reconfigure_surface();
                self.timing.resize_deferred_at =
                    Some(Instant::now() + Duration::from_millis(50));
                self.compute_layout();
                self.ime.cursor_dirty = true;
                self.cache.needs_redraw = true;
            }
            PlatformEvent::ScaleFactorChanged(scale) => {
                self.window.scale_factor = scale as f32;
                self.reconfigure_surface();
                self.compute_layout();
                self.cache.invalidate_chrome();
            }
            PlatformEvent::ModifiersChanged(modifiers) => {
                let old_shift = self.window.modifiers.shift;
                let new_shift = modifiers.shift;
                let old_meta = self.window.modifiers.meta;
                self.window.modifiers = modifiers;

                // Meta key toggles link underlines — redraw immediately
                if old_meta != modifiers.meta {
                    self.cache.needs_redraw = true;
                }

                // Shift+Shift double-tap detection
                if old_shift && !new_shift {
                    // Shift released: record timestamp
                    if self.input.shift_tap_clean {
                        if let Some(prev) = self.input.last_shift_up {
                            if prev.elapsed() < Duration::from_millis(400) {
                                // Double-tap detected
                                self.input.last_shift_up = None;
                                self.input.shift_tap_clean = false;
                                if self.modal.file_finder.is_some() {
                                    self.close_file_finder();
                                } else {
                                    self.open_file_finder();
                                }
                                self.cache.needs_redraw = true;
                            } else {
                                self.input.last_shift_up = Some(Instant::now());
                            }
                        } else {
                            self.input.last_shift_up = Some(Instant::now());
                        }
                    } else {
                        // A key was pressed between taps, reset
                        self.input.last_shift_up = Some(Instant::now());
                        self.input.shift_tap_clean = true;
                    }
                } else if !old_shift && new_shift {
                    // Shift pressed: mark clean (will be invalidated by KeyDown if needed)
                    self.input.shift_tap_clean = true;
                }
            }
            PlatformEvent::Focused(focused) => {
                if focused {
                    self.window.modifiers = tide_core::Modifiers::default();
                    // windowDidBecomeKey may have changed the actual first
                    // responder via LAST_IME_TARGET, making browser panes'
                    // is_first_responder flags stale.  Reset them so
                    // sync_browser_webview_frames can re-establish the
                    // WebView as first responder when needed.
                    for pane in self.panes.values_mut() {
                        if let crate::pane::PaneKind::Browser(bp) = pane {
                            bp.is_first_responder = false;
                        }
                    }
                    self.sync_ime_proxies(window);
                    self.sync_browser_webview_frames();
                } else {
                    // Cancel any in-progress drag when the window loses focus
                    if !matches!(self.interaction.pane_drag, crate::event_handler::drag_drop::PaneDragState::Idle) {
                        self.interaction.pane_drag = crate::event_handler::drag_drop::PaneDragState::Idle;
                        self.cache.needs_redraw = true;
                    }
                }
            }
            PlatformEvent::Fullscreen {
                is_fullscreen,
                width,
                height,
            } => {
                self.window.is_fullscreen = is_fullscreen;
                self.window.top_inset = if is_fullscreen { 0.0 } else { TITLEBAR_HEIGHT };
                self.timing.resize_deferred_at = None;

                // Use the size included in the event (avoids querying window
                // from the app thread, which would require a cross-thread call).
                if (width, height) != self.window.window_size {
                    self.window.window_size = (width, height);
                    self.reconfigure_surface();
                }

                self.compute_layout();
                self.ime.cursor_dirty = true;
                self.cache.invalidate_chrome();
            }
            PlatformEvent::Occluded(occluded) => {
                self.window.is_occluded = occluded;
                if !occluded {
                    self.cache.needs_redraw = true;
                }
            }
            PlatformEvent::WebViewFocused => {
                // Find which browser pane was clicked using the last known cursor position
                if let Some((pane_id, _)) = self.visual_pane_rects.iter().find(|(_, r)| {
                    r.contains(self.window.last_cursor_pos)
                }) {
                    let pid = *pane_id;
                    self.focus.focused = Some(pid);
                    self.router.set_focused(pid);
                    // Set correct focus area based on whether pane is in dock
                    if self.is_pane_in_dock(pid) {
                        self.focus.focus_area = FocusArea::Dock;
                    } else {
                        self.focus.focus_area = FocusArea::Stage;
                    }
                    // Clicking webview content unfocuses the URL bar.
                    // hitTest: returns the WKWebView so TideView's mouseDown
                    // never fires — this is the only place to clear it.
                    if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&pid) {
                        bp.url_input_focused = false;
                    }
                } else {
                    self.focus.focus_area = FocusArea::Stage;
                }
                self.cache.invalidate_chrome();
            }
            PlatformEvent::ImeCommit(text) => {
                self.input.shift_tap_clean = false;
                self.handle_ime_commit(&text);
                self.ime.cursor_dirty = true;
                self.timing.cursor_blink_at = Instant::now();
                self.timing.cursor_visible = true;
            }
            PlatformEvent::ImePreedit { text, cursor: _ } => {
                self.input.shift_tap_clean = false;
                self.handle_ime_preedit(&text);
                self.ime.cursor_dirty = true;
                self.timing.cursor_blink_at = Instant::now();
                self.timing.cursor_visible = true;
            }
            PlatformEvent::KeyDown {
                key,
                modifiers,
                chars,
            } => {
                // Invalidate Shift+Shift detection on any real key press
                self.input.shift_tap_clean = false;
                self.handle_key_down(key, modifiers, chars);
                self.ime.cursor_dirty = true;
                self.timing.cursor_blink_at = Instant::now();
                self.timing.cursor_visible = true;
            }
            PlatformEvent::KeyUp { .. } => {}
            PlatformEvent::MouseDown { button, position } => {
                let pos = self.physical_to_logical(position);
                self.window.last_cursor_pos = pos;
                let btn = platform_button_to_core(button);
                if let Some(btn) = btn {
                    self.handle_mouse_down(btn, window);
                }
                self.ime.cursor_dirty = true;
                self.timing.cursor_blink_at = Instant::now();
                self.timing.cursor_visible = true;
            }
            PlatformEvent::MouseUp { button, position } => {
                let pos = self.physical_to_logical(position);
                self.window.last_cursor_pos = pos;
                let btn = platform_button_to_core(button);
                if let Some(btn) = btn {
                    self.handle_mouse_up(btn);
                }
            }
            PlatformEvent::MouseMoved { position } => {
                let pos = self.physical_to_logical(position);
                self.handle_cursor_moved_logical(pos, window);
            }
            PlatformEvent::Scroll {
                dx,
                dy,
                position,
            } => {
                let pos = self.physical_to_logical(position);
                self.window.last_cursor_pos = pos;
                self.handle_scroll(dx, dy);
            }
        }

        // Process deferred fullscreen toggle
        if self.window.pending_fullscreen_toggle {
            self.window.pending_fullscreen_toggle = false;
            window.set_fullscreen(!self.window.is_fullscreen);
        }

        // Sync IME proxy views
        self.sync_ime_proxies(window);
    }

    /// Process pending IME proxy view operations and focus the correct proxy.
    ///
    /// Always calls `focus_ime_proxy` at the end, even when the target hasn't
    /// changed. macOS may unpredictably reset the first responder during event
    /// processing, so we must re-establish it unconditionally.
    pub(crate) fn sync_ime_proxies(&mut self, window: &WindowProxy) {
        // Process removes BEFORE creates so that re-created proxies (same
        // PaneId, e.g. Launcher → Terminal via resolve_launcher) work
        // correctly.  The old proxy must be gone before create_ime_proxy's
        // idempotent contains_key check runs, otherwise the create is a
        // no-op and the subsequent remove deletes the only proxy.
        for id in self.ime.pending_removes.drain(..) {
            window.remove_ime_proxy(id);
        }
        for id in self.ime.pending_creates.drain(..) {
            window.create_ime_proxy(id);
        }

        let target = self.effective_ime_target();
        if target != self.ime.last_target {
            if !self.ime.preedit.is_empty() {
                if let Some(old_target) = self.ime.last_target {
                    self.commit_text_to_pane(old_target, &self.ime.preedit.clone());
                }
            }
            self.ime.composing = false;
            self.ime.preedit.clear();
            self.cache.needs_redraw = true;
            self.ime.cursor_dirty = true;
            self.ime.last_target = target;
        }
        if let Some(target) = target {
            window.focus_ime_proxy(target);
        } else {
            // No IME target (e.g. browser pane focused without URL bar):
            // clear LAST_IME_TARGET so windowDidBecomeKey won't restore a
            // stale proxy as first responder after app switch (alt-tab).
            // Passing 0 stores 0 in the atomic and skips makeFirstResponder
            // since no proxy has id 0.
            window.focus_ime_proxy(0);
        }
    }

    /// Commit text directly to a specific pane.
    pub(crate) fn commit_text_to_pane(&mut self, pane_id: tide_core::PaneId, text: &str) {
        use crate::pane::PaneKind;
        // Compute visible size before mutable borrow of panes
        let editor_size = self.visible_editor_size(pane_id);
        match self.panes.get_mut(&pane_id) {
            Some(PaneKind::Terminal(pane)) => {
                pane.backend.write(text.as_bytes());
            }
            Some(PaneKind::Editor(pane)) => {
                if !pane.preview_mode {
                    pane.delete_selection();
                    pane.selection = None;
                    for ch in text.chars() {
                        let action = match ch {
                            ch if ch.is_control() => continue,
                            ch => tide_editor::EditorActionKind::InsertChar(ch),
                        };
                        pane.editor.handle_action(action);
                    }
                    // Ensure cursor stays visible after editing
                    let (visible_rows, visible_cols) = editor_size;
                    pane.editor.ensure_cursor_visible(visible_rows);
                    pane.editor.ensure_cursor_visible_h(visible_cols);
                    self.cache.invalidate_pane(pane_id);
                }
            }
            _ => {}
        }
    }

    /// The effective pane that will receive IME input, considering focus area.
    pub(crate) fn effective_ime_target(&self) -> Option<tide_core::PaneId> {
        effective_ime_target(
            self.focus.focused,
            self.focus.search_focus,
            &self.modal,
            &self.panes,
        )
    }

    fn physical_to_logical(&self, pos: (f64, f64)) -> tide_core::Vec2 {
        physical_to_logical(pos)
    }

    /// Poll background events (PTY output, file watcher, git).
    pub(crate) fn poll_background_events(&mut self, window: &WindowProxy) {
        self.poll_render_result();

        // Deferred PTY resize
        if let Some(at) = self.timing.resize_deferred_at {
            if Instant::now() >= at {
                self.timing.resize_deferred_at = None;
                self.compute_layout();
                self.cache.needs_redraw = true;
            }
        }

        // Check PTY output
        let mut had_pty_output = false;
        for pane in self.panes.values() {
            if let PaneKind::Terminal(terminal) = pane {
                if terminal.backend.has_new_output() {
                    self.cache.needs_redraw = true;
                    self.ime.cursor_dirty = true;
                    self.input.input_just_sent = false;
                    self.input.input_sent_at = None;
                    had_pty_output = true;
                    break;
                }
            }
        }

        if had_pty_output {
            self.timing.badge_check_at = Some(Instant::now() + Duration::from_millis(150));
        }

        // File watcher
        if self
            .bg.file_watch_dirty
            .swap(false, std::sync::atomic::Ordering::Relaxed)
        {
            self.cache.needs_redraw = true;
        }

        // Git poller
        if self.consume_git_poll_results() {
            self.cache.invalidate_chrome();
        }

        // LSP completion responses
        if self.poll_lsp() {
            // poll_lsp already invalidates the pane cache
        }

        // Browser Cmd+click new-tab requests
        let new_tab_urls = tide_platform::macos::webview::drain_new_tab_urls();
        for url in new_tab_urls {
            self.open_browser_pane(Some(url));
        }

        // Badge check
        if let Some(check_at) = self.timing.badge_check_at {
            if Instant::now() >= check_at {
                self.timing.badge_check_at = None;
                self.update_file_tree_cwd();
                self.update_terminal_badges();

                if let Some(ref tx) = self.bg.git_poll_cwd_tx {
                    let cwds: std::collections::HashSet<std::path::PathBuf> = self
                        .panes
                        .values()
                        .filter_map(|pane| {
                            if let PaneKind::Terminal(p) = pane {
                                p.context.cwd.clone()
                            } else {
                                None
                            }
                        })
                        .collect();
                    let _ = tx.send(cwds.into_iter().collect());
                }
            }
        }

        // Update IME cursor area
        self.update_ime_cursor_area(window);
    }

    /// Update the IME cursor area on the proxy view.
    fn update_ime_cursor_area(&mut self, window: &WindowProxy) {
        if !self.ime.cursor_dirty {
            return;
        }
        self.ime.cursor_dirty = false;
        use tide_core::TerminalBackend;

        let cell_size = self.cell_size();

        let target_id = match self.focus.focused {
            Some(id) => id,
            None => return,
        };

        match self.panes.get(&target_id) {
            Some(PaneKind::Terminal(pane)) => {
                if let Some((_, rect)) = self
                    .visual_pane_rects
                    .iter()
                    .find(|(id, _)| *id == target_id)
                {
                    let cursor = pane.backend.cursor();
                    let inner_w = rect.width - 2.0 * crate::theme::PANE_PADDING;
                    let max_cols = (inner_w / cell_size.width).floor() as usize;
                    let actual_w = max_cols as f32 * cell_size.width;
                    let center_x = (inner_w - actual_w) / 2.0;
                    let top = crate::theme::TAB_BAR_HEIGHT;
                    let cx = rect.x
                        + crate::theme::PANE_PADDING
                        + center_x
                        + cursor.col as f32 * cell_size.width;
                    let cy = rect.y + top + cursor.row as f32 * cell_size.height;
                    window.set_ime_proxy_cursor_area(
                        target_id,
                        cx as f64,
                        cy as f64,
                        cell_size.width as f64,
                        cell_size.height as f64,
                    );
                }
            }
            Some(PaneKind::Editor(pane)) => {
                let pos = pane.editor.cursor_position();
                let scroll = pane.editor.scroll_offset();
                let h_scroll = pane.editor.h_scroll_offset();
                if pos.line < scroll {
                    return;
                }
                let visual_row = pos.line - scroll;
                let cursor_char_col =
                    if let Some(line_text) = pane.editor.buffer.line(pos.line) {
                        let byte_col = pos.col.min(line_text.len());
                        line_text[..byte_col].chars().count()
                    } else {
                        0
                    };
                if cursor_char_col < h_scroll {
                    return;
                }
                let visual_col = cursor_char_col - h_scroll;
                let gutter_cells = crate::pane::editor::GUTTER_WIDTH_CELLS;

                let (inner_x, inner_y) = if let Some((_, rect)) = self
                    .visual_pane_rects
                    .iter()
                    .find(|(id, _)| *id == target_id)
                {
                    let top = crate::theme::TAB_BAR_HEIGHT;
                    (rect.x + crate::theme::PANE_PADDING, rect.y + top)
                } else {
                    return;
                };

                let gutter_width = gutter_cells as f32 * cell_size.width;
                let cx = inner_x + gutter_width + visual_col as f32 * cell_size.width;
                let cy = inner_y + visual_row as f32 * cell_size.height;
                window.set_ime_proxy_cursor_area(
                    target_id,
                    cx as f64,
                    cy as f64,
                    cell_size.width as f64,
                    cell_size.height as f64,
                );
            }
            _ => {}
        }
    }
}

/// Convert physical (f64) coordinates to logical Vec2.
fn physical_to_logical(pos: (f64, f64)) -> tide_core::Vec2 {
    tide_core::Vec2::new(pos.0 as f32, pos.1 as f32)
}

/// The effective pane that will receive IME input, considering focus area.
/// Returns None when a browser pane is focused without URL bar and no text-input modal is open.
pub(crate) fn effective_ime_target(
    focused: Option<tide_core::PaneId>,
    search_focus: Option<tide_core::PaneId>,
    modal: &crate::state::ModalStack,
    panes: &std::collections::HashMap<tide_core::PaneId, PaneKind>,
) -> Option<tide_core::PaneId> {
    let target = focused;
    if let Some(id) = target {
        if let Some(PaneKind::Browser(bp)) = panes.get(&id) {
            if !bp.url_input_focused {
                let has_text_modal = modal.file_finder.is_some()
                    || modal.git_switcher.is_some()
                    || modal.save_as_input.is_some()
                    || modal.file_tree_rename.is_some()
                    || search_focus == Some(id);
                if !has_text_modal {
                    return None;
                }
            }
        }
    }
    target
}

fn platform_button_to_core(
    button: tide_platform::MouseButton,
) -> Option<tide_core::MouseButton> {
    match button {
        tide_platform::MouseButton::Left => Some(tide_core::MouseButton::Left),
        tide_platform::MouseButton::Right => Some(tide_core::MouseButton::Right),
        tide_platform::MouseButton::Middle => Some(tide_core::MouseButton::Middle),
        _ => None,
    }
}

/// Remove stale lock files left by shell init tools (pyenv, rbenv, nodenv).
/// These tools use file-based locks during `rehash` that become stale if the
/// shell is killed mid-rehash (e.g. when the app quits). A stale lock causes
/// every subsequent shell startup to fail with a "cannot acquire lock" error.
fn cleanup_stale_shell_locks() {
    if let Some(home) = dirs::home_dir() {
        let lock_files = [
            home.join(".pyenv/shims/.pyenv-shim"),
            home.join(".rbenv/shims/.rbenv-shim"),
            home.join(".nodenv/shims/.nodenv-shim"),
        ];
        for path in &lock_files {
            if path.exists() {
                if let Err(e) = std::fs::remove_file(path) {
                    log::warn!("Failed to remove stale lock {:?}: {}", path, e);
                } else {
                    log::info!("Removed stale shell lock: {:?}", path);
                }
            }
        }
    }
}
