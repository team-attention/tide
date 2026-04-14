// Platform event dispatch and app thread main loop.

use std::time::Duration;

use crate::tide_core::TerminalBackend;
use crate::tide_platform::{PlatformEvent, PlatformWindow, WindowProxy};

use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::theme::*;
use crate::ActionPort;
use crate::App;
use crate::AppCorePort;
use crate::ClipboardSearchPort;
use crate::DockPort;
use crate::FileOpsPort;
use crate::FileTreePort;
use crate::FocusNavPort;
use crate::GatewayPort;
use crate::ImeStatePort;
use crate::InputStatePort;
use crate::LayoutPort;
use crate::ModalPort;
use crate::PaneAccessPort;
use crate::PaneLifecyclePort;
use crate::RouterPort;
use crate::WorkspaceNavPort;

pub(crate) fn terminal_badge_check_delay() -> Duration {
    Duration::from_millis(16)
}

/// Events delivered to the app thread.
pub(crate) enum AppEvent {
    /// A platform event forwarded from the main thread.
    Platform(PlatformEvent),
    /// Wake signal from a background thread (PTY output, file watcher, etc.).
    Wake,
    /// A command from an external process via the Agent Gateway socket.
    CliCommand(crate::adapter::inward::cli_adapter::CliCommand),
}

// ── Trait alias for event_loop_adapter ports ──
//
// EventLoopPorts is a superset of all ports required by sub-adapters
// (keyboard, mouse, scroll, ime, search) because handle_platform_event
// dispatches to all of them.

pub(crate) trait EventLoopPorts:
    ActionPort
    + AppCorePort
    + ClipboardSearchPort
    + DockPort
    + FileOpsPort
    + FileTreePort
    + FocusNavPort
    + GatewayPort
    + ImeStatePort
    + InputStatePort
    + LayoutPort
    + ModalPort
    + PaneAccessPort
    + PaneLifecyclePort
    + RouterPort
    + WorkspaceNavPort
{
}
impl<
        T: ActionPort
            + AppCorePort
            + ClipboardSearchPort
            + DockPort
            + FileOpsPort
            + FileTreePort
            + FocusNavPort
            + GatewayPort
            + ImeStatePort
            + InputStatePort
            + LayoutPort
            + ModalPort
            + PaneAccessPort
            + PaneLifecyclePort
            + RouterPort
            + WorkspaceNavPort,
    > EventLoopPorts for T
{
}

