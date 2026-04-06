// Command handlers for Agent Gateway.
// All command functions are free functions taking port trait bounds.
// App.handle_cli_command() is the thin dispatch bridge.

use std::path::PathBuf;

use serde_json::{json, Value};

use crate::pane::PaneKind;
use crate::tide_core::{SplitDirection, TerminalBackend};
use crate::tide_layout::LayoutSnapshot;
use crate::ActionPort;
use crate::AppCorePort;
use crate::FocusNavPort;
use crate::GatewayPort;
use crate::LayoutPort;
use crate::PaneAccessPort;
use crate::PaneLifecyclePort;

use super::protocol::CliError;

// ── Trait alias for CLI ports ──

pub(crate) trait CliPorts:
    ActionPort
    + AppCorePort
    + FocusNavPort
    + GatewayPort
    + LayoutPort
    + PaneAccessPort
    + PaneLifecyclePort
{
}
impl<
        T: ActionPort
            + AppCorePort
            + FocusNavPort
            + GatewayPort
            + LayoutPort
            + PaneAccessPort
            + PaneLifecyclePort,
    > CliPorts for T
{
}

// ── Dispatch (remains on App) ──

impl crate::App {
    /// Dispatch a CLI command by method name.
    /// Handles cross-workspace routing: if `_caller_pane` is present in params,
    /// the command executes in the workspace that owns that pane, then swaps back.
    pub(crate) fn handle_cli_command(
        &mut self,
        method: &str,
        mut params: Value,
    ) -> Result<Value, CliError> {
        // Extract and strip _caller_pane so handlers never see it (BR-5)
        let caller_pane = params
            .as_object_mut()
            .and_then(|m| m.remove("_caller_pane"))
            .and_then(|v| v.as_u64());

        self.pending_cli_caller_pane = caller_pane;

        // Find target workspace for the caller pane (UC-2, UC-4)
        let need_swap = caller_pane
            .and_then(|pid| self.find_workspace_for_pane(pid))
            .filter(|&ws_idx| ws_idx != self.ws.active);

        let original_ws = self.ws.active;

        // Swap to target workspace if needed (BR-1, BR-4: raw save/load, not switch_workspace)
        if let Some(target) = need_swap {
            self.save_active_workspace();
            self.ws.active = target;
            self.load_active_workspace();
        }

        // Execute command
        let result = self.dispatch_cli_command(method, params);

        // Swap back if we swapped (BR-2: restore even on error)
        if need_swap.is_some() {
            self.save_active_workspace();
            self.ws.active = original_ws;
            self.load_active_workspace();
        }

        self.pending_cli_caller_pane = None;

        result
    }

    /// Inner dispatch — routes to the appropriate command handler.
    fn dispatch_cli_command(&mut self, method: &str, params: Value) -> Result<Value, CliError> {
        match method {
            // Phase 1 — Observe
            "list-panes" => cli_list_panes(self),
            "capture-pane" => cli_capture_pane(self, params),
            "capture-selection" => cli_capture_selection(self, params),
            "get-layout" => cli_get_layout(self),
            // Phase 2 — Act
            "browser-eval" => cli_browser_eval(self, params),
            "send-keys" => cli_send_keys(self, params),
            "split-vertical" => cli_split(self, SplitDirection::Vertical, params),
            "split-horizontal" => cli_split(self, SplitDirection::Horizontal, params),
            "close-pane" => cli_close_pane(self, params),
            "focus-pane" => cli_focus_pane(self, params),
            "resize-pane" => cli_resize_pane(self, params),
            "open-terminal" => cli_open_terminal(self, params),
            "open-editor" => cli_open_editor(self, params),
            "open-browser" => cli_open_browser(self, params),
            // Phase 3 — Show (Generative UI)
            "render-html" => cli_render_html(self, params),
            "render-stream" => cli_render_stream(self, params),
            "stream-chunk" => cli_stream_chunk(self, params),
            "stream-end" => cli_stream_end(self, params),
            // Phase 4 — Discover + React
            "subscribe" => cli_subscribe(self, params),
            "enable-integration" => cli_enable_integration(params),
            "remove-integration" => cli_remove_integration(params),
            "list-integrations" => Ok(json!(list_integration_status())),
            // Phase 5 — Agent lifecycle
            "create-context-artifact" => cli_create_context_artifact(self, params),
            "list-context-artifacts" => cli_list_context_artifacts(self),
            "read-context-artifact" => cli_read_context_artifact(self, params),
            "pin-context-artifact" => cli_pin_context_artifact(self, params),
            "remove-context-artifact" => cli_remove_context_artifact(self, params),
            "send-context-artifact" => cli_send_context_artifact(self, params),
            "notify" => cli_notify(self, params),
            _ => Err(CliError::MethodNotFound(method.to_string())),
        }
    }
}

// ── Phase 1: Observe ─────────────────────────────────────────────

