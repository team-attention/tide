// Command handlers for Agent Gateway Phase 1 & 2.
// Each method takes params and returns a JSON result or CliError.

use std::path::PathBuf;

use serde_json::{json, Value};

use crate::App;
use crate::pane::PaneKind;
use crate::tide_core::{LayoutEngine, SplitDirection, TerminalBackend};
use crate::tide_layout::LayoutSnapshot;
use crate::ActionPort;
use crate::LayoutPort;
use crate::PaneLifecyclePort;

use super::protocol::CliError;

impl App {
    /// Dispatch a CLI command by method name.
    pub(crate) fn handle_cli_command(
        &mut self,
        method: &str,
        params: Value,
    ) -> Result<Value, CliError> {
        match method {
            // Phase 1 — Observe
            "list-panes" => self.cli_list_panes(),
            "capture-pane" => self.cli_capture_pane(params),
            "get-layout" => self.cli_get_layout(),
            // Phase 2 — Act
            "send-keys" => self.cli_send_keys(params),
            "split-vertical" => self.cli_split(SplitDirection::Vertical, params),
            "split-horizontal" => self.cli_split(SplitDirection::Horizontal, params),
            "close-pane" => self.cli_close_pane(params),
            "focus-pane" => self.cli_focus_pane(params),
            "resize-pane" => self.cli_resize_pane(params),
            "open-terminal" => self.cli_open_terminal(params),
            "open-editor" => self.cli_open_editor(params),
            "open-browser" => self.cli_open_browser(params),
            // Phase 3 — Show (Generative UI)
            "render-html" => self.cli_render_html(params),
            "render-stream" => self.cli_render_stream(params),
            "stream-chunk" => self.cli_stream_chunk(params),
            "stream-end" => self.cli_stream_end(params),
            // Phase 4 — Discover + React
            "subscribe" => self.cli_subscribe(params),
            "enable-integration" => self.cli_enable_integration(params),
            "remove-integration" => self.cli_remove_integration(params),
            "list-integrations" => self.cli_list_integrations(),
            _ => Err(CliError::MethodNotFound(method.to_string())),
        }
    }

    // ── Phase 1: Observe ─────────────────────────────────────────────

