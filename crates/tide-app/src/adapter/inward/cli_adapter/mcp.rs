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
            "instructions": mcp_instructions()
        }
    })
}

fn mcp_instructions() -> &'static str {
    concat!(
        "Tide MCP Runtime: Codex, Claude, Gemini, and other Wrapped Agents use the same provider-neutral contract. ",
        "You are running inside Tide, a terminal-centered task Workspace. ",
        "Tide structure: Stage is the primary live Terminal area. ",
        "Terminal Context Surface is the right-side support surface owned by the active Stage Terminal for related Panes. ",
        "FileTree View is a separate filesystem view, not a Pane. ",
        "Workspace rail is task navigation. ",
        "Pane kinds are Terminal, Editor, Diff, Browser, and Launcher. ",
        "Tide MCP tools can observe surfaces and Pane geometry, open Editor and Browser Panes, adjust Layout Targets, send keys to the Terminal, capture Pane content or selections, and manage Context Artifacts. ",
        "Tool descriptions define the exact intent, placement, and limits for each action. ",
        "First call tide_observe_workspace with detail=compact when you need current Caller Pane orientation, Terminal Context Surface owner, Pane membership, or Browser Pane targets; use detail=full when you need complete geometry or Browser Pane visual-fit guidance. ",
        "Tide layout: the Stage holds Terminals; each active Stage Terminal owns a Terminal Context Surface for related Panes. ",
        "Use tide_layout_action for Layout Target mutations such as Terminal Context Surface width or pane_split ratio; explicit Terminal Context Surface targets use owner_terminal_id and do not depend on starting UI focus; tide_resize_pane is legacy Stage split compatibility. ",
        "Tool Selection Guidance: if a Browser Pane observation has visual_fit.tool_selection.next_tool=tide_layout_action, select that recommended Tide tool next, then re-observe with tide_observe_workspace or tide_browser_observe before Browser Pane content actions. ",
        "When visual_fit reports background_runtime_available, continue with Tide Browser Pane Runtime tools for that Browser Pane and preserve human-visible focus. ",
        "Browser Runtime Router: For supported browser work inside Tide, you must use Tide Browser Pane Runtime as the first runtime. It is the shared Tide-owned browser runtime for local preview, file-backed preview, unauthenticated public page review, visual verification, and page comments; it is visible when its Terminal Context Surface is active and background-capable when focus is elsewhere. ",
        "For user-requested browser work, treat the task as a Browser Operation: tide_open_browser, tide_browser_observe, and tide_browser_action start operation state for authorized Wrapped Agents; use human-like Browser Pane observe/action work, then call tide_browser_operation action=finish after the final observe. ",
        "Use tide_open_browser, then tide_browser_observe, then tide_browser_action for navigate/move/click/type/press/clear-cursor; prefer Browser Page Map target_ref from tide_browser_observe over guessed coordinates when click/type targets are listed. Browser Automation Cursor motion is distance-scaled and click/type target dispatch waits for that motion to settle. Use tide_browser_observe detail=compact for routine action loops, and detail=full only when full BrowserSnapshot body text is needed. ",
        "Use tide_browser_read_snapshot, tide_browser_find_in_snapshot, and tide_browser_diff_since only for bounded cached BrowserSnapshot text; they do not refresh the live page. ",
        "Observe before the first content action; after navigate/click/type/press, observe when you need changed page content, but you may chain another click/type through a current enabled Browser Page Map target_ref. ",
        "Use tide_capture_selection and Context Artifact tools (tide_create_context_artifact, tide_list_context_artifacts, tide_read_context_artifact, tide_send_context_artifact) for Browser Pane comments and explicit paired-agent delivery. ",
        "No ambient Browser Pane prompt injection: list/read Context Artifacts explicitly. ",
        "For page interaction, use tide_browser_action. Use tide_browser_eval for narrow read-only page inspection with a reason when structured tools lack the needed read data. ",
        "Browser Automation Cursor is a visible marker only, not element identity, pointer ownership, or human consent; label fields are structured metadata and are not rendered beside the cursor. ",
        "To run a command, send keys to your Terminal by omitting pane_id. ",
        "Do NOT split or open new Terminals in the Stage for side tasks."
    )
}

