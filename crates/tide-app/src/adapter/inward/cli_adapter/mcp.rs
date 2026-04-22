// MCP (Model Context Protocol) stdio bridge.
//
// `tide mcp` launches as a child process of an AI tool (Claude Code, Cursor, etc.).
// It speaks MCP JSON-RPC over stdin/stdout and bridges to the Agent Gateway
// Unix socket internally.
//
// Uses a PERSISTENT socket connection so the gateway can track the MCP
// bridge PID for the entire session lifetime (enabling "Connected" status).

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;

/// Persistent connection to the gateway socket.
struct GatewayConnection {
    writer: UnixStream,
    reader: BufReader<UnixStream>,
    next_id: u64,
}

impl GatewayConnection {
    fn connect() -> Result<Self, String> {
        let socket_path = find_socket_path()
            .ok_or_else(|| "cannot find Tide socket. Is Tide running?".to_string())?;
        let stream = UnixStream::connect(&socket_path)
            .map_err(|e| format!("cannot connect to {socket_path}: {e}"))?;
        let writer = stream
            .try_clone()
            .map_err(|e| format!("stream clone failed: {e}"))?;
        let reader = BufReader::new(stream);
        Ok(Self {
            writer,
            reader,
            next_id: 1,
        })
    }

    fn send(
        &mut self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": self.next_id,
            "method": method,
            "params": params,
        });
        self.next_id += 1;

        writeln!(self.writer, "{}", serde_json::to_string(&request).unwrap())
            .map_err(|e| format!("write failed: {e}"))?;

        // Read response line
        let mut line = String::new();
        self.reader
            .read_line(&mut line)
            .map_err(|e| format!("read failed: {e}"))?;

        if line.trim().is_empty() {
            return Err("empty response".to_string());
        }

        let value: serde_json::Value =
            serde_json::from_str(&line).map_err(|e| format!("invalid response: {e}"))?;

        if let Some(error) = value.get("error") {
            return Err(error["message"]
                .as_str()
                .unwrap_or("unknown error")
                .to_string());
        }
        if let Some(result) = value.get("result") {
            return Ok(result.clone());
        }
        Ok(value)
    }
}

/// Run the MCP stdio server. Reads MCP JSON-RPC from stdin, writes to stdout.
pub fn run_mcp() -> i32 {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut stdout = stdout.lock();

    // Connect to gateway socket once at startup (persistent connection).
    // This keeps the PID in the connected set for the entire MCP session.
    let mut gateway: Option<GatewayConnection> = None;

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }

        let request: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                let err = mcp_error(
                    serde_json::Value::Null,
                    -32700,
                    &format!("parse error: {e}"),
                );
                let _ = writeln!(stdout, "{}", serde_json::to_string(&err).unwrap());
                continue;
            }
        };

        let id = request
            .get("id")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let method = request.get("method").and_then(|v| v.as_str()).unwrap_or("");

        let response = match method {
            "initialize" => {
                // Establish persistent gateway connection on MCP init
                if gateway.is_none() {
                    gateway = GatewayConnection::connect().ok();
                }
                mcp_initialize(id.clone())
            }
            "tools/list" => mcp_tools_list(id.clone()),
            "tools/call" => {
                // Lazy connect if not yet connected
                if gateway.is_none() {
                    gateway = GatewayConnection::connect().ok();
                }
                mcp_tools_call(
                    id.clone(),
                    request.get("params").cloned().unwrap_or_default(),
                    &mut gateway,
                )
            }
            "notifications/initialized" => continue,
            _ => mcp_error(id.clone(), -32601, &format!("method not found: {method}")),
        };

        let _ = writeln!(stdout, "{}", serde_json::to_string(&response).unwrap());
    }

    0
}

fn mcp_initialize(id: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "tide", "version": "0.1.0" },
            "instructions": "Tide layout: The Stage holds Terminals. Each Terminal owns a Dock — a workspace for related panes. You are running inside a Terminal. To run a command, send keys to your terminal (omit pane_id). To open a browser or editor, use tide_open_browser / tide_open_editor — they open in your Dock automatically. Do NOT split or open new terminals in the Stage for side tasks."
        }
    })
}