/// UC-1: ListPanes — return all panes in the active workspace.
fn cli_list_panes(
    ctx: &(impl AppCorePort + FocusNavPort + PaneAccessPort),
) -> Result<Value, CliError> {
    let focused_id = ctx.focused_pane();
    let mut result = Vec::new();

    for (id, pane) in ctx.pane_entries() {
        let kind_str = match pane {
            PaneKind::Terminal(_) => "terminal",
            PaneKind::Editor(_) => "editor",
            PaneKind::Diff(_) => "diff",
            PaneKind::Browser(_) => "browser",
            PaneKind::Launcher(_) => "launcher",
        };

        let focused = focused_id == Some(id);

        let rect = ctx
            .pane_rects()
            .iter()
            .find(|(pid, _)| *pid == id)
            .map(|(_, r)| json!({"x": r.x, "y": r.y, "width": r.width, "height": r.height}))
            .unwrap_or(Value::Null);

        let title = ctx.pane_title(id);

        let mut entry = json!({
            "id": id,
            "kind": kind_str,
            "title": title,
            "rect": rect,
            "focused": focused,
        });

        // BR-3: Terminal-specific fields
        if let PaneKind::Terminal(tp) = pane {
            let obj = entry.as_object_mut().unwrap();
            if let Some(ref cwd) = tp.context.cwd {
                obj.insert("cwd".to_string(), json!(cwd.to_string_lossy()));
            }
            obj.insert("shell_idle".to_string(), json!(tp.context.shell_idle));
            obj.insert("pid".to_string(), json!(tp.backend.child_pid()));
        }

        // BR-4: Editor-specific fields
        if let PaneKind::Editor(ep) = pane {
            let obj = entry.as_object_mut().unwrap();
            if let Some(path) = ep.editor.file_path() {
                obj.insert("file_path".to_string(), json!(path.to_string_lossy()));
            }
            obj.insert("dirty".to_string(), json!(ep.editor.is_modified()));
        }

        // BR-5: Render pane fields
        if let PaneKind::Browser(bp) = pane {
            if bp.render_mode {
                let obj = entry.as_object_mut().unwrap();
                obj.insert("render_mode".to_string(), json!(true));
                obj.insert("streaming".to_string(), json!(bp.streaming));
                if let Some(ref t) = bp.render_title {
                    obj.insert("render_title".to_string(), json!(t));
                }
            }
        }

        result.push(entry);
    }

    result.sort_by_key(|v| v["id"].as_u64().unwrap_or(0));
    Ok(Value::Array(result))
}

/// UC-2: CapturePaneContent — read text from a terminal, editor, or Browser Pane.
fn cli_capture_pane(
    ctx: &(impl FocusNavPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .or_else(|| ctx.focused_pane())
        .ok_or_else(|| CliError::InvalidParams("no pane_id and no focused pane".into()))?;

    let pane = ctx.pane(pane_id).ok_or(CliError::PaneNotFound(pane_id))?;

    match pane {
        PaneKind::Terminal(tp) => {
            let grid = tp.backend.grid();
            let start = params.get("start").and_then(|v| v.as_i64()).unwrap_or(0);
            let end = params
                .get("end")
                .and_then(|v| v.as_i64())
                .unwrap_or(grid.rows as i64);

            let mut lines = Vec::new();
            for row_idx in 0..grid.rows as usize {
                let row_i = row_idx as i64;
                if row_i >= start && row_i < end {
                    let line: String = grid.cells[row_idx]
                        .iter()
                        .map(|c| c.character)
                        .collect::<String>()
                        .trim_end()
                        .to_string();
                    lines.push(line);
                }
            }

            Ok(json!({
                "pane_id": pane_id,
                "content": lines.join("\n"),
                "lines": lines,
            }))
        }
        PaneKind::Editor(ep) => {
            let start = params.get("start").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            let end = params
                .get("end")
                .and_then(|v| v.as_u64())
                .unwrap_or(ep.editor.buffer.line_count() as u64) as usize;

            let mut lines = Vec::new();
            for i in start..end.min(ep.editor.buffer.line_count()) {
                if let Some(line) = ep.editor.buffer.line(i) {
                    lines.push(line.to_string());
                }
            }

            Ok(json!({
                "pane_id": pane_id,
                "content": lines.join("\n"),
                "lines": lines,
            }))
        }
        PaneKind::Browser(browser) => {
            let snapshot = browser.page_snapshot.as_ref();
            let content = snapshot.map(|s| s.text.as_str()).unwrap_or_default();
            let lines = if content.is_empty() {
                Vec::new()
            } else {
                content.lines().map(str::to_string).collect::<Vec<_>>()
            };

            Ok(json!({
                "pane_id": pane_id,
                "kind": "browser",
                "title": snapshot.and_then(|s| s.page_title.as_deref()),
                "url": snapshot.and_then(|s| s.page_url.as_deref()),
                "content": content,
                "lines": lines,
            }))
        }
        PaneKind::Launcher(_) => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "terminal, editor, or browser",
            actual: "launcher",
        }),
        PaneKind::Diff(_) => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "terminal, editor, or browser",
            actual: "diff",
        }),
    }
}