#[cfg(test)]
pub(crate) fn mcp_initialize_for_test() -> serde_json::Value {
    mcp_initialize(serde_json::Value::Null)
}

pub(crate) fn mcp_tool_definitions() -> Vec<serde_json::Value> {
    serde_json::json!([
        {
            "name": "tide_list_panes",
            "description": "List panes with id, kind, rect, and focus status. Wrapped Agent calls are scoped to the Caller Pane Terminal boundary.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "tide_observe_workspace",
            "description": "Provider-neutral Tide MCP Runtime preflight. Use detail=compact for mechanical orientation and current Browser Pane targets. Use detail=full for Stage, Terminal Context Surface, visible Pane geometry, focus, Browser Pane visual fit, Tool Selection Guidance, and Browser Runtime Router policy. If visual_fit.tool_selection recommends tide_layout_action, choose that layout tool next and then re-observe.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "detail": { "type": "string", "enum": ["compact", "full"], "description": "compact reports Caller Pane orientation and Browser Pane targets; full includes complete geometry and visual-fit guidance" }
                }
            }
        },
        {
            "name": "tide_capture_pane",
            "description": "Read text content from a Terminal, Editor, or Browser Pane",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane_id": { "type": "integer", "description": "Target pane ID; omitted target resolves to Caller Pane before UI focus" },
                    "start": { "type": "integer", "description": "Start line (negative = scrollback)" },
                    "end": { "type": "integer", "description": "End line" }
                }
            }
        },
        {
            "name": "tide_capture_selection",
            "description": "Read the current explicit selection content from a Pane. Browser Pane supports URL selection, page bridge selection, and render HTML fallback; element/region capture is unsupported V1 work.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane_id": { "type": "integer", "description": "Target pane ID; omitted target resolves to Caller Pane before UI focus" },
                    "selection_kind": { "type": "string", "enum": ["text", "region", "element"], "description": "Use text for V1. Browser region/element capture is reported as unsupported until the future data model exists." }
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
                    "pane_id": { "type": "integer", "description": "Target pane ID; omitted target resolves to Caller Pane before UI focus" },
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
            "name": "tide_resize_pane",
            "description": "Legacy compatibility: resize a Stage pane's split ratio. Prefer tide_layout_action for product-level Layout Target mutations.",
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
            "name": "tide_layout_action",
            "description": "Mutate a product-level Layout Target. This is the normal next tool when Browser Pane visual_fit.tool_selection recommends layout correction. Use action=resize with target.kind=terminal_context_surface and width_px, or target.kind=pane_split with pane_id and ratio.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["resize"] },
                    "target": {
                        "type": "object",
                        "properties": {
                            "kind": { "type": "string", "enum": ["terminal_context_surface", "pane_split"] },
                            "owner_terminal_id": { "type": "integer", "description": "Terminal Pane whose Terminal Context Surface should be targeted" },
                            "pane_id": { "type": "integer", "description": "Pane to resize for pane_split targets" },
                            "width_px": { "type": "number", "description": "Requested width for terminal_context_surface targets" },
                            "ratio": { "type": "number", "description": "Requested split ratio for pane_split targets" }
                        },
                        "required": ["kind"]
                    },
                    "width_px": { "type": "number", "description": "Requested width for terminal_context_surface targets" },
                    "ratio": { "type": "number", "description": "Requested split ratio for pane_split targets" }
                },
                "required": ["action", "target"]
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
            "description": "Open an existing file path in a Tide Editor Pane. By default it attaches to the caller Terminal's Terminal Context Surface. To attach to a specific Terminal Pane, pass target={kind:\"terminal_context_surface\", owner_terminal_id}. If the owner Terminal is not the human-focused Stage Terminal, Tide opens the Editor Pane in that Terminal Context Surface in the background without moving visible focus.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "file": { "type": "string" },
                    "target": {
                        "type": "object",
                        "properties": {
                            "kind": { "type": "string", "enum": ["terminal_context_surface"] },
                            "owner_terminal_id": { "type": "integer", "description": "Terminal Pane whose Terminal Context Surface should own the Editor Pane" }
                        },
                        "required": ["kind", "owner_terminal_id"]
                    },
                    "owner_terminal_id": { "type": "integer", "description": "Compatibility shorthand for target.owner_terminal_id" }
                },
                "required": ["file"]
            }
        },
        {
            "name": "tide_open_browser",
            "description": "Open a URL or empty browser in a Tide Browser Pane attached to the caller Terminal's Terminal Context Surface when possible, without depending on starting UI focus and without moving Terminal text focus for Wrapped Agents. Use this for links, pages, previews, and web inspection inside Tide. Use an external/default browser only when the user explicitly asks for that handoff or Tide cannot represent the target. For authorized Wrapped Agents this starts Browser Operation state immediately; do not synthesize credential-bearing or app-internal launch URLs unless the user explicitly asks for that internal route.",
            "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } } }
        },
        {
            "name": "tide_browser_eval",
            "description": "escape hatch: evaluate narrow read-only JavaScript in a targeted Tide Browser Pane and refresh BrowserSnapshot. Cannot click/type/submit/dispatchEvent or mutate page DOM. Do not use eval to compensate for poor Browser Pane visual fit; follow visual_fit.tool_selection and prefer tide_layout_action, tide_browser_observe, and tide_browser_action.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane_id": { "type": "integer", "description": "Target Browser Pane ID; pass explicitly when Caller Pane is a Terminal" },
                    "script": { "type": "string", "description": "JavaScript source to evaluate inside the Browser Pane" },
                    "reason": { "type": "string", "description": "Why structured Browser Pane tools are insufficient" },
                    "sensitive": { "type": "boolean", "description": "Set true for data-transmitting or sensitive flows" },
                    "approved": { "type": "boolean", "description": "Required when sensitive is true" }
                },
                "required": ["script"]
            }
        },
        {
            "name": "tide_browser_observe",
            "description": "Read structured Tide Browser Pane state before acting, including BrowserSnapshot, Browser Page Map regions/interactables with target refs, selection, Browser Automation Cursor, visual fit, Tool Selection Guidance, and runtime identity. Use detail=compact for routine click/type loops; use detail=full when full BrowserSnapshot body text is needed.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane_id": { "type": "integer", "description": "Target Browser Pane ID; pass explicitly when Caller Pane is a Terminal" },
                    "detail": { "type": "string", "enum": ["compact", "full"], "description": "compact returns Browser Observation Summary with target refs and short excerpts; full returns the full cached BrowserSnapshot text and full Browser Page Map metadata" }
                }
            }
        },
        {
            "name": "tide_browser_operation",
            "description": "Explicitly start or finish a Browser Operation around user-requested human-like Tide Browser Pane work. tide_open_browser, tide_browser_observe, and tide_browser_action also start operation state for authorized Wrapped Agents; finish clears the operation visuals after final observe.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane_id": { "type": "integer", "description": "Target Browser Pane ID; pass explicitly when Caller Pane is a Terminal" },
                    "action": { "type": "string", "enum": ["start", "finish"] },
                    "x": { "type": "number", "description": "Optional initial Browser Automation Cursor x coordinate for start" },
                    "y": { "type": "number", "description": "Optional initial Browser Automation Cursor y coordinate for start" },
                    "label": { "type": "string", "description": "Optional Browser Automation Cursor label metadata for start; label text is not rendered beside the cursor" }
                },
                "required": ["action"]
            }
        },
        {
            "name": "tide_browser_read_snapshot",
            "description": "Read the bounded cached BrowserSnapshot for a Browser Pane without refreshing the live page. Requires Caller Pane and Associated Terminal authorization.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane_id": { "type": "integer", "description": "Target Browser Pane ID" }
                },
                "required": ["pane_id"]
            }
        },
        {
            "name": "tide_browser_find_in_snapshot",
            "description": "Search the cached BrowserSnapshot by literal query without refreshing the live page. Returns bounded matches and truncation metadata.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane_id": { "type": "integer", "description": "Target Browser Pane ID" },
                    "query": { "type": "string", "description": "Literal query to search for in cached BrowserSnapshot text" }
                },
                "required": ["pane_id", "query"]
            }
        },
        {
            "name": "tide_browser_diff_since",
            "description": "Diff the current cached BrowserSnapshot against a retained same-Pane Generation anchor without refreshing the live page.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane_id": { "type": "integer", "description": "Target Browser Pane ID" },
                    "anchor": {
                        "type": "object",
                        "properties": {
                            "pane_id": { "type": "integer" },
                            "generation": { "type": "integer" }
                        },
                        "required": ["pane_id", "generation"]
                    },
                    "since_generation": { "type": "integer", "description": "Compatibility shorthand for anchor.generation when the anchor PaneId is the target PaneId" }
                },
                "required": ["pane_id"]
            }
        },
        {
            "name": "tide_browser_action",
            "description": "preferred structured action path for Tide Browser Pane. Uses the existing Browser Pane runtime, requires an initial observe for content actions, accepts target_ref from tide_browser_observe page_map for click/type, may chain current enabled target_ref actions after live input, moves Browser Automation Cursor with distance-scaled motion for move/click/targeted type without rendering label text, and dispatches click/type target actions after the cursor motion settles.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane_id": { "type": "integer", "description": "Target Browser Pane ID; pass explicitly when Caller Pane is a Terminal" },
                    "action": { "type": "string", "enum": ["navigate", "move", "click", "type", "press", "clear-cursor"] },
                    "url": { "type": "string", "description": "Required for navigate" },
                    "x": { "type": "number", "description": "Viewport x coordinate for move or click" },
                    "y": { "type": "number", "description": "Viewport y coordinate for move or click" },
                    "target_ref": { "type": "string", "description": "Generation-scoped Browser Page Element ref from tide_browser_observe page_map for click/type targeting" },
                    "label": { "type": "string", "description": "Optional Browser Automation Cursor label metadata for move or click; label text is not rendered beside the cursor" },
                    "text": { "type": "string", "description": "Required for type" },
                    "key": { "type": "string", "description": "Required for press" },
                    "reload": { "type": "boolean", "description": "Required to intentionally navigate to the already-loaded URL" },
                    "sensitive": { "type": "boolean", "description": "Set true for data-transmitting or sensitive flows" },
                    "approved": { "type": "boolean", "description": "Required when sensitive is true" }
                },
                "required": ["action"]
            }
        },
        {
            "name": "tide_create_context_artifact",
            "description": "Create a Workspace-local Context Artifact from an explicit Pane selection/comment. No ambient Browser Pane prompt injection.",
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
            "description": "Explicitly list Context Artifacts in the active Workspace for the caller's Associated Terminal",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "tide_read_context_artifact",
            "description": "Explicitly read a Context Artifact in the active Workspace for the caller's Associated Terminal",
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
            "description": "Deliver a Context Artifact only to the paired agent for its Associated Terminal",
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
        "tide_observe_workspace" => "observe-workspace",
        "tide_capture_pane" => "capture-pane",
        "tide_capture_selection" => "capture-selection",
        "tide_get_layout" => "get-layout",
        "tide_send_keys" => "send-keys",
        "tide_split_vertical" => "split-vertical",
        "tide_split_horizontal" => "split-horizontal",
        "tide_close_pane" => "close-pane",
        "tide_resize_pane" => "resize-pane",
        "tide_layout_action" => "layout-action",
        "tide_open_terminal" => "open-terminal",
        "tide_open_editor" => "open-editor",
        "tide_open_browser" => "open-browser",
        "tide_browser_eval" => "browser-eval",
        "tide_browser_observe" => "browser-observe",
        "tide_browser_operation" => "browser-operation",
        "tide_browser_read_snapshot" => "browser-read-snapshot",
        "tide_browser_find_in_snapshot" => "browser-find-in-snapshot",
        "tide_browser_diff_since" => "browser-diff-since",
        "tide_browser_action" => "browser-action",
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