/// Process a single platform event.  Called from the app thread loop.
///
/// This handles domain-level event dispatch.  Infrastructure concerns
/// (IME proxy sync, fullscreen toggle) are handled by the `App` wrapper
/// in `app_thread_run`.
pub(crate) fn handle_platform_event(
    ctx: &mut impl EventLoopPorts,
    event: PlatformEvent,
    window: &WindowProxy,
) {
    match event {
        PlatformEvent::BatchStart => {
            ctx.increment_batch_depth();
            return;
        }
        PlatformEvent::BatchEnd => {
            ctx.decrement_batch_depth();
            // Fall through to post-event processing below
        }
        PlatformEvent::RedrawRequested => {
            // Rendering is handled by the app thread loop, not here.
            // RedrawRequested from the main thread is just a wake signal.
            ctx.request_redraw();
            return;
        }
        PlatformEvent::CloseRequested => {
            // Check if there are running terminals or dirty editors
            if ctx.has_terminals() || ctx.has_dirty_editors() {
                if !crate::tide_platform::show_close_confirm() {
                    return;
                }
            }
            ctx.save_full_session();
            ctx.delete_running_marker();
            std::process::exit(0);
        }
        PlatformEvent::Resized { width, height } => {
            ctx.set_window_size(width, height);
            ctx.reconfigure_surface();
            ctx.set_resize_deferred(50);
            ctx.compute_layout();
            ctx.set_ime_cursor_dirty();
            ctx.request_redraw();
        }
        PlatformEvent::ScaleFactorChanged(scale) => {
            ctx.set_scale_factor(scale as f32);
            ctx.reconfigure_surface();
            ctx.compute_layout();
            ctx.invalidate_chrome();
        }
        PlatformEvent::ModifiersChanged(modifiers) => {
            let old_mods = ctx.modifiers();
            let old_shift = old_mods.shift;
            let new_shift = modifiers.shift;
            let old_meta = old_mods.meta;
            ctx.set_modifiers(modifiers);

            // Meta key toggles link underlines — redraw immediately
            if old_meta != modifiers.meta {
                ctx.request_redraw();
            }

            // Shift+Shift double-tap detection
            if old_shift && !new_shift {
                // Shift released: record timestamp
                if ctx.shift_tap_clean() {
                    if let Some(prev) = ctx.last_shift_up() {
                        if prev.elapsed() < Duration::from_millis(400) {
                            // Double-tap detected
                            ctx.set_last_shift_up(None);
                            ctx.set_shift_tap_clean(false);
                            if ctx.modal().file_finder.is_some() {
                                ctx.close_file_finder();
                            } else {
                                ctx.open_file_finder();
                            }
                            ctx.request_redraw();
                        } else {
                            ctx.set_last_shift_up(Some(ctx.clock_now()));
                        }
                    } else {
                        ctx.set_last_shift_up(Some(ctx.clock_now()));
                    }
                } else {
                    // A key was pressed between taps, reset
                    ctx.set_last_shift_up(Some(ctx.clock_now()));
                    ctx.set_shift_tap_clean(true);
                }
            } else if !old_shift && new_shift {
                // Shift pressed: mark clean (will be invalidated by KeyDown if needed)
                ctx.set_shift_tap_clean(true);
            }
        }
        PlatformEvent::Focused(focused) => {
            ctx.set_window_focused(focused);
            if focused {
                if matches!(ctx.current_focus_area(), FocusArea::Stage | FocusArea::Dock)
                    && ctx.focused_pane().is_some()
                {
                    ctx.acknowledge_attention_for_focused_pane();
                }
                ctx.set_modifiers(crate::tide_core::Modifiers::default());
                // windowDidBecomeKey may have changed the actual first
                // responder via LAST_IME_TARGET, making browser panes'
                // is_first_responder flags stale.  Reset them so
                // sync_browser_webview_frames can re-establish the
                // WebView as first responder when needed.
                ctx.reset_browser_first_responder_flags();
                // sync_ime_proxies is called by the App wrapper after this function.
                ctx.sync_browser_webview_frames();
            } else {
                // Cancel any in-progress drag when the window loses focus
                if !matches!(
                    ctx.interaction().pane_drag,
                    crate::state::drag_types::PaneDragState::Idle
                ) {
                    ctx.interaction_mut().pane_drag = crate::state::drag_types::PaneDragState::Idle;
                    ctx.request_redraw();
                }
            }
        }
        PlatformEvent::Fullscreen {
            is_fullscreen,
            width,
            height,
        } => {
            ctx.set_fullscreen_state(is_fullscreen);
            ctx.set_top_inset(if is_fullscreen { 0.0 } else { TITLEBAR_HEIGHT });
            ctx.clear_resize_deferred();

            // Use the size included in the event (avoids querying window
            // from the app thread, which would require a cross-thread call).
            if (width, height) != ctx.window_size() {
                ctx.set_window_size(width, height);
                ctx.reconfigure_surface();
            }

            ctx.compute_layout();
            ctx.set_ime_cursor_dirty();
            ctx.invalidate_chrome();
        }
        PlatformEvent::Occluded(occluded) => {
            ctx.set_occluded(occluded);
            if !occluded {
                ctx.request_redraw();
            }
        }
        PlatformEvent::WebViewFocused => {
            // Find which browser pane was clicked using the last known cursor position
            let cursor_pos = ctx.last_cursor_pos();
            if let Some((pane_id, _)) = ctx
                .visual_pane_rects()
                .iter()
                .find(|(_, r)| r.contains(cursor_pos))
            {
                let pid = *pane_id;
                ctx.focus_pane(pid);
                // Set correct focus area based on whether pane is in dock
                if ctx.is_pane_in_dock(pid) {
                    ctx.set_focus_area(FocusArea::Dock);
                } else {
                    ctx.set_focus_area(FocusArea::Stage);
                }
                // WebView focus is an explicit request to move interaction into
                // page content when the Browser Pane is already navigated.
                if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(pid) {
                    bp.handle_webview_focused();
                }
            } else {
                ctx.set_focus_area(FocusArea::Stage);
            }
            ctx.invalidate_chrome();
        }
        PlatformEvent::ImeCommit(text) => {
            ctx.set_shift_tap_clean(false);
            crate::adapter::inward::ime_adapter::handle_ime_commit(ctx, &text);
            ctx.set_ime_cursor_dirty();
            ctx.reset_cursor_blink();
        }
        PlatformEvent::ImePreedit { text, cursor: _ } => {
            ctx.set_shift_tap_clean(false);
            crate::adapter::inward::ime_adapter::handle_ime_preedit(ctx, &text);
            ctx.set_ime_cursor_dirty();
            ctx.reset_cursor_blink();
        }
        PlatformEvent::KeyDown {
            key,
            modifiers,
            chars,
        } => {
            // Invalidate Shift+Shift detection on any real key press
            ctx.set_shift_tap_clean(false);
            crate::adapter::inward::keyboard_adapter::handle_key_down(ctx, key, modifiers, chars);
            ctx.set_ime_cursor_dirty();
            ctx.reset_cursor_blink();
        }
        PlatformEvent::KeyUp { .. } => {}
        PlatformEvent::MouseDown { button, position } => {
            let pos = physical_to_logical(position);
            ctx.set_last_cursor_pos(pos);
            let btn = platform_button_to_core(button);
            if let Some(btn) = btn {
                crate::adapter::inward::mouse_adapter::handle_mouse_down(ctx, btn, window);
            }
            ctx.set_ime_cursor_dirty();
            ctx.reset_cursor_blink();
        }
        PlatformEvent::MouseUp { button, position } => {
            let pos = physical_to_logical(position);
            ctx.set_last_cursor_pos(pos);
            let btn = platform_button_to_core(button);
            if let Some(btn) = btn {
                crate::adapter::inward::mouse_adapter::handle_mouse_up(ctx, btn);
            }
        }
        PlatformEvent::MouseMoved { position } => {
            let pos = physical_to_logical(position);
            crate::adapter::inward::mouse_adapter::drag::handle_cursor_moved_logical(
                ctx, pos, window,
            );
        }
        PlatformEvent::Scroll { dx, dy, position } => {
            let pos = physical_to_logical(position);
            ctx.set_last_cursor_pos(pos);
            crate::adapter::inward::scroll_adapter::handle_scroll(ctx, dx, dy);
        }
        PlatformEvent::SystemNotificationActivated { pane_id } => {
            ctx.activate_notification_target(pane_id);
            window.show_window();
            ctx.request_redraw();
        }
        PlatformEvent::NotificationAuthorizationStatusChanged { status } => {
            ctx.set_notification_authorization_status(status);
        }
    }

    // Process deferred fullscreen toggle
    if ctx.pending_fullscreen_toggle() {
        ctx.clear_pending_fullscreen_toggle();
        window.set_fullscreen(!ctx.is_fullscreen());
    }
}