pub(crate) fn mcp_tool_definitions() -> Vec<serde_json::Value> {
    serde_json::json!([
        {
            "name": "tide_list_panes",
            "description": "List all panes in the active workspace with id, kind, rect, and focus status",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "tide_capture_pane",
            "description": "Read text content from a Terminal, Editor, or Browser Pane",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane_id": { "type": "integer", "description": "Target pane ID (omit for self)" },
                    "start": { "type": "integer", "description": "Start line (negative = scrollback)" },
                    "end": { "type": "integer", "description": "End line" }
                }
            }
        },
        {
            "name": "tide_capture_selection",
            "description": "Read the current selection content from a pane",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane_id": { "type": "integer", "description": "Target pane ID (omit for self)" }
                }
            }
        },
        {
            "name": "tide_get_layout",
            "description": "Get the layout tree as recursive JSON",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "tide_send_keys",
            "description": "Send key sequences to a terminal pane",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane_id": { "type": "integer", "description": "Target pane ID (omit for self)" },
                    "keys": { "type": "array", "items": { "type": "string" }, "description": "Key sequences to send" }
                },
                "required": ["keys"]
            }
        },
        {
            "name": "tide_split_vertical",
            "description": "Split the current pane vertically",
            "inputSchema": { "type": "object", "properties": { "pane_id": { "type": "integer" } } }
        },
        {
            "name": "tide_split_horizontal",
            "description": "Split the current pane horizontally",
            "inputSchema": { "type": "object", "properties": { "pane_id": { "type": "integer" } } }
        },
        {
            "name": "tide_close_pane",
            "description": "Close a pane",
            "inputSchema": { "type": "object", "properties": { "pane_id": { "type": "integer" } } }
        },
        {
            "name": "tide_focus_pane",
            "description": "Focus a specific pane",
            "inputSchema": { "type": "object", "properties": { "pane_id": { "type": "integer" } }, "required": ["pane_id"] }
        },
        {
            "name": "tide_resize_pane",
            "description": "Resize a pane's split ratio",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane_id": { "type": "integer" },
                    "ratio": { "type": "number", "description": "New split ratio (0.0 - 1.0)" }
                },
                "required": ["ratio"]
            }
        },
        {
            "name": "tide_open_terminal",
            "description": "Open a new terminal pane",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "cwd": { "type": "string" },
                    "position": { "type": "string", "enum": ["split-right", "split-below", "tab"] }
                }
            }
        },
        {
            "name": "tide_open_editor",
            "description": "Open a file in an editor pane",
            "inputSchema": { "type": "object", "properties": { "file": { "type": "string" } }, "required": ["file"] }
        },
        {
            "name": "tide_open_browser",
            "description": "Open a URL in a Browser Pane",
            "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } } }
        },
        {
            "name": "tide_browser_eval",
            "description": "Evaluate JavaScript in a targeted Browser Pane and refresh BrowserSnapshot",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane_id": { "type": "integer", "description": "Target pane ID (omit for self)" },
                    "script": { "type": "string", "description": "JavaScript source to evaluate inside the Browser Pane" }
                },
                "required": ["script"]
            }
        },
        {
            "name": "tide_create_context_artifact",
            "description": "Create a workspace-local ContextArtifact from a selected pane",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane_id": { "type": "integer" },
                    "comment": { "type": "string" },
                    "pin": { "type": "boolean" },
                    "pinned": { "type": "boolean" }
                },
                "required": ["pane_id"]
            }
        },
        {
            "name": "tide_list_context_artifacts",
            "description": "List ContextArtifacts in the active Workspace",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "tide_read_context_artifact",
            "description": "Read a ContextArtifact in the active Workspace",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "artifact_id": { "type": "integer" }
                },
                "required": ["artifact_id"]
            }
        },
        {
            "name": "tide_pin_context_artifact",
            "description": "Pin or unpin a ContextArtifact in the active Workspace",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "artifact_id": { "type": "integer" },
                    "pin": { "type": "boolean" },
                    "pinned": { "type": "boolean" }
                },
                "required": ["artifact_id"]
            }
        },
        {
            "name": "tide_remove_context_artifact",
            "description": "Remove a ContextArtifact from the active Workspace",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "artifact_id": { "type": "integer" }
                },
                "required": ["artifact_id"]
            }
        },
        {
            "name": "tide_send_context_artifact",
            "description": "Deliver a ContextArtifact to the paired agent",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "artifact_id": { "type": "integer" }
                },
                "required": ["artifact_id"]
            }
        },
        {
            "name": "tide_render_html",
            "description": "Render an HTML fragment in a Browser Pane (generative UI). Pass #root content only; Tide injects the document shell, theme vars, and bridge runtime.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "html": { "type": "string", "description": "HTML fragment for #root. Do not include <!doctype>, <html>, <head>, or <body>." },
                    "pane_id": { "type": "integer", "description": "Existing pane to update (omit for new)" }
                },
                "required": ["title", "html"]
            }
        }
    ])
    .as_array()
    .expect("mcp tool definitions should be an array")
    .clone()
}