/// UC-12: BrowserControl — evaluate JavaScript in a Browser Pane.
fn cli_browser_eval(
    ctx: &mut (impl FocusNavPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .or_else(|| ctx.focused_pane())
        .ok_or_else(|| CliError::InvalidParams("no pane_id and no focused pane".into()))?;
    let script = params
        .get("script")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("script required".into()))?;

    let pane = ctx
        .pane_mut(pane_id)
        .ok_or(CliError::PaneNotFound(pane_id))?;

    match pane {
        PaneKind::Browser(browser) => {
            if let Some(webview) = browser.webview.as_ref() {
                webview.evaluate_javascript(script);
            }
            browser.request_page_snapshot_refresh();
            Ok(json!({"ok": true}))
        }
        PaneKind::Terminal(_) => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "browser",
            actual: "terminal",
        }),
        PaneKind::Editor(_) => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "browser",
            actual: "editor",
        }),
        PaneKind::Diff(_) => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "browser",
            actual: "diff",
        }),
        PaneKind::Launcher(_) => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "browser",
            actual: "launcher",
        }),
    }
}

/// UC-4: GetLayout — return the layout tree as recursive JSON.
fn cli_get_layout(ctx: &impl LayoutPort) -> Result<Value, CliError> {
    match ctx.layout_snapshot() {
        Some(snap) => Ok(serialize_snapshot(&snap)),
        None => Ok(Value::Null),
    }
}

// ── Phase 2: Act ─────────────────────────────────────────────────

/// UC-3: SendKeys — write key sequences to a terminal pane's PTY.
fn cli_send_keys(
    ctx: &mut (impl FocusNavPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .or_else(|| ctx.focused_pane())
        .ok_or_else(|| CliError::InvalidParams("no pane_id and no focused pane".into()))?;

    let pane = ctx
        .pane_mut(pane_id)
        .ok_or(CliError::PaneNotFound(pane_id))?;

    match pane {
        PaneKind::Terminal(tp) => {
            let keys = params
                .get("keys")
                .and_then(|v| v.as_array())
                .ok_or_else(|| CliError::InvalidParams("keys array required".into()))?;

            for key in keys {
                let key_str = key.as_str().unwrap_or("");
                let bytes = translate_key(key_str);
                tp.backend.write(&bytes);
            }

            Ok(json!({"ok": true}))
        }
        _ => {
            let kind_str = match pane {
                PaneKind::Editor(_) => "editor",
                PaneKind::Diff(_) => "diff",
                PaneKind::Browser(_) => "browser",
                PaneKind::Launcher(_) => "launcher",
                _ => unreachable!(),
            };
            Err(CliError::InvalidPaneKind {
                pane_id,
                expected: "terminal",
                actual: kind_str,
            })
        }
    }
}

fn capture_selection_details(
    ctx: &crate::App,
    pane_id: crate::tide_core::PaneId,
) -> Result<(String, Option<crate::pane::Selection>, String), CliError> {
    let pane = ctx.pane(pane_id).ok_or(CliError::PaneNotFound(pane_id))?;

    match pane {
        PaneKind::Terminal(tp) => Ok((
            tp.selection
                .as_ref()
                .map(|sel| tp.selected_text(sel))
                .unwrap_or_default(),
            tp.selection.clone(),
            "terminal".to_string(),
        )),
        PaneKind::Editor(ep) => Ok((
            ep.selection
                .as_ref()
                .map(|sel| ep.selected_text(sel))
                .unwrap_or_default(),
            ep.selection.clone(),
            "editor".to_string(),
        )),
        PaneKind::Diff(dp) => Ok((
            dp.selection
                .as_ref()
                .map(|sel| dp.selected_text(sel))
                .unwrap_or_default(),
            dp.selection.clone(),
            "diff".to_string(),
        )),
        PaneKind::Browser(bp) => {
            let content = if bp.url_input_focused && bp.url_selection.is_some() {
                bp.url_selected_text().unwrap_or_default()
            } else if bp.page_selection.is_some() {
                bp.page_selection_content().unwrap_or_default()
            } else if bp.render_mode {
                bp.render_html.clone().unwrap_or_default()
            } else {
                bp.url_selected_text().unwrap_or_default()
            };
            Ok((
                content,
                None,
                if bp.render_mode {
                    "browser-render".to_string()
                } else {
                    "browser".to_string()
                },
            ))
        }
        PaneKind::Launcher(_) => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "terminal, editor, diff, or browser",
            actual: "launcher",
        }),
    }
}

fn serialize_selection(selection: &crate::pane::Selection) -> Value {
    crate::state::context_artifact::serialize_selection(selection)
}

fn cli_capture_selection(ctx: &crate::App, params: Value) -> Result<Value, CliError> {
    let pane_id = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .or_else(|| ctx.focused_pane())
        .ok_or_else(|| CliError::InvalidParams("no pane_id and no focused pane".into()))?;

    let (content, selection, kind) = capture_selection_details(ctx, pane_id)?;
    Ok(json!({
        "pane_id": pane_id,
        "kind": kind,
        "content": content,
        "selection": selection.as_ref().map(serialize_selection).unwrap_or(Value::Null),
    }))
}

/// UC-5: Split — split from a source pane, creating a new terminal.
fn cli_split(
    ctx: &mut (impl ActionPort + FocusNavPort + PaneAccessPort),
    direction: SplitDirection,
    params: Value,
) -> Result<Value, CliError> {
    let source = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .or_else(|| ctx.focused_pane())
        .ok_or_else(|| CliError::InvalidParams("no pane_id and no focused pane".into()))?;

    if !ctx.has_pane(source) {
        return Err(CliError::PaneNotFound(source));
    }

    let cwd = params
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(PathBuf::from);

    match ctx.split_pane_from(source, direction, cwd) {
        Some(new_id) => Ok(json!({"pane_id": new_id})),
        None => Err(CliError::InvalidParams("split failed".into())),
    }
}