// ── Infrastructure methods (stay on impl App) ──

impl App {
    pub(crate) fn apply_webview_bridge_message(&mut self, msg: &str) -> bool {
        let parsed: serde_json::Value = match serde_json::from_str(msg) {
            Ok(value) => value,
            Err(_) => return false,
        };
        let kind = match parsed.get("kind").and_then(|v| v.as_str()) {
            Some(kind) => kind,
            None => return false,
        };

        match kind {
            "browser-external-handoff" => {
                let pane_id = match parsed.get("pane_id").and_then(|v| v.as_u64()) {
                    Some(id) => id,
                    None => return false,
                };
                let url = parsed
                    .get("url")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty());

                match self.pane_mut(pane_id) {
                    Some(PaneKind::Browser(browser)) => {
                        browser.apply_external_handoff(url);
                        true
                    }
                    _ => false,
                }
            }
            "browser-snapshot" => {
                let pane_id = match parsed.get("pane_id").and_then(|v| v.as_u64()) {
                    Some(id) => id,
                    None => return false,
                };
                let text = parsed
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let page_title = parsed
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .filter(|s| !s.trim().is_empty());
                let page_url = parsed
                    .get("url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .filter(|s| !s.trim().is_empty());

                let snapshot =
                    if text.trim().is_empty() && page_title.is_none() && page_url.is_none() {
                        None
                    } else {
                        Some(crate::pane::browser::BrowserSnapshot {
                            text,
                            page_title,
                            page_url,
                        })
                    };

                match self.pane_mut(pane_id) {
                    Some(PaneKind::Browser(browser)) => browser.update_page_snapshot(snapshot),
                    _ => false,
                }
            }
            "browser-selection" => {
                let pane_id = match parsed.get("pane_id").and_then(|v| v.as_u64()) {
                    Some(id) => id,
                    None => return false,
                };
                let text = parsed
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let html = parsed
                    .get("html")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let context = parsed
                    .get("context")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .filter(|s| !s.trim().is_empty());
                let page_title = parsed
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .filter(|s| !s.trim().is_empty());
                let page_url = parsed
                    .get("url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .filter(|s| !s.trim().is_empty());
                let collapsed = parsed
                    .get("collapsed")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                let snapshot = if text.trim().is_empty() {
                    None
                } else {
                    Some(crate::pane::browser::BrowserSelectionSnapshot {
                        text,
                        html,
                        context,
                        page_title,
                        page_url,
                        collapsed,
                    })
                };

                match self.pane_mut(pane_id) {
                    Some(PaneKind::Browser(browser)) => {
                        if snapshot.is_none() {
                            browser.clear_page_selection();
                            true
                        } else {
                            browser.update_page_selection(snapshot)
                        }
                    }
                    _ => false,
                }
            }
            "browser-context-menu" => {
                let pane_id = match parsed.get("pane_id").and_then(|v| v.as_u64()) {
                    Some(id) => id,
                    None => return false,
                };
                let link_url = parsed
                    .get("link_url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .filter(|s| !s.trim().is_empty());
                let image_url = parsed
                    .get("image_url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .filter(|s| !s.trim().is_empty());
                let selected_text = parsed
                    .get("selected_text")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .filter(|s| !s.trim().is_empty());

                let target = crate::pane::browser::ContextMenuTarget {
                    link_url,
                    image_url,
                    selected_text,
                };

                match self.pane_mut(pane_id) {
                    Some(PaneKind::Browser(browser)) => {
                        browser.set_context_menu(target);
                        true
                    }
                    _ => false,
                }
            }
            "browser-permission-request" => {
                let pane_id = match parsed.get("pane_id").and_then(|v| v.as_u64()) {
                    Some(id) => id,
                    None => return false,
                };
                let permission_type = parsed
                    .get("permission_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("camera");
                let origin = parsed
                    .get("origin")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();

                let kind = match permission_type {
                    "camera" => crate::pane::browser::BrowserPermissionKind::Camera,
                    "microphone" => crate::pane::browser::BrowserPermissionKind::Microphone,
                    "geolocation" => crate::pane::browser::BrowserPermissionKind::Geolocation,
                    "camera_and_microphone" => {
                        crate::pane::browser::BrowserPermissionKind::CameraAndMicrophone
                    }
                    _ => crate::pane::browser::BrowserPermissionKind::Camera,
                };

                let request = crate::pane::browser::BrowserPermissionRequest { kind, origin };

                match self.pane_mut(pane_id) {
                    Some(PaneKind::Browser(browser)) => {
                        browser.request_permission(request);
                        true
                    }
                    _ => false,
                }
            }
            "browser-certificate-error" => {
                let pane_id = match parsed.get("pane_id").and_then(|v| v.as_u64()) {
                    Some(id) => id,
                    None => return false,
                };
                let host = parsed
                    .get("host")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let reason = parsed
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Certificate error")
                    .to_string();

                let error = crate::pane::browser::BrowserCertificateError { host, reason };

                match self.pane_mut(pane_id) {
                    Some(PaneKind::Browser(browser)) => {
                        browser.set_certificate_error(error);
                        true
                    }
                    _ => false,
                }
            }
            "browser-download-started" => {
                let pane_id = match parsed.get("pane_id").and_then(|v| v.as_u64()) {
                    Some(id) => id,
                    None => return false,
                };
                let url = parsed
                    .get("url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let destination = parsed
                    .get("destination")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                match self.pane_mut(pane_id) {
                    Some(PaneKind::Browser(browser)) => {
                        browser.begin_download(&url, &destination);
                        true
                    }
                    _ => false,
                }
            }
            "browser-download-failed" => {
                let pane_id = match parsed.get("pane_id").and_then(|v| v.as_u64()) {
                    Some(id) => id,
                    None => return false,
                };
                let reason = parsed
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error")
                    .to_string();

                match self.pane_mut(pane_id) {
                    Some(PaneKind::Browser(browser)) => {
                        browser.fail_download(&reason);
                        true
                    }
                    _ => false,
                }
            }
            "browser-download-completed" => {
                let pane_id = match parsed.get("pane_id").and_then(|v| v.as_u64()) {
                    Some(id) => id,
                    None => return false,
                };

                match self.pane_mut(pane_id) {
                    Some(PaneKind::Browser(browser)) => {
                        browser.complete_download();
                        true
                    }
                    _ => false,
                }
            }
            "browser-url-committed" => {
                let pane_id = match parsed
                    .get("pane_id")
                    .and_then(|v| v.as_str())
                    .and_then(|s| s.parse::<u64>().ok())
                {
                    Some(id) => id,
                    None => return false,
                };
                let url = match parsed.get("url").and_then(|v| v.as_str()) {
                    Some(u) => u,
                    None => return false,
                };
                match self.pane_mut(pane_id) {
                    Some(PaneKind::Browser(browser)) => {
                        browser.sync_committed_url_from_navigation(url)
                    }
                    _ => false,
                }
            }
            _ => false,
        }
    }

    // ── Phase 1: one-time initialization on the main thread ──────────

    /// Perform one-time initialization that requires the real window handle
    /// (GPU surface creation, PTY pre-spawn, session restore).
    /// Called on the main thread before the app thread is spawned.
    pub(crate) fn init_phase1(&mut self, window: &dyn PlatformWindow) {
        // Swap noop ports for real implementations now that we have a window.
        self.ports = crate::app::Ports::real();

        self.ports
            .platform
            .set_content_view_ptr(window.content_view_ptr());
        self.ports.platform.set_window_ptr(window.window_ptr());

        let saved_session = self.ports.persistence.load_session();
        let is_crash = self.ports.persistence.is_crash_recovery();

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
            let early_terminal = self
                .ports
                .terminal_factory
                .pre_spawn_terminal(80, 24, self.window.dark_mode, Some(1))
                .ok();

            self.init_gpu(window); // Shell is loading in parallel

            if let Some(ref session) = saved_session {
                self.restore_preferences(session, early_terminal);
            } else {
                self.create_initial_pane(early_terminal);
            }
        }

        self.ports.persistence.create_running_marker();

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
                match app_event {
                    AppEvent::Platform(event) => {
                        handle_platform_event(&mut self, event, &window);
                        // Sync IME proxy views (infrastructure — stays on App)
                        self.sync_ime_proxies(&window);
                    }
                    AppEvent::CliCommand(cmd) => {
                        // For subscribe commands, store the notification channel
                        if cmd.method == "subscribe" {
                            if let Some(notif_tx) = cmd.notification_tx {
                                self.pending_subscribe_tx = Some(notif_tx);
                            }
                        }
                        let result = self.handle_cli_command(&cmd.method, cmd.params);
                        let _ = cmd.response_tx.send(result);
                        self.pending_subscribe_tx = None;
                        // CLI commands (e.g. focus-pane, open-terminal) may
                        // change focus state.  Sync IME proxies so the macOS
                        // first responder matches the new focus — otherwise
                        // keyboard input goes to the old pane's ImeProxyView.
                        self.sync_ime_proxies(&window);
                    }
                    AppEvent::Wake => {}
                }
            }

            // Poll background sources (PTY output, file watcher, git)
            self.poll_background_events(&window);

            // Drain bridge messages from render pane JS bridge (BR-30)
            for msg in crate::tide_platform::macos::webview::drain_bridge_messages() {
                if !msg.is_empty() {
                    if self.apply_webview_bridge_message(&msg) {
                        self.invalidate_chrome();
                    }
                    self.gateway
                        .notify("webview-message", serde_json::json!({"message": msg}));
                }
            }

            // Sync connected client PIDs from socket server background thread
            if self.gateway.sync_connected_pids() {
                // PIDs changed — re-check gateway_connected for all detected agents
                self.gateway.refresh_agent_connections();
                // Re-detect agents in all terminals (an agent may have just connected)
                let pane_ids: Vec<u64> = self.panes.keys().copied().collect();
                for id in pane_ids {
                    if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get(&id) {
                        if let Some(pid) = tp.backend.child_pid() {
                            if let Some(mut agent) = crate::state::gateway_status::detect_agent(pid)
                            {
                                // Preserve existing status when re-detecting (process scan
                                // returns a fresh AgentInfo with status: None)
                                if let Some(existing) = self.gateway.detected_agents.get(&id) {
                                    agent.status = existing.status;
                                    agent.wrapper_managed = existing.wrapper_managed;
                                }
                                agent.gateway_connected =
                                    crate::state::gateway_status::is_agent_connected(
                                        agent.pid,
                                        &self.gateway.connected_pids,
                                    );
                                self.gateway.detected_agents.insert(id, agent);
                            } else {
                                // Keep wrapper-managed presence even when process scan misses a
                                // launch window or intermittently fails across Workspace swaps.
                                let keep_existing =
                                    self.gateway.detected_agents.get(&id).map_or(false, |a| {
                                        a.status.is_some()
                                            || (a.wrapper_managed && a.gateway_connected)
                                    });
                                if !keep_existing {
                                    self.gateway.detected_agents.remove(&id);
                                }
                            }
                        }
                    }
                }
                crate::AppCorePort::invalidate_chrome(&mut self);
            }

            // Periodic session auto-save for crash recovery (every 30s)
            {
                let now = self.ports.clock.now();
                if now.duration_since(self.timing.last_session_save) >= Duration::from_secs(30) {
                    self.save_full_session();
                    self.timing.last_session_save = now;
                }
            }

            // Cursor blink
            let blink_elapsed = self
                .ports
                .clock
                .now()
                .duration_since(self.timing.cursor_blink_at);
            let blink_phase = (blink_elapsed.as_millis() / 530) % 2 == 0;
            if blink_phase != self.timing.cursor_visible {
                self.timing.cursor_visible = blink_phase;
                crate::AppCorePort::request_redraw(&mut self);
            }

            // Wrapped-agent alert blink: continuous redraw while any Stage Terminal
            // or inactive Workspace still has unresolved alert state.
            {
                let has_blinking = self.has_any_stage_wrapped_agent_alert();
                if has_blinking {
                    crate::AppCorePort::request_redraw(&mut self);
                }
            }

            // Render if needed
            if self.cache.needs_redraw && !self.window.is_occluded && self.input.batch_depth == 0 {
                let now = self.ports.clock.now();
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
                        self.cache.clear_redraw();
                        self.timing.last_frame = now;

                        // Reveal window after first frame
                        if !self.ports.platform.window_shown() {
                            window.show_window();
                            // Re-establish first responder: macOS may reset
                            // it during window lifecycle initialization
                            // (delegate is set after makeKeyAndOrderFront,
                            // so the initial Focused event is missed).
                            if let Some(target) = self.effective_ime_target() {
                                window.focus_ime_proxy(target);
                            }
                            self.ports.platform.set_window_shown(true);
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
        let now = self.ports.clock.now();
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

    /// Process pending IME proxy view operations and focus the correct proxy.
    ///
    /// Always calls `focus_ime_proxy` at the end, even when the target hasn't
    /// changed. macOS may unpredictably reset the first responder during event
    /// processing, so we must re-establish it unconditionally.
    pub(crate) fn sync_ime_proxies(&mut self, window: &WindowProxy) {
        use crate::ImeStatePort;
        // Process removes BEFORE creates so that re-created proxies (same
        // PaneId, e.g. Launcher → Terminal via resolve_launcher) work
        // correctly.  The old proxy must be gone before create_ime_proxy's
        // idempotent contains_key check runs, otherwise the create is a
        // no-op and the subsequent remove deletes the only proxy.
        for id in self.drain_pending_removes() {
            window.remove_ime_proxy(id);
        }
        for id in self.drain_pending_creates() {
            window.create_ime_proxy(id);
        }

        let target = self.effective_ime_target();
        if target != self.ime_last_target() {
            if !self.ime_preedit().is_empty() {
                if let Some(old_target) = self.ime_last_target() {
                    self.commit_text_to_pane(old_target, &self.ime_preedit().to_string());
                }
            }
            self.set_ime_composing(false);
            self.clear_ime_preedit();
            crate::AppCorePort::request_redraw(self);
            self.set_ime_cursor_dirty();
            self.set_ime_last_target(target);
        }
        if let Some(target) = target {
            window.focus_ime_proxy(target);
        } else {
            window.focus_ime_proxy(0);
        }
    }

    /// Commit text directly to a specific pane.
    pub(crate) fn commit_text_to_pane(&mut self, pane_id: crate::tide_core::PaneId, text: &str) {
        use crate::pane::PaneKind;
        // Compute visible size before mutable borrow of panes
        let editor_size =
            crate::adapter::inward::text_routing_adapter::visible_editor_size(self, pane_id);
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
                            ch => crate::tide_editor::EditorActionKind::InsertChar(ch),
                        };
                        pane.editor.handle_action(action);
                    }
                    // Ensure cursor stays visible after editing
                    let (visible_rows, visible_cols) = editor_size;
                    pane.editor.ensure_cursor_visible(visible_rows);
                    pane.editor.ensure_cursor_visible_h(visible_cols);
                    crate::AppCorePort::invalidate_pane(self, pane_id);
                }
            }
            _ => {}
        }
    }

    /// The effective pane that will receive IME input, considering focus area.
    pub(crate) fn effective_ime_target(&self) -> Option<crate::tide_core::PaneId> {
        effective_ime_target(
            self.focus.focused,
            self.focus.search_focus,
            &self.modal,
            &self.panes,
        )
    }

    /// Poll background events (PTY output, file watcher, git).
    pub(crate) fn poll_background_events(&mut self, window: &WindowProxy) {
        self.poll_render_result();

        // Deferred PTY resize
        if let Some(at) = self.timing.resize_deferred_at {
            if self.ports.clock.now() >= at {
                self.timing.resize_deferred_at = None;
                self.compute_layout();
                crate::AppCorePort::request_redraw(self);
            }
        }

        // Check PTY output
        let mut had_pty_output = false;
        for pane in self.panes.values() {
            if let PaneKind::Terminal(terminal) = pane {
                if terminal.backend.has_new_output() {
                    crate::AppCorePort::request_redraw(self);
                    self.ime.cursor_dirty = true;
                    self.input.input_just_sent = false;
                    self.input.input_sent_at = None;
                    had_pty_output = true;
                    break;
                }
            }
        }

        if had_pty_output {
            self.timing.badge_check_at =
                Some(self.ports.clock.now() + terminal_badge_check_delay());
        }

        // Drain OSC 9 notifications from terminals
        {
            let mut terminal_notifications = Vec::new();

            let active_terminal_ids: Vec<u64> = self
                .panes
                .iter()
                .filter_map(|(&id, pk)| {
                    if matches!(pk, PaneKind::Terminal(_)) {
                        Some(id)
                    } else {
                        None
                    }
                })
                .collect();
            for id in active_terminal_ids {
                if let Some(PaneKind::Terminal(tp)) = self.panes.get(&id) {
                    for msg in tp.backend.drain_notifications() {
                        terminal_notifications.push((id, msg));
                    }
                }
            }

            for (workspace_idx, workspace) in self.ws.workspaces.iter().enumerate() {
                if workspace_idx == self.ws.active {
                    continue;
                }
                for (&id, pane) in &workspace.panes {
                    if let PaneKind::Terminal(tp) = pane {
                        for msg in tp.backend.drain_notifications() {
                            terminal_notifications.push((id, msg));
                        }
                    }
                }
            }

            for (id, msg) in terminal_notifications {
                self.handle_terminal_notification(id, &msg);
            }
        }

        // Drain pending platform commands (system notifications, dock bounce)
        {
            use crate::tide_platform::WindowCommand;
            let cmds: Vec<_> = self.pending_platform_commands.drain(..).collect();
            for cmd in cmds {
                match cmd {
                    WindowCommand::ShowWindow => {
                        window.show_window();
                    }
                    WindowCommand::SendSystemNotification {
                        ref title,
                        ref body,
                        pane_id,
                    } => {
                        window.send_system_notification(title, body, pane_id);
                    }
                    WindowCommand::RequestUserAttention => {
                        window.request_user_attention();
                    }
                    WindowCommand::RequestNotificationPermission => {
                        window.request_notification_permission();
                    }
                    _ => {}
                }
            }
        }

        // File watcher
        if self.ports.file_watcher.is_dirty() {
            self.ports.file_watcher.clear_dirty();
            crate::AppCorePort::request_redraw(self);
        }

        // Git poller
        if self.consume_git_poll_results() {
            crate::AppCorePort::invalidate_chrome(self);
        }

        // LSP completion responses
        if self.poll_lsp() {
            // poll_lsp already invalidates the pane cache
        }

        // Browser Cmd+click new-tab requests
        let new_tab_urls = crate::tide_platform::macos::webview::drain_new_tab_urls();
        for url in new_tab_urls {
            self.open_browser_pane(Some(url));
        }

        // Badge check
        if let Some(check_at) = self.timing.badge_check_at {
            if self.ports.clock.now() >= check_at {
                self.timing.badge_check_at = None;
                self.update_file_tree_cwd();
                self.update_terminal_badges();

                self.trigger_git_poll();
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
        use crate::tide_core::TerminalBackend;

        let cell_size = self.cell_size();

        if let Some((pane_id, rect)) = overlay_ime_cursor_area(
            self.focus.focused,
            self.focus.search_focus,
            &self.modal,
            &self.panes,
            &self.visual_pane_rects,
            self.logical_size(),
            cell_size,
            &self.ime.preedit,
        ) {
            window.set_ime_proxy_cursor_area(
                pane_id,
                rect.x as f64,
                rect.y as f64,
                rect.width as f64,
                rect.height as f64,
            );
            return;
        }

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
                    let top = crate::theme::terminal_content_top(cell_size.height);
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
                let cursor_char_col = if let Some(line_text) = pane.editor.buffer.line(pos.line) {
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
                    let content_rect =
                        pane.content_rect(*rect, crate::theme::TAB_BAR_HEIGHT, cell_size);
                    let authoring_rect = if pane.preview_mode {
                        content_rect
                    } else {
                        pane.authoring_rect(content_rect, cell_size)
                    };
                    (authoring_rect.x, authoring_rect.y)
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
fn physical_to_logical(pos: (f64, f64)) -> crate::tide_core::Vec2 {
    crate::tide_core::Vec2::new(pos.0 as f32, pos.1 as f32)
}

/// The effective pane that will receive IME input, considering focus area.
/// Returns None when a browser pane is focused without URL bar and no text-input modal is open.
pub(crate) fn effective_ime_target(
    focused: Option<crate::tide_core::PaneId>,
    search_focus: Option<crate::tide_core::PaneId>,
    modal: &crate::state::ModalStack,
    panes: &std::collections::HashMap<crate::tide_core::PaneId, PaneKind>,
) -> Option<crate::tide_core::PaneId> {
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

pub(crate) fn overlay_ime_cursor_area(
    focused: Option<crate::tide_core::PaneId>,
    search_focus: Option<crate::tide_core::PaneId>,
    modal: &crate::state::ModalStack,
    panes: &std::collections::HashMap<crate::tide_core::PaneId, PaneKind>,
    visual_pane_rects: &[(crate::tide_core::PaneId, crate::tide_core::Rect)],
    logical_size: crate::tide_core::Size,
    cell_size: crate::tide_core::Size,
    preedit: &str,
) -> Option<(crate::tide_core::PaneId, crate::tide_core::Rect)> {
    if let Some(id) = search_focus {
        let rect = visual_pane_rects
            .iter()
            .find(|(pane_id, _)| *pane_id == id)
            .map(|(_, rect)| *rect)?;
        let cursor = match panes.get(&id) {
            Some(PaneKind::Terminal(pane)) => pane.search.as_ref()?.input.cursor,
            Some(PaneKind::Editor(pane)) => pane.search.as_ref()?.input.cursor,
            Some(PaneKind::Browser(pane)) => pane.search.as_ref()?.input.cursor,
            _ => return None,
        };
        let query = match panes.get(&id) {
            Some(PaneKind::Terminal(pane)) => pane.search.as_ref()?.input.text.clone(),
            Some(PaneKind::Editor(pane)) => pane.search.as_ref()?.input.text.clone(),
            Some(PaneKind::Browser(pane)) => pane.search.as_ref()?.input.text.clone(),
            _ => return None,
        };

        let bar_w = crate::theme::SEARCH_BAR_WIDTH.min(rect.width - 16.0);
        if bar_w < 80.0 {
            return None;
        }
        let bar_x = rect.x + rect.width - bar_w - 8.0;
        let bar_y = rect.y + crate::theme::TAB_BAR_HEIGHT + 4.0;
        let text_x = bar_x + 6.0;
        let cursor_x = text_x
            + crate::adapter::outward::view::overlays::search_bar_cursor_advance_cells(
                &query, cursor, preedit,
            ) as f32
                * cell_size.width;
        let cursor_y = bar_y + (crate::theme::SEARCH_BAR_HEIGHT - cell_size.height) / 2.0;
        return Some((
            id,
            crate::tide_core::Rect::new(cursor_x, cursor_y, cell_size.width, cell_size.height),
        ));
    }

    if let Some(composer) = modal.context_comment_composer.as_ref() {
        return Some((
            composer.associated_terminal_id,
            crate::adapter::outward::view::overlays::context_comment_composer_cursor_area(
                logical_size,
                cell_size,
                &composer.comment.text,
                composer.comment.cursor,
                preedit,
            ),
        ));
    }

    let _ = focused;
    None
}

fn input_cursor_advance_cells(text: &str, cursor: usize, preedit: &str) -> f32 {
    let cursor = cursor.min(text.len());
    let before = &text[..cursor];
    let before_width: usize = before
        .chars()
        .map(|ch| unicode_width::UnicodeWidthChar::width(ch).unwrap_or(1))
        .sum();
    let preedit_width: usize = preedit
        .chars()
        .map(|ch| unicode_width::UnicodeWidthChar::width(ch).unwrap_or(1))
        .sum();
    (before_width + preedit_width) as f32
}

fn platform_button_to_core(
    button: crate::tide_platform::MouseButton,
) -> Option<crate::tide_core::MouseButton> {
    match button {
        crate::tide_platform::MouseButton::Left => Some(crate::tide_core::MouseButton::Left),
        crate::tide_platform::MouseButton::Right => Some(crate::tide_core::MouseButton::Right),
        crate::tide_platform::MouseButton::Middle => Some(crate::tide_core::MouseButton::Middle),
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

#[cfg(test)]
mod tests;