fn mcp_tools_list(id: serde_json::Value) -> serde_json::Value {
    let tools = serde_json::Value::Array(mcp_tool_definitions());

    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": { "tools": tools }
    })
}

fn mcp_tools_call(
    id: serde_json::Value,
    params: serde_json::Value,
    gateway: &mut Option<GatewayConnection>,
) -> serde_json::Value {
    let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let mut arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or(serde_json::json!({}));

    // Inject caller identity so the gateway can route to the correct
    // Tide Window first, then the App can route to the correct Workspace.
    if let Ok(window_str) = std::env::var("TIDE_WINDOW") {
        if let Ok(tide_window_id) = window_str.parse::<u64>() {
            if let Some(obj) = arguments.as_object_mut() {
                obj.insert(
                    "_caller_window".to_string(),
                    serde_json::Value::Number(tide_window_id.into()),
                );
            }
        }
    }
    if let Ok(pane_str) = std::env::var("TIDE_PANE") {
        if let Ok(pane_id) = pane_str.parse::<u64>() {
            if let Some(obj) = arguments.as_object_mut() {
                obj.insert(
                    "_caller_pane".to_string(),
                    serde_json::Value::Number(pane_id.into()),
                );
            }
        }
    }

    let method = match tool_name {
        "tide_list_panes" => "list-panes",
        "tide_capture_pane" => "capture-pane",
        "tide_capture_selection" => "capture-selection",
        "tide_get_layout" => "get-layout",
        "tide_send_keys" => "send-keys",
        "tide_split_vertical" => "split-vertical",
        "tide_split_horizontal" => "split-horizontal",
        "tide_close_pane" => "close-pane",
        "tide_focus_pane" => "focus-pane",
        "tide_resize_pane" => "resize-pane",
        "tide_open_terminal" => "open-terminal",
        "tide_open_editor" => "open-editor",
        "tide_open_browser" => "open-browser",
        "tide_browser_eval" => "browser-eval",
        "tide_create_context_artifact" => "create-context-artifact",
        "tide_list_context_artifacts" => "list-context-artifacts",
        "tide_read_context_artifact" => "read-context-artifact",
        "tide_pin_context_artifact" => "pin-context-artifact",
        "tide_remove_context_artifact" => "remove-context-artifact",
        "tide_send_context_artifact" => "send-context-artifact",
        "tide_render_html" => "render-html",
        _ => {
            return mcp_error(id, -32602, &format!("unknown tool: {tool_name}"));
        }
    };

    let gw = match gateway.as_mut() {
        Some(gw) => gw,
        None => {
            // Try to reconnect
            match GatewayConnection::connect() {
                Ok(conn) => {
                    *gateway = Some(conn);
                    gateway.as_mut().unwrap()
                }
                Err(e) => {
                    return mcp_error_result(id, &format!("gateway not connected: {e}"));
                }
            }
        }
    };

    match gw.send(method, arguments) {
        Ok(result) => {
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "content": [{ "type": "text", "text": serde_json::to_string_pretty(&result).unwrap_or_default() }]
                }
            })
        }
        Err(e) => {
            // Connection may have broken — clear it so next call reconnects
            *gateway = None;
            mcp_error_result(id, &e)
        }
    }
}

fn mcp_error_result(id: serde_json::Value, message: &str) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": format!("error: {message}") }],
            "isError": true
        }
    })
}

fn find_socket_path() -> Option<String> {
    if let Ok(path) = std::env::var("TIDE_SOCKET") {
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }
    let tmpdir = std::env::temp_dir();
    let latest = tmpdir.join("tide-latest.sock");
    if latest.exists() {
        return Some(latest.to_string_lossy().into_owned());
    }
    None
}

fn mcp_error(id: serde_json::Value, code: i32, message: &str) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    })
}