/// UC-5: ClosePaneCli — close a specific pane.
fn cli_close_pane(
    ctx: &mut (impl FocusNavPort + PaneAccessPort + PaneLifecyclePort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .or_else(|| ctx.focused_pane())
        .ok_or_else(|| CliError::InvalidParams("no pane_id and no focused pane".into()))?;

    if !ctx.has_pane(pane_id) {
        return Err(CliError::PaneNotFound(pane_id));
    }

    ctx.close_specific_pane(pane_id);
    Ok(json!({"ok": true}))
}

/// UC-5: FocusPane — change focus to a specific pane.
fn cli_focus_pane(
    ctx: &mut (impl FocusNavPort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("pane_id required".into()))?;

    if !ctx.has_pane(pane_id) {
        return Err(CliError::PaneNotFound(pane_id));
    }

    ctx.focus_pane(pane_id);
    ctx.gateway_notify("focus-changed", json!({"pane_id": pane_id}));
    Ok(json!({"ok": true}))
}

/// UC-5: ResizePane — adjust the split ratio of the parent split.
fn cli_resize_pane(
    ctx: &mut (impl FocusNavPort + LayoutPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .or_else(|| ctx.focused_pane())
        .ok_or_else(|| CliError::InvalidParams("no pane_id and no focused pane".into()))?;

    if !ctx.has_pane(pane_id) {
        return Err(CliError::PaneNotFound(pane_id));
    }

    let ratio = params
        .get("ratio")
        .and_then(|v| v.as_f64())
        .map(|r| r as f32)
        .ok_or_else(|| CliError::InvalidParams("ratio (float) required".into()))?;

    if ctx.layout_set_split_ratio(pane_id, ratio) {
        ctx.compute_layout();
        Ok(json!({"ok": true}))
    } else {
        Err(CliError::InvalidParams("pane is not in a split".into()))
    }
}

/// UC-6: OpenTerminal — create a new terminal pane.
fn cli_open_terminal(
    ctx: &mut (impl ActionPort + FocusNavPort + PaneAccessPort + PaneLifecyclePort),
    params: Value,
) -> Result<Value, CliError> {
    let cwd = params
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(PathBuf::from);

    let source = ctx
        .focused_pane()
        .ok_or_else(|| CliError::InvalidParams("no focused pane for split target".into()))?;

    let direction = match params.get("position").and_then(|v| v.as_str()) {
        Some("split-below") => SplitDirection::Vertical,
        _ => SplitDirection::Horizontal,
    };

    match ctx.split_pane_from(source, direction, cwd) {
        Some(new_id) => Ok(json!({"pane_id": new_id})),
        None => Err(CliError::InvalidParams("terminal creation failed".into())),
    }
}

/// UC-6: OpenEditor — open a file in an editor pane.
fn cli_open_editor(
    ctx: &mut (impl FocusNavPort + PaneAccessPort + PaneLifecyclePort),
    params: Value,
) -> Result<Value, CliError> {
    let file = params
        .get("file")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("file path required".into()))?;

    let path = PathBuf::from(file);

    // BR-23: Check if already open → dedup
    for (id, pane) in ctx.pane_entries() {
        if let PaneKind::Editor(editor) = pane {
            if editor.editor.file_path() == Some(path.as_path()) {
                ctx.focus_pane(id);
                return Ok(json!({"pane_id": id, "already_open": true}));
            }
        }
    }

    ctx.open_editor_pane(path);

    if let Some(focused) = ctx.focused_pane() {
        Ok(json!({"pane_id": focused}))
    } else {
        Err(CliError::InvalidParams("editor creation failed".into()))
    }
}

/// UC-6: OpenBrowser — open a URL in a browser pane.
fn cli_open_browser(
    ctx: &mut (impl FocusNavPort + PaneLifecyclePort),
    params: Value,
) -> Result<Value, CliError> {
    let url = params.get("url").and_then(|v| v.as_str()).map(String::from);

    ctx.open_browser_pane(url);

    if let Some(focused) = ctx.focused_pane() {
        Ok(json!({"pane_id": focused}))
    } else {
        Err(CliError::InvalidParams("browser creation failed".into()))
    }
}

// ── Phase 3: Show (Generative UI) ────────────────────────────────

fn validate_render_root_fragment(html: &str) -> Result<(), CliError> {
    let lower = html.to_ascii_lowercase();
    if lower.contains("<!doctype")
        || lower.contains("<html")
        || lower.contains("<head")
        || lower.contains("<body")
    {
        return Err(CliError::InvalidParams(
            "html must be a #root fragment; do not include <!doctype>, <html>, <head>, or <body>"
                .into(),
        ));
    }
    Ok(())
}

/// UC-7: RenderHTML — render agent-provided HTML in a Browser pane.
/// Now uses PaneLifecyclePort::open_render_pane which places the pane in the Dock.
fn cli_render_html(
    ctx: &mut (impl AppCorePort + FocusNavPort + PaneAccessPort + PaneLifecyclePort),
    params: Value,
) -> Result<Value, CliError> {
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("title required".into()))?
        .to_string();
    let html = params
        .get("html")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("html required".into()))?
        .to_string();
    validate_render_root_fragment(&html)?;

    // If pane_id is specified, update existing render pane
    if let Some(pane_id) = params.get("pane_id").and_then(|v| v.as_u64()) {
        let pane = ctx
            .pane_mut(pane_id)
            .ok_or(CliError::PaneNotFound(pane_id))?;
        match pane {
            PaneKind::Browser(bp) if bp.render_mode => {
                bp.render_title = Some(title);
                bp.update_render_content(&html);
                ctx.invalidate_chrome();
                return Ok(json!({"pane_id": pane_id}));
            }
            PaneKind::Browser(_) => {
                return Err(CliError::InvalidPaneKind {
                    pane_id,
                    expected: "render-mode browser",
                    actual: "browser",
                });
            }
            _ => {
                return Err(CliError::InvalidPaneKind {
                    pane_id,
                    expected: "render-mode browser",
                    actual: "non-browser",
                });
            }
        }
    }

    // Create new render pane via port — goes to Dock!
    let new_id = ctx.open_render_pane(title, html);
    Ok(json!({"pane_id": new_id}))
}