    /// UC-1: ListPanes — return all panes in the active workspace.
    fn cli_list_panes(&self) -> Result<Value, CliError> {
        let mut result = Vec::new();

        for (&id, pane) in &self.panes {
            let kind_str = match pane {
                PaneKind::Terminal(_) => "terminal",
                PaneKind::Editor(_) => "editor",
                PaneKind::Diff(_) => "diff",
                PaneKind::Browser(_) => "browser",
                PaneKind::Launcher(_) => "launcher",
            };

            let focused = self.focus.focused == Some(id);

            // Find rect for this pane
            let rect = self.pane_rects.iter()
                .find(|(pid, _)| *pid == id)
                .map(|(_, r)| json!({"x": r.x, "y": r.y, "width": r.width, "height": r.height}))
                .unwrap_or(Value::Null);

            let title = crate::ui::pane_title(&self.panes, id);

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

        // Sort by id for deterministic output
        result.sort_by_key(|v| v["id"].as_u64().unwrap_or(0));

        Ok(Value::Array(result))
    }

    /// UC-2: CapturePaneContent — read text from a terminal or editor pane.
    fn cli_capture_pane(&self, params: Value) -> Result<Value, CliError> {
        let pane_id = params.get("pane_id")
            .and_then(|v| v.as_u64())
            .or_else(|| self.focus.focused) // BR-10: default to focused pane
            .ok_or_else(|| CliError::InvalidParams("no pane_id and no focused pane".into()))?;

        let pane = self.panes.get(&pane_id)
            .ok_or(CliError::PaneNotFound(pane_id))?;

        match pane {
            PaneKind::Terminal(tp) => {
                let grid = tp.backend.grid();
                let start = params.get("start").and_then(|v| v.as_i64()).unwrap_or(0);
                let end = params.get("end").and_then(|v| v.as_i64())
                    .unwrap_or(grid.rows as i64);

                let mut lines = Vec::new();
                for row_idx in 0..grid.rows as usize {
                    let row_i = row_idx as i64;
                    if row_i >= start && row_i < end {
                        let line: String = grid.cells[row_idx].iter()
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
                let end = params.get("end").and_then(|v| v.as_u64())
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
            PaneKind::Browser(_) | PaneKind::Launcher(_) => {
                // BR-9: Browser/Launcher → error
                let kind_str = match pane {
                    PaneKind::Browser(_) => "browser",
                    PaneKind::Launcher(_) => "launcher",
                    _ => unreachable!(),
                };
                Err(CliError::InvalidPaneKind {
                    pane_id,
                    expected: "terminal or editor",
                    actual: kind_str,
                })
            }
            PaneKind::Diff(_) => {
                Err(CliError::InvalidPaneKind {
                    pane_id,
                    expected: "terminal or editor",
                    actual: "diff",
                })
            }
        }
    }

    /// UC-4: GetLayout — return the layout tree as recursive JSON.
    fn cli_get_layout(&self) -> Result<Value, CliError> {
        match self.layout.snapshot() {
            Some(snap) => Ok(serialize_snapshot(&snap)),
            None => Ok(Value::Null),
        }
    }

    // ── Phase 2: Act ─────────────────────────────────────────────────

    /// UC-3: SendKeys — write key sequences to a terminal pane's PTY.
    fn cli_send_keys(&mut self, params: Value) -> Result<Value, CliError> {
        let pane_id = params.get("pane_id")
            .and_then(|v| v.as_u64())
            .or_else(|| self.focus.focused) // BR-14: No -t → TIDE_PANE
            .ok_or_else(|| CliError::InvalidParams("no pane_id and no focused pane".into()))?;

        let pane = self.panes.get_mut(&pane_id)
            .ok_or(CliError::PaneNotFound(pane_id))?; // BR-13

        match pane {
            PaneKind::Terminal(tp) => {
                let keys = params.get("keys")
                    .and_then(|v| v.as_array())
                    .ok_or_else(|| CliError::InvalidParams("keys array required".into()))?;

                for key in keys {
                    let key_str = key.as_str().unwrap_or("");
                    let bytes = translate_key(key_str); // BR-11, BR-12
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

    /// UC-5: Split — split from a source pane, creating a new terminal.
    /// BR-17: Returns the new PaneId.
    fn cli_split(
        &mut self,
        direction: SplitDirection,
        params: Value,
    ) -> Result<Value, CliError> {
        let source = params.get("pane_id")
            .and_then(|v| v.as_u64())
            .or_else(|| self.focus.focused)
            .ok_or_else(|| CliError::InvalidParams("no pane_id and no focused pane".into()))?;

        if !self.panes.contains_key(&source) {
            return Err(CliError::PaneNotFound(source));
        }

        let cwd = params.get("cwd")
            .and_then(|v| v.as_str())
            .map(PathBuf::from);

        match self.split_pane_from(source, direction, cwd) {
            Some(new_id) => Ok(json!({"pane_id": new_id})),
            None => Err(CliError::InvalidParams("split failed".into())),
        }
    }

    /// UC-5: ClosePaneCli — close a specific pane.
    /// BR-18: Follows pane-lifecycle spec.
    fn cli_close_pane(&mut self, params: Value) -> Result<Value, CliError> {
        let pane_id = params.get("pane_id")
            .and_then(|v| v.as_u64())
            .or_else(|| self.focus.focused)
            .ok_or_else(|| CliError::InvalidParams("no pane_id and no focused pane".into()))?;

        if !self.panes.contains_key(&pane_id) {
            return Err(CliError::PaneNotFound(pane_id));
        }

        self.close_specific_pane(pane_id);
        Ok(json!({"ok": true}))
    }

    /// UC-5: FocusPane — change focus to a specific pane.
    /// BR-19: Changes focus.
    fn cli_focus_pane(&mut self, params: Value) -> Result<Value, CliError> {
        let pane_id = params.get("pane_id")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| CliError::InvalidParams("pane_id required".into()))?;

        if !self.panes.contains_key(&pane_id) {
            return Err(CliError::PaneNotFound(pane_id));
        }

        self.focus.focused = Some(pane_id);
        self.router.set_focused(pane_id);
        self.cache.invalidate_chrome();
        self.gateway.notify("focus-changed", json!({"pane_id": pane_id}));
        Ok(json!({"ok": true}))
    }

    /// UC-5: ResizePane — adjust the split ratio of the parent split.
    /// BR-20: Adjusts split ratio.
    fn cli_resize_pane(&mut self, params: Value) -> Result<Value, CliError> {
        let pane_id = params.get("pane_id")
            .and_then(|v| v.as_u64())
            .or_else(|| self.focus.focused)
            .ok_or_else(|| CliError::InvalidParams("no pane_id and no focused pane".into()))?;

        if !self.panes.contains_key(&pane_id) {
            return Err(CliError::PaneNotFound(pane_id));
        }

        let ratio = params.get("ratio")
            .and_then(|v| v.as_f64())
            .map(|r| r as f32)
            .ok_or_else(|| CliError::InvalidParams("ratio (float) required".into()))?;

        if self.layout.set_split_ratio(pane_id, ratio) {
            self.compute_layout();
            Ok(json!({"ok": true}))
        } else {
            Err(CliError::InvalidParams("pane is not in a split".into()))
        }
    }

    /// UC-6: OpenTerminal — create a new terminal pane.
    /// BR-21: Terminal accepts cwd.
    /// BR-24: --position support.
    fn cli_open_terminal(&mut self, params: Value) -> Result<Value, CliError> {
        let cwd = params.get("cwd")
            .and_then(|v| v.as_str())
            .map(PathBuf::from);

        let source = self.focus.focused
            .ok_or_else(|| CliError::InvalidParams("no focused pane for split target".into()))?;

        // Default position is split-right (horizontal split)
        let direction = match params.get("position").and_then(|v| v.as_str()) {
            Some("split-below") => SplitDirection::Vertical,
            Some("tab") => {
                // For tab positioning, create terminal in the same TabGroup
                let new_id = self.layout.alloc_id();
                self.create_terminal_pane(new_id, cwd);
                if !self.layout.add_tab(source, new_id) {
                    // Fallback to split if no TabGroup
                    self.layout.split(source, SplitDirection::Horizontal);
                }
                self.focus.focused = Some(new_id);
                self.router.set_focused(new_id);
                self.cache.invalidate_chrome();
                self.compute_layout();
                return Ok(json!({"pane_id": new_id}));
            }
            _ => SplitDirection::Horizontal, // "split-right" (default)
        };

        match self.split_pane_from(source, direction, cwd) {
            Some(new_id) => Ok(json!({"pane_id": new_id})),
            None => Err(CliError::InvalidParams("terminal creation failed".into())),
        }
    }

    /// UC-6: OpenEditor — open a file in an editor pane.
    /// BR-22: Non-existent file → empty buffer.
    /// BR-23: Already-open file → dedup (focus existing).
    fn cli_open_editor(&mut self, params: Value) -> Result<Value, CliError> {
        let file = params.get("file")
            .and_then(|v| v.as_str())
            .ok_or_else(|| CliError::InvalidParams("file path required".into()))?;

        let path = PathBuf::from(file);

        // BR-23: Check if already open → dedup
        for (&id, pane) in &self.panes {
            if let PaneKind::Editor(editor) = pane {
                if editor.editor.file_path() == Some(path.as_path()) {
                    // Already open — focus it
                    self.focus.focused = Some(id);
                    self.router.set_focused(id);
                    self.cache.invalidate_chrome();
                    return Ok(json!({"pane_id": id, "already_open": true}));
                }
            }
        }

        // Open new editor via existing port method
        self.open_editor_pane(path);

        // Return the newly focused pane (which should be the new editor)
        if let Some(focused) = self.focus.focused {
            Ok(json!({"pane_id": focused}))
        } else {
            Err(CliError::InvalidParams("editor creation failed".into()))
        }
    }

    /// UC-6: OpenBrowser — open a URL in a browser pane.
    fn cli_open_browser(&mut self, params: Value) -> Result<Value, CliError> {
        let url = params.get("url")
            .and_then(|v| v.as_str())
            .map(String::from);

        self.open_browser_pane(url);

        if let Some(focused) = self.focus.focused {
            Ok(json!({"pane_id": focused}))
        } else {
            Err(CliError::InvalidParams("browser creation failed".into()))
        }
    }

    // ── Phase 3: Show (Generative UI) ────────────────────────────────

    /// UC-7: RenderHTML — render agent-provided HTML in a Browser pane.
    /// BR-25: Loaded via loadHTMLString (no server).
    /// BR-26: Render-mode: no URL bar, title in tab.
    /// BR-27: Re-render same pane_id replaces content.
    /// BR-31: Render runtime pre-injected.
    fn cli_render_html(&mut self, params: Value) -> Result<Value, CliError> {
        let title = params.get("title")
            .and_then(|v| v.as_str())
            .ok_or_else(|| CliError::InvalidParams("title required".into()))?
            .to_string();
        let html = params.get("html")
            .and_then(|v| v.as_str())
            .ok_or_else(|| CliError::InvalidParams("html required".into()))?
            .to_string();

        // If pane_id is specified, update existing render pane
        if let Some(pane_id) = params.get("pane_id").and_then(|v| v.as_u64()) {
            let pane = self.panes.get_mut(&pane_id)
                .ok_or(CliError::PaneNotFound(pane_id))?;
            match pane {
                PaneKind::Browser(bp) if bp.render_mode => {
                    bp.render_title = Some(title);
                    bp.update_render_content(&html);
                    self.cache.invalidate_chrome();
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

        // Create new render pane
        let source = self.focus.focused
            .ok_or_else(|| CliError::InvalidParams("no focused pane for split target".into()))?;

        let new_id = self.layout.split(source, SplitDirection::Horizontal);
        let pane = crate::pane::browser::BrowserPane::new_render(new_id, title, html);
        self.panes.insert(new_id, PaneKind::Browser(pane));
        self.focus.focused = Some(new_id);
        self.router.set_focused(new_id);
        self.ime.pending_creates.push(new_id);
        self.cache.invalidate_chrome();
        self.compute_layout();
        self.gateway.notify("pane-created", json!({"pane_id": new_id, "kind": "render"}));

        Ok(json!({"pane_id": new_id}))
    }

    /// UC-8: RenderStream — create a streaming render pane.
    /// BR-34: Render runtime pre-loaded.
    /// BR-36: Multiple simultaneous streams.
    fn cli_render_stream(&mut self, params: Value) -> Result<Value, CliError> {
        let title = params.get("title")
            .and_then(|v| v.as_str())
            .ok_or_else(|| CliError::InvalidParams("title required".into()))?
            .to_string();

        let source = self.focus.focused
            .ok_or_else(|| CliError::InvalidParams("no focused pane for split target".into()))?;

        let new_id = self.layout.split(source, SplitDirection::Horizontal);
        let pane = crate::pane::browser::BrowserPane::new_render_stream(new_id, title);
        self.panes.insert(new_id, PaneKind::Browser(pane));
        self.focus.focused = Some(new_id);
        self.router.set_focused(new_id);
        self.ime.pending_creates.push(new_id);
        self.gateway.active_streams += 1;
        self.cache.invalidate_chrome();
        self.compute_layout();
        self.gateway.notify("pane-created", json!({"pane_id": new_id, "kind": "render-stream"}));

        Ok(json!({"pane_id": new_id}))
    }

    /// UC-8: StreamChunk — send an HTML chunk to a streaming render pane.
    /// BR-33: Chunks are full HTML snapshots (morphdom diffs against current DOM).
    fn cli_stream_chunk(&mut self, params: Value) -> Result<Value, CliError> {
        let pane_id = params.get("pane_id")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| CliError::InvalidParams("pane_id required".into()))?;
        let html = params.get("html")
            .and_then(|v| v.as_str())
            .ok_or_else(|| CliError::InvalidParams("html required".into()))?;

        let pane = self.panes.get_mut(&pane_id)
            .ok_or(CliError::PaneNotFound(pane_id))?;

        match pane {
            PaneKind::Browser(bp) if bp.render_mode => {
                bp.update_render_content(html);
                Ok(json!({"ok": true}))
            }
            PaneKind::Browser(_) => {
                Err(CliError::InvalidPaneKind {
                    pane_id,
                    expected: "render-mode browser",
                    actual: "browser",
                })
            }
            _ => {
                Err(CliError::InvalidPaneKind {
                    pane_id,
                    expected: "render-mode browser",
                    actual: "non-browser",
                })
            }
        }
    }

    /// UC-8: StreamEnd — end a streaming connection.
    /// BR-35: Disconnect keeps pane open with final content.
    fn cli_stream_end(&mut self, params: Value) -> Result<Value, CliError> {
        let pane_id = params.get("pane_id")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| CliError::InvalidParams("pane_id required".into()))?;

        let pane = self.panes.get_mut(&pane_id)
            .ok_or(CliError::PaneNotFound(pane_id))?;

        match pane {
            PaneKind::Browser(bp) if bp.render_mode && bp.streaming => {
                bp.streaming = false;
                if self.gateway.active_streams > 0 {
                    self.gateway.active_streams -= 1;
                }
                self.cache.invalidate_chrome();
                Ok(json!({"ok": true}))
            }
            PaneKind::Browser(bp) if bp.render_mode => {
                Err(CliError::InvalidParams("pane is not streaming".into()))
            }
            _ => {
                Err(CliError::InvalidPaneKind {
                    pane_id,
                    expected: "streaming render-mode browser",
                    actual: "non-render",
                })
            }
        }
    }

    // ── Phase 4: Discover + React ─────────────────────────────────────

    /// UC-9: Subscribe — register for event notifications.
    /// BR-38: Filtered by requested event types.
    /// BR-40: Disconnect unsubscribes.
    fn cli_subscribe(&mut self, params: Value) -> Result<Value, CliError> {
        let event_filter: Vec<String> = params.get("events")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();

        let tx = self.pending_subscribe_tx.take()
            .ok_or_else(|| CliError::InvalidParams("subscribe requires notification channel".into()))?;

        self.gateway.subscribers.push(
            crate::state::gateway_status::Subscriber { tx, event_filter }
        );

        Ok(json!({"ok": true}))
    }

    /// UC-11: ListIntegrations — list detected AI tools and their setup status.
    fn cli_list_integrations(&self) -> Result<Value, CliError> {
        let integrations = list_integration_status();
        Ok(json!(integrations))
    }

    /// UC-11: EnableIntegration — write MCP config for an AI tool.
    /// BR-52: Merges config — never overwrites existing MCP server entries.
    fn cli_enable_integration(&self, params: Value) -> Result<Value, CliError> {
        let tool = params.get("tool")
            .and_then(|v| v.as_str())
            .ok_or_else(|| CliError::InvalidParams("tool name required".into()))?;

        match enable_integration(tool) {
            Ok(path) => Ok(json!({"ok": true, "config_path": path})),
            Err(e) => Err(CliError::InvalidParams(e)),
        }
    }

    /// UC-11: RemoveIntegration — remove tide MCP config from an AI tool.
    /// BR-53: Only removes the `tide` entry, preserves everything else.
    fn cli_remove_integration(&self, params: Value) -> Result<Value, CliError> {
        let tool = params.get("tool")
            .and_then(|v| v.as_str())
            .ok_or_else(|| CliError::InvalidParams("tool name required".into()))?;

        match remove_integration(tool) {
            Ok(()) => Ok(json!({"ok": true})),
            Err(e) => Err(CliError::InvalidParams(e)),
        }
    }
}

/// Integration tool definitions.
struct IntegrationTool {
    name: &'static str,
    detection: IntegrationDetection,
    config_path: &'static str,
    /// How to enable: JSON merge into mcpServers, or CLI command.
    enable_method: EnableMethod,
}

enum IntegrationDetection {
    #[allow(dead_code)]
    Which(&'static str),
    DirExists(&'static str),
}

enum EnableMethod {
    /// Merge into JSON config file under "mcpServers" key.
    JsonMcpServers,
    /// Merge into JSON config file under "mcp_servers" key (snake_case).
    #[allow(dead_code)]
    JsonMcpServersSnake,
    /// Run a CLI command: `<binary> mcp add tide <tide_bin> -- mcp`
    CliCommand(&'static str),
}

const INTEGRATION_TOOLS: &[IntegrationTool] = &[
    IntegrationTool { name: "claude-code", detection: IntegrationDetection::DirExists("~/.claude"), config_path: "~/.claude.json", enable_method: EnableMethod::JsonMcpServers },
    IntegrationTool { name: "codex", detection: IntegrationDetection::DirExists("~/.codex"), config_path: "~/.codex/config.toml", enable_method: EnableMethod::CliCommand("codex") },
    IntegrationTool { name: "gemini", detection: IntegrationDetection::DirExists("~/.gemini"), config_path: "~/.gemini/settings.json", enable_method: EnableMethod::JsonMcpServers },
    IntegrationTool { name: "cursor", detection: IntegrationDetection::DirExists("~/.cursor"), config_path: "~/.cursor/mcp.json", enable_method: EnableMethod::JsonMcpServers },
    IntegrationTool { name: "windsurf", detection: IntegrationDetection::DirExists("~/.windsurf"), config_path: "~/.windsurf/mcp.json", enable_method: EnableMethod::JsonMcpServers },
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
    INTEGRATION_TOOLS.iter().map(|tool| {
        let installed = match &tool.detection {
            IntegrationDetection::Which(cmd) => {
                std::process::Command::new("which").arg(cmd).output()
                    .map(|o| o.status.success()).unwrap_or(false)
            }
            IntegrationDetection::DirExists(dir) => expand_home(dir).exists(),
        };

        let config_path = expand_home(tool.config_path);
        let enabled = if config_path.exists() {
            let content = std::fs::read_to_string(&config_path).unwrap_or_default();
            match &tool.enable_method {
                EnableMethod::CliCommand(_) => {
                    // Codex TOML: check for [mcp_servers.tide]
                    content.contains("[mcp_servers.tide]")
                }
                _ => {
                    // JSON: check mcpServers.tide
                    serde_json::from_str::<Value>(&content).ok()
                        .map(|v| v.get("mcpServers").and_then(|m| m.get("tide")).is_some())
                        .unwrap_or(false)
                }
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
    }).collect()
}

/// BR-52: Enable integration — merge tide MCP config into tool's config file.
pub(crate) fn enable_integration(tool_name: &str) -> Result<String, String> {
    let tool = INTEGRATION_TOOLS.iter().find(|t| t.name == tool_name)
        .ok_or_else(|| format!("unknown tool: {tool_name}"))?;

    let tide_bin = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "tide".to_string());

    match &tool.enable_method {
        EnableMethod::CliCommand(binary) => {
            // Codex: use `codex mcp add tide <tide_bin> -- mcp`
            let output = std::process::Command::new(binary)
                .args(["mcp", "add", "tide", &tide_bin, "mcp"])
                .output()
                .map_err(|e| format!("failed to run {binary} mcp add: {e}"))?;
            if output.status.success() {
                Ok(format!("{binary} mcp add tide"))
            } else {
                Err(format!("{binary} mcp add failed: {}", String::from_utf8_lossy(&output.stderr)))
            }
        }
        _ => {
            // JSON-based: merge into mcpServers
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
            let servers_obj = servers.as_object_mut().ok_or("mcpServers is not an object")?;
            servers_obj.insert("tide".to_string(), tide_entry);

            let output = serde_json::to_string_pretty(&config).unwrap();
            std::fs::write(&config_path, &output)
                .map_err(|e| format!("cannot write config: {e}"))?;

            Ok(config_path.to_string_lossy().into_owned())
        }
    }
}

/// BR-53: Remove integration — only removes the tide entry, preserves everything else.
pub(crate) fn remove_integration(tool_name: &str) -> Result<(), String> {
    let tool = INTEGRATION_TOOLS.iter().find(|t| t.name == tool_name)
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
            let mut config: Value = serde_json::from_str(&content)
                .map_err(|e| format!("invalid JSON: {e}"))?;

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

/// Recursively serialize a LayoutSnapshot to JSON.
fn serialize_snapshot(snap: &LayoutSnapshot) -> Value {
    match snap {
        LayoutSnapshot::Leaf { tabs, active } => {
            let id = tabs.get(*active).or_else(|| tabs.first()).copied().unwrap_or(0);
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
        LayoutSnapshot::Split { direction, ratio, left, right } => {
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

/// BR-11, BR-12: Translate key names to byte sequences.
/// Literal strings are sent as-is; special names are translated.
fn translate_key(key: &str) -> Vec<u8> {
    match key {
        // Special key names (BR-12)
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
        "PageUp" | "PgUp" => vec![0x1b, b'[', b'5', b'~'],
        "PageDown" | "PgDn" => vec![0x1b, b'[', b'6', b'~'],
        // Ctrl+key shortcuts (C-a through C-z)
        s if s.starts_with("C-") && s.len() == 3 => {
            let ch = s.as_bytes()[2];
            match ch {
                b'a'..=b'z' => vec![ch - b'a' + 1],
                b'A'..=b'Z' => vec![ch - b'A' + 1],
                b'@' => vec![0],
                b'[' => vec![0x1b],
                b'\\' => vec![0x1c],
                b']' => vec![0x1d],
                b'^' => vec![0x1e],
                b'_' => vec![0x1f],
                _ => key.as_bytes().to_vec(),
            }
        }
        // BR-11: Literal strings as-is
        _ => key.as_bytes().to_vec(),
    }
}