/// UC-8: RenderStream — create a streaming render pane.
fn cli_render_stream(
    ctx: &mut (impl FocusNavPort + PaneLifecyclePort),
    params: Value,
) -> Result<Value, CliError> {
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("title required".into()))?
        .to_string();

    // Create new render stream pane via port — goes to Dock!
    let new_id = ctx.open_render_stream_pane(title);
    Ok(json!({"pane_id": new_id}))
}

/// UC-8: StreamChunk — send an HTML chunk to a streaming render pane.
fn cli_stream_chunk(ctx: &mut impl PaneAccessPort, params: Value) -> Result<Value, CliError> {
    let pane_id = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("pane_id required".into()))?;
    let html = params
        .get("html")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("html required".into()))?;
    validate_render_root_fragment(html)?;

    let pane = ctx
        .pane_mut(pane_id)
        .ok_or(CliError::PaneNotFound(pane_id))?;

    match pane {
        PaneKind::Browser(bp) if bp.render_mode => {
            bp.update_render_content(html);
            Ok(json!({"ok": true}))
        }
        PaneKind::Browser(_) => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "render-mode browser",
            actual: "browser",
        }),
        _ => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "render-mode browser",
            actual: "non-browser",
        }),
    }
}

/// UC-8: StreamEnd — end a streaming connection.
fn cli_stream_end(
    ctx: &mut (impl AppCorePort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("pane_id required".into()))?;

    let pane = ctx
        .pane_mut(pane_id)
        .ok_or(CliError::PaneNotFound(pane_id))?;

    match pane {
        PaneKind::Browser(bp) if bp.render_mode && bp.streaming => {
            bp.streaming = false;
            ctx.gateway_dec_streams();
            ctx.invalidate_chrome();
            Ok(json!({"ok": true}))
        }
        PaneKind::Browser(bp) if bp.render_mode => {
            Err(CliError::InvalidParams("pane is not streaming".into()))
        }
        _ => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "streaming render-mode browser",
            actual: "non-render",
        }),
    }
}

// ── Phase 4: Discover + React ─────────────────────────────────────

/// UC-9: Subscribe — register for event notifications.
fn cli_subscribe(ctx: &mut crate::App, params: Value) -> Result<Value, CliError> {
    let event_filter: Vec<String> = params
        .get("events")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let tx = ctx
        .take_subscribe_tx()
        .ok_or_else(|| CliError::InvalidParams("subscribe requires notification channel".into()))?;

    ctx.gateway_subscribe(ctx.pending_cli_caller_pane, tx, event_filter);
    Ok(json!({"ok": true}))
}

fn active_artifact_json(artifact: &crate::ContextArtifact) -> Value {
    crate::state::context_artifact::context_artifact_json(artifact)
}

fn caller_terminal_id(ctx: &crate::App) -> Result<crate::tide_core::PaneId, CliError> {
    ctx.pending_cli_caller_pane
        .ok_or_else(|| CliError::InvalidParams("caller pane required".into()))
}

fn source_terminal_for_pane(
    ctx: &crate::App,
    pane_id: crate::tide_core::PaneId,
) -> Result<crate::tide_core::PaneId, CliError> {
    match ctx.pane(pane_id) {
        Some(PaneKind::Terminal(_)) => Ok(pane_id),
        Some(_) => ctx
            .assoc
            .associated_terminal
            .get(&pane_id)
            .copied()
            .ok_or_else(|| {
                CliError::InvalidParams(format!("pane {pane_id} has no associated terminal"))
            }),
        None => Err(CliError::PaneNotFound(pane_id)),
    }
}

fn ensure_artifact_owner(
    caller_terminal_id: crate::tide_core::PaneId,
    associated_terminal_id: crate::tide_core::PaneId,
) -> Result<(), CliError> {
    if caller_terminal_id != associated_terminal_id {
        return Err(CliError::InvalidParams(format!(
            "pane is owned by terminal {associated_terminal_id}, not {caller_terminal_id}"
        )));
    }
    Ok(())
}

fn cli_create_context_artifact(ctx: &mut crate::App, params: Value) -> Result<Value, CliError> {
    let pane_id = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("pane_id required".into()))?;
    let comment = params
        .get("comment")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let pinned = params
        .get("pin")
        .and_then(|v| v.as_bool())
        .or_else(|| params.get("pinned").and_then(|v| v.as_bool()))
        .unwrap_or(false);

    let caller_terminal_id = caller_terminal_id(ctx)?;
    let associated_terminal_id = source_terminal_for_pane(ctx, pane_id)?;
    ensure_artifact_owner(caller_terminal_id, associated_terminal_id)?;
    let (content, selection, kind) = capture_selection_details(ctx, pane_id)?;

    let artifact = crate::ContextArtifact {
        artifact_id: ctx.context_artifacts.allocate_id(),
        source_pane_id: pane_id,
        associated_terminal_id,
        pane_kind: kind,
        selection,
        content,
        comment,
        pinned,
    };
    let artifact_id = artifact.artifact_id;
    ctx.context_artifacts
        .artifacts
        .insert(artifact_id, artifact.clone());

    Ok(active_artifact_json(&artifact))
}

fn cli_list_context_artifacts(ctx: &crate::App) -> Result<Value, CliError> {
    let caller_terminal_id = caller_terminal_id(ctx)?;
    let mut artifacts: Vec<_> = ctx
        .context_artifacts
        .artifacts
        .values()
        .filter(|artifact| artifact.associated_terminal_id == caller_terminal_id)
        .cloned()
        .collect();
    artifacts.sort_by_key(|artifact| artifact.artifact_id);
    Ok(Value::Array(
        artifacts.iter().map(active_artifact_json).collect(),
    ))
}

fn cli_read_context_artifact(ctx: &crate::App, params: Value) -> Result<Value, CliError> {
    let artifact_id = params
        .get("artifact_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("artifact_id required".into()))?;
    let caller_terminal_id = caller_terminal_id(ctx)?;
    let artifact = ctx
        .context_artifacts
        .artifacts
        .get(&artifact_id)
        .cloned()
        .ok_or(CliError::PaneNotFound(artifact_id))?;
    ensure_artifact_owner(caller_terminal_id, artifact.associated_terminal_id)?;
    Ok(active_artifact_json(&artifact))
}

fn cli_pin_context_artifact(ctx: &mut crate::App, params: Value) -> Result<Value, CliError> {
    let artifact_id = params
        .get("artifact_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("artifact_id required".into()))?;
    let pinned = params
        .get("pinned")
        .and_then(|v| v.as_bool())
        .or_else(|| params.get("pin").and_then(|v| v.as_bool()))
        .unwrap_or(true);

    let caller_terminal_id = caller_terminal_id(ctx)?;
    let associated_terminal_id = ctx
        .context_artifacts
        .artifacts
        .get(&artifact_id)
        .ok_or(CliError::PaneNotFound(artifact_id))?
        .associated_terminal_id;
    ensure_artifact_owner(caller_terminal_id, associated_terminal_id)?;

    let artifact = ctx
        .context_artifacts
        .artifacts
        .get_mut(&artifact_id)
        .ok_or(CliError::PaneNotFound(artifact_id))?;
    artifact.pinned = pinned;
    Ok(active_artifact_json(artifact))
}

fn cli_remove_context_artifact(ctx: &mut crate::App, params: Value) -> Result<Value, CliError> {
    let artifact_id = params
        .get("artifact_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("artifact_id required".into()))?;
    let caller_terminal_id = caller_terminal_id(ctx)?;
    let artifact = ctx
        .context_artifacts
        .artifacts
        .get(&artifact_id)
        .cloned()
        .ok_or(CliError::PaneNotFound(artifact_id))?;
    ensure_artifact_owner(caller_terminal_id, artifact.associated_terminal_id)?;
    ctx.context_artifacts.artifacts.remove(&artifact_id);
    Ok(json!({"ok": true, "artifact_id": artifact_id}))
}

fn cli_send_context_artifact(ctx: &mut crate::App, params: Value) -> Result<Value, CliError> {
    let artifact_id = params
        .get("artifact_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("artifact_id required".into()))?;
    let caller_terminal_id = caller_terminal_id(ctx)?;
    let artifact = ctx
        .context_artifacts
        .artifacts
        .get(&artifact_id)
        .cloned()
        .ok_or(CliError::PaneNotFound(artifact_id))?;
    ensure_artifact_owner(caller_terminal_id, artifact.associated_terminal_id)?;

    let terminal_input_injected = ctx.deliver_context_artifact(&artifact);

    Ok(json!({
        "ok": true,
        "artifact_id": artifact_id,
        "terminal_input_injected": terminal_input_injected
    }))
}

fn cli_enable_integration(params: Value) -> Result<Value, CliError> {
    let tool = params
        .get("tool")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("tool name required".into()))?;

    match enable_integration(tool) {
        Ok(path) => Ok(json!({"ok": true, "config_path": path})),
        Err(e) => Err(CliError::InvalidParams(e)),
    }
}

fn cli_remove_integration(params: Value) -> Result<Value, CliError> {
    let tool = params
        .get("tool")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("tool name required".into()))?;

    match remove_integration(tool) {
        Ok(()) => Ok(json!({"ok": true})),
        Err(e) => Err(CliError::InvalidParams(e)),
    }
}

// ── Helper functions (pure, no App dependency) ───────────────────

/// Integration tool definitions.
struct IntegrationTool {
    name: &'static str,
    detection: IntegrationDetection,
    config_path: &'static str,
    enable_method: EnableMethod,
}

enum IntegrationDetection {
    #[allow(dead_code)]
    Which(&'static str),
    DirExists(&'static str),
}

enum EnableMethod {
    JsonMcpServers,
    #[allow(dead_code)]
    JsonMcpServersSnake,
    CliCommand(&'static str),
}

const INTEGRATION_TOOLS: &[IntegrationTool] = &[
    IntegrationTool {
        name: "claude-code",
        detection: IntegrationDetection::DirExists("~/.claude"),
        config_path: "~/.claude.json",
        enable_method: EnableMethod::JsonMcpServers,
    },
    IntegrationTool {
        name: "codex",
        detection: IntegrationDetection::DirExists("~/.codex"),
        config_path: "~/.codex/config.toml",
        enable_method: EnableMethod::CliCommand("codex"),
    },
    IntegrationTool {
        name: "gemini",
        detection: IntegrationDetection::DirExists("~/.gemini"),
        config_path: "~/.gemini/settings.json",
        enable_method: EnableMethod::JsonMcpServers,
    },
    IntegrationTool {
        name: "cursor",
        detection: IntegrationDetection::DirExists("~/.cursor"),
        config_path: "~/.cursor/mcp.json",
        enable_method: EnableMethod::JsonMcpServers,
    },
    IntegrationTool {
        name: "windsurf",
        detection: IntegrationDetection::DirExists("~/.windsurf"),
        config_path: "~/.windsurf/mcp.json",
        enable_method: EnableMethod::JsonMcpServers,
    },
];

fn expand_home(path: &str) -> std::path::PathBuf {
    if path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return std::path::PathBuf::from(home).join(&path[2..]);
        }
    }
    std::path::PathBuf::from(path)
}

pub(crate) fn list_integration_status() -> Vec<Value> {
    INTEGRATION_TOOLS
        .iter()
        .map(|tool| {
            let installed = match &tool.detection {
                IntegrationDetection::Which(cmd) => std::process::Command::new("which")
                    .arg(cmd)
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false),
                IntegrationDetection::DirExists(dir) => expand_home(dir).exists(),
            };

            let config_path = expand_home(tool.config_path);
            let enabled = if config_path.exists() {
                let content = std::fs::read_to_string(&config_path).unwrap_or_default();
                match &tool.enable_method {
                    EnableMethod::CliCommand(_) => content.contains("[mcp_servers.tide]"),
                    _ => serde_json::from_str::<Value>(&content)
                        .ok()
                        .map(|v| v.get("mcpServers").and_then(|m| m.get("tide")).is_some())
                        .unwrap_or(false),
                }
            } else {
                false
            };

            json!({
                "tool": tool.name,
                "installed": installed,
                "enabled": enabled,
                "config_path": tool.config_path,
            })
        })
        .collect()
}

pub(crate) fn enable_integration(tool_name: &str) -> Result<String, String> {
    let tool = INTEGRATION_TOOLS
        .iter()
        .find(|t| t.name == tool_name)
        .ok_or_else(|| format!("unknown tool: {tool_name}"))?;

    let tide_bin = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "tide".to_string());

    match &tool.enable_method {
        EnableMethod::CliCommand(binary) => {
            let output = std::process::Command::new(binary)
                .args(["mcp", "add", "tide", &tide_bin, "mcp"])
                .output()
                .map_err(|e| format!("failed to run {binary} mcp add: {e}"))?;
            if output.status.success() {
                Ok(format!("{binary} mcp add tide"))
            } else {
                Err(format!(
                    "{binary} mcp add failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ))
            }
        }
        _ => {
            let config_path = expand_home(tool.config_path);
            if let Some(parent) = config_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("cannot create dir: {e}"))?;
            }

            let tide_entry = json!({"command": tide_bin, "args": ["mcp"]});

            let mut config: Value = if config_path.exists() {
                let content = std::fs::read_to_string(&config_path)
                    .map_err(|e| format!("cannot read config: {e}"))?;
                serde_json::from_str(&content).unwrap_or(json!({}))
            } else {
                json!({})
            };

            let obj = config.as_object_mut().ok_or("config is not an object")?;
            let servers = obj.entry("mcpServers").or_insert(json!({}));
            let servers_obj = servers
                .as_object_mut()
                .ok_or("mcpServers is not an object")?;
            servers_obj.insert("tide".to_string(), tide_entry);

            let output = serde_json::to_string_pretty(&config).unwrap();
            std::fs::write(&config_path, &output)
                .map_err(|e| format!("cannot write config: {e}"))?;

            Ok(config_path.to_string_lossy().into_owned())
        }
    }
}

pub(crate) fn remove_integration(tool_name: &str) -> Result<(), String> {
    let tool = INTEGRATION_TOOLS
        .iter()
        .find(|t| t.name == tool_name)
        .ok_or_else(|| format!("unknown tool: {tool_name}"))?;

    match &tool.enable_method {
        EnableMethod::CliCommand(binary) => {
            let _ = std::process::Command::new(binary)
                .args(["mcp", "remove", "tide"])
                .output();
            Ok(())
        }
        _ => {
            let config_path = expand_home(tool.config_path);
            if !config_path.exists() {
                return Ok(());
            }

            let content = std::fs::read_to_string(&config_path)
                .map_err(|e| format!("cannot read config: {e}"))?;
            let mut config: Value =
                serde_json::from_str(&content).map_err(|e| format!("invalid JSON: {e}"))?;

            if let Some(servers) = config.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
                servers.remove("tide");
            }

            let output = serde_json::to_string_pretty(&config).unwrap();
            std::fs::write(&config_path, &output)
                .map_err(|e| format!("cannot write config: {e}"))?;

            Ok(())
        }
    }
}

fn serialize_snapshot(snap: &LayoutSnapshot) -> Value {
    match snap {
        LayoutSnapshot::Leaf { tabs, active } => {
            let id = tabs
                .get(*active)
                .or_else(|| tabs.first())
                .copied()
                .unwrap_or(0);
            json!({
                "type": "leaf",
                "pane_id": id,
            })
        }
        LayoutSnapshot::LeafGroup { tabs, active } => {
            json!({
                "type": "tab_group",
                "tabs": tabs,
                "active": *active,
                "active_pane_id": tabs.get(*active).copied().unwrap_or(0),
            })
        }
        LayoutSnapshot::Split {
            direction,
            ratio,
            left,
            right,
        } => {
            let dir = match direction {
                crate::tide_core::SplitDirection::Horizontal => "horizontal",
                crate::tide_core::SplitDirection::Vertical => "vertical",
            };
            json!({
                "type": "split",
                "direction": dir,
                "ratio": ratio,
                "left": serialize_snapshot(left),
                "right": serialize_snapshot(right),
            })
        }
    }
}

// ── Phase 5: Agent Lifecycle ──────────────────────────────────────

/// Handle agent lifecycle notifications sent by wrapper hooks.
/// Updates AgentInfo.status for the given pane and bumps chrome generation.
fn cli_notify(
    ctx: &mut (impl AppCorePort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    use crate::state::gateway_status::AgentStatus;

    let event = params
        .get("event")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("event (string) required".into()))?;

    let pane_id = params
        .get("pane")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("pane (u64) required".into()))?;

    let status = match event {
        "agent-running" => AgentStatus::Running,
        "agent-idle" => AgentStatus::Idle,
        "agent-needs-input" => AgentStatus::NeedsInput,
        _ => return Err(CliError::InvalidParams(format!("unknown event: {event}"))),
    };

    // Only process notify for panes that actually exist (in any workspace)
    if !ctx.has_pane_in_any_workspace(pane_id) {
        return Ok(json!({"ok": true}));
    }

    // Update status if this pane has a detected agent.
    // If no agent is registered yet (wrapper hook fired before process scan),
    // auto-register from the agent name hint or with a generic name.
    let agent_display_name = params
        .get("agent")
        .and_then(|v| v.as_str())
        .unwrap_or("Agent");

    let agent_name = {
        let agents = ctx.detected_agents_mut();
        if let Some(agent) = agents.get_mut(&pane_id) {
            agent.status = Some(status);
            Some(agent.name)
        } else {
            // Auto-register: wrapper hook arrived before gateway modal scan.
            // Use a static str for the display name based on the hint.
            let name: &'static str = match agent_display_name {
                "claude" | "Claude Code" => "Claude Code",
                "codex" | "Codex" => "Codex",
                "gemini" | "Gemini" => "Gemini",
                _ => "Agent",
            };
            agents.insert(
                pane_id,
                crate::state::gateway_status::AgentInfo {
                    name,
                    pid: 0, // PID unknown from hook — will be updated on next process scan
                    gateway_connected: true, // wrapper implies MCP is connected
                    status: Some(status),
                },
            );
            Some(name)
        }
    };

    if let Some(name) = agent_name {
        ctx.invalidate_chrome();
        ctx.gateway_notify(
            "agent-status-changed",
            json!({
                "pane_id": pane_id,
                "status": event,
                "agent": name,
            }),
        );
        // Route notification based on user context (UC-1)
        ctx.route_agent_notification(pane_id, status);
    }

    Ok(json!({"ok": true}))
}

fn translate_key(key: &str) -> Vec<u8> {
    match key {
        "Enter" => vec![b'\r'],
        "Tab" => vec![b'\t'],
        "Space" => vec![b' '],
        "Escape" | "Esc" => vec![0x1b],
        "BSpace" | "Backspace" => vec![0x7f],
        "Delete" | "Del" => vec![0x1b, b'[', b'3', b'~'],
        "Up" => vec![0x1b, b'[', b'A'],
        "Down" => vec![0x1b, b'[', b'B'],
        "Right" => vec![0x1b, b'[', b'C'],
        "Left" => vec![0x1b, b'[', b'D'],
        "Home" => vec![0x1b, b'[', b'H'],
        "End" => vec![0x1b, b'[', b'F'],
        s if s.starts_with("C-") && s.len() == 3 => {
            let ch = s.as_bytes()[2];
            vec![ch.wrapping_sub(b'a').wrapping_add(1)]
        }
        s => s.as_bytes().to_vec(),
    }
}
