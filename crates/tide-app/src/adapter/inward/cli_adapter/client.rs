// CLI client: `tide cli <command>` subcommand.
// Connects to the Agent Gateway Unix socket, sends a JSON-RPC request,
// and prints the result.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;

/// Run the CLI client with the given arguments.
/// Returns the process exit code.
pub fn run_cli(args: &[String]) -> i32 {
    if args.is_empty() {
        print_usage();
        return 1;
    }

    let command = &args[0];
    match command.as_str() {
        // Phase 1 — Observe
        "list-panes" => send_command("list-panes", serde_json::json!({})),
        "capture-pane" => {
            let params = parse_capture_pane_args(&args[1..]);
            send_command("capture-pane", params)
        }
        "capture-selection" => {
            let params = parse_pane_target_args(&args[1..]);
            send_command("capture-selection", params)
        }
        "get-layout" => send_command("get-layout", serde_json::json!({})),
        // Phase 2 — Act
        "browser-eval" => {
            let params = parse_browser_eval_args(&args[1..]);
            send_command("browser-eval", params)
        }
        "send-keys" => {
            let params = parse_send_keys_args(&args[1..]);
            send_command("send-keys", params)
        }
        "split-vertical" => {
            let params = parse_pane_target_args(&args[1..]);
            send_command("split-vertical", params)
        }
        "split-horizontal" => {
            let params = parse_pane_target_args(&args[1..]);
            send_command("split-horizontal", params)
        }
        "close-pane" => {
            let params = parse_pane_target_args(&args[1..]);
            send_command("close-pane", params)
        }
        "focus-pane" => {
            let params = parse_pane_target_args(&args[1..]);
            send_command("focus-pane", params)
        }
        "resize-pane" => {
            let params = parse_resize_pane_args(&args[1..]);
            send_command("resize-pane", params)
        }
        "open-terminal" => {
            let params = parse_open_terminal_args(&args[1..]);
            send_command("open-terminal", params)
        }
        "open-editor" => {
            let params = parse_open_editor_args(&args[1..]);
            send_command("open-editor", params)
        }
        "open-browser" => {
            let params = parse_open_browser_args(&args[1..]);
            send_command("open-browser", params)
        }
        "create-context-artifact" => {
            let params = parse_create_context_artifact_args(&args[1..]);
            send_command("create-context-artifact", params)
        }
        "list-context-artifacts" => send_command("list-context-artifacts", serde_json::json!({})),
        "read-context-artifact" => {
            let params = parse_context_artifact_id_args(&args[1..]);
            send_command("read-context-artifact", params)
        }
        "pin-context-artifact" => {
            let params = parse_pin_context_artifact_args(&args[1..]);
            send_command("pin-context-artifact", params)
        }
        "remove-context-artifact" => {
            let params = parse_context_artifact_id_args(&args[1..]);
            send_command("remove-context-artifact", params)
        }
        "send-context-artifact" => {
            let params = parse_context_artifact_id_args(&args[1..]);
            send_command("send-context-artifact", params)
        }
        // Phase 3 — Show (Generative UI)
        "render-html" => {
            let params = parse_render_html_args(&args[1..]);
            send_command("render-html", params)
        }
        "render-stream" => {
            let params = parse_render_stream_args(&args[1..]);
            run_render_stream(params)
        }
        // Phase 4 — Discover + React
        "subscribe" => {
            let params = parse_subscribe_args(&args[1..]);
            run_subscribe(params)
        }
        "help" | "--help" | "-h" => {
            print_usage();
            0
        }
        _ => {
            eprintln!("unknown command: {command}");
            print_usage();
            1
        }
    }
}

fn usage_text() -> String {
    [
        "Usage: tide cli <command> [options]",
        "",
        "Commands:",
        "  list-panes                       List all panes in the active workspace",
        "  capture-pane [-t <id>] [--start <line>] [--end <line>]",
        "                                   Read text content from a Terminal, Editor, or Browser Pane",
        "  get-layout                       Get the layout tree as JSON",
        "  browser-eval [-t <id>] --script <js>",
        "                                   Evaluate JavaScript in a Browser Pane and refresh BrowserSnapshot",
        "  send-keys [-t <id>] <keys...>    Send key sequences to a terminal pane",
        "  split-vertical [-t <id>]         Split pane vertically",
        "  split-horizontal [-t <id>]       Split pane horizontally",
        "  close-pane [-t <id>]             Close a pane",
        "  focus-pane -t <id>               Focus a specific pane",
        "  resize-pane [-t <id>] --ratio <float>",
        "                                   Resize a pane's split ratio",
        "  open-terminal [--cwd <path>] [--position <pos>]",
        "                                   Open a new terminal pane",
        "  open-editor <file>               Open a file in an editor pane",
        "  open-browser [<url>]             Open a Browser Pane",
        "  capture-selection [-t <id>]      Read the current selection from a pane",
        "  create-context-artifact [-t <id>] [--comment <text>] [--pin]",
        "                                   Create a Context Artifact from the current selection",
        "  list-context-artifacts           List Context Artifacts in the active Workspace",
        "  read-context-artifact <id>       Read a Context Artifact",
        "  pin-context-artifact <id> [--pin|--unpin]",
        "                                   Pin or unpin a Context Artifact",
        "  remove-context-artifact <id>     Remove a Context Artifact",
        "  send-context-artifact <id>       Deliver a Context Artifact to the paired agent",
        "  render-html --title <t> [--pane <id>]",
        "                                   Render an HTML #root fragment from stdin in a Browser Pane",
        "  render-stream --title <t>",
        "                                   Open a streaming Browser Pane; each stdin line is a #root fragment snapshot",
        "  subscribe [--events <types>]      Subscribe to event notifications",
    ]
    .join("\n")
}

fn print_usage() {
    eprintln!("{}", usage_text());
}

fn parse_capture_pane_args(args: &[String]) -> serde_json::Value {
    let mut params = serde_json::Map::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-t" => {
                if let Some(id_str) = args.get(i + 1) {
                    if let Ok(id) = id_str.parse::<u64>() {
                        params.insert("pane_id".into(), serde_json::json!(id));
                    }
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--start" => {
                if let Some(val) = args.get(i + 1) {
                    if let Ok(n) = val.parse::<i64>() {
                        params.insert("start".into(), serde_json::json!(n));
                    }
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--end" => {
                if let Some(val) = args.get(i + 1) {
                    if let Ok(n) = val.parse::<i64>() {
                        params.insert("end".into(), serde_json::json!(n));
                    }
                    i += 2;
                } else {
                    i += 1;
                }
            }
            _ => {
                i += 1;
            }
        }
    }
    serde_json::Value::Object(params)
}

/// Parse send-keys args: [-t <id>] <keys...>
/// Remaining positional args become the keys array.
fn parse_send_keys_args(args: &[String]) -> serde_json::Value {
    let mut params = serde_json::Map::new();
    let mut keys = Vec::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-t" => {
                if let Some(id_str) = args.get(i + 1) {
                    if let Ok(id) = id_str.parse::<u64>() {
                        params.insert("pane_id".into(), serde_json::json!(id));
                    }
                    i += 2;
                } else {
                    i += 1;
                }
            }
            _ => {
                keys.push(serde_json::Value::String(args[i].clone()));
                i += 1;
            }
        }
    }
    params.insert("keys".into(), serde_json::Value::Array(keys));
    serde_json::Value::Object(params)
}

/// Parse args with just -t <id> for pane targeting.
fn parse_pane_target_args(args: &[String]) -> serde_json::Value {
    let mut params = serde_json::Map::new();
    let mut i = 0;
    while i < args.len() {
        if args[i] == "-t" {
            if let Some(id_str) = args.get(i + 1) {
                if let Ok(id) = id_str.parse::<u64>() {
                    params.insert("pane_id".into(), serde_json::json!(id));
                }
                i += 2;
            } else {
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    serde_json::Value::Object(params)
}

/// Parse resize-pane args: [-t <id>] --ratio <float>
fn parse_resize_pane_args(args: &[String]) -> serde_json::Value {
    let mut params = serde_json::Map::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-t" => {
                if let Some(id_str) = args.get(i + 1) {
                    if let Ok(id) = id_str.parse::<u64>() {
                        params.insert("pane_id".into(), serde_json::json!(id));
                    }
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--ratio" => {
                if let Some(val) = args.get(i + 1) {
                    if let Ok(r) = val.parse::<f64>() {
                        params.insert("ratio".into(), serde_json::json!(r));
                    }
                    i += 2;
                } else {
                    i += 1;
                }
            }
            _ => {
                i += 1;
            }
        }
    }
    serde_json::Value::Object(params)
}

/// Parse open-terminal args: [--cwd <path>] [--position <pos>]
fn parse_open_terminal_args(args: &[String]) -> serde_json::Value {
    let mut params = serde_json::Map::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--cwd" => {
                if let Some(val) = args.get(i + 1) {
                    params.insert("cwd".into(), serde_json::json!(val));
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--position" => {
                if let Some(val) = args.get(i + 1) {
                    params.insert("position".into(), serde_json::json!(val));
                    i += 2;
                } else {
                    i += 1;
                }
            }
            _ => {
                i += 1;
            }
        }
    }
    serde_json::Value::Object(params)
}

/// Parse open-editor args: <file>
fn parse_open_editor_args(args: &[String]) -> serde_json::Value {
    let mut params = serde_json::Map::new();
    if let Some(file) = args.first() {
        if !file.starts_with('-') {
            params.insert("file".into(), serde_json::json!(file));
        }
    }
    serde_json::Value::Object(params)
}

/// Parse open-browser args: [<url>]
fn parse_open_browser_args(args: &[String]) -> serde_json::Value {
    let mut params = serde_json::Map::new();
    if let Some(url) = args.first() {
        if !url.starts_with('-') {
            params.insert("url".into(), serde_json::json!(url));
        }
    }
    serde_json::Value::Object(params)
}

/// Parse browser-eval args: [-t <id>] --script <js>
fn parse_browser_eval_args(args: &[String]) -> serde_json::Value {
    let mut params = serde_json::Map::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-t" => {
                if let Some(id_str) = args.get(i + 1) {
                    if let Ok(id) = id_str.parse::<u64>() {
                        params.insert("pane_id".into(), serde_json::json!(id));
                        i += 2;
                    } else {
                        i += 1;
                    }
                } else {
                    i += 1;
                }
            }
            "--script" => {
                if let Some(script) = args.get(i + 1) {
                    params.insert("script".into(), serde_json::json!(script));
                    i += 2;
                } else {
                    i += 1;
                }
            }
            _ => {
                i += 1;
            }
        }
    }
    serde_json::Value::Object(params)
}

fn parse_create_context_artifact_args(args: &[String]) -> serde_json::Value {
    let mut params = serde_json::Map::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-t" => {
                if let Some(id_str) = args.get(i + 1) {
                    if let Ok(id) = id_str.parse::<u64>() {
                        params.insert("pane_id".into(), serde_json::json!(id));
                    }
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--comment" => {
                if let Some(val) = args.get(i + 1) {
                    params.insert("comment".into(), serde_json::json!(val));
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--pin" => {
                params.insert("pin".into(), serde_json::json!(true));
                i += 1;
            }
            _ => {
                i += 1;
            }
        }
    }
    serde_json::Value::Object(params)
}

fn parse_context_artifact_id_args(args: &[String]) -> serde_json::Value {
    let mut params = serde_json::Map::new();
    if let Some(id_str) = args.first() {
        if let Ok(id) = id_str.parse::<u64>() {
            params.insert("artifact_id".into(), serde_json::json!(id));
        }
    }
    serde_json::Value::Object(params)
}

fn parse_pin_context_artifact_args(args: &[String]) -> serde_json::Value {
    let mut params = parse_context_artifact_id_args(args);
    let mut pinned = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--pin" => {
                pinned = Some(true);
                i += 1;
            }
            "--unpin" => {
                pinned = Some(false);
                i += 1;
            }
            "--pinned" => {
                if let Some(val) = args.get(i + 1) {
                    if let Ok(flag) = val.parse::<bool>() {
                        pinned = Some(flag);
                    }
                    i += 2;
                } else {
                    i += 1;
                }
            }
            _ => {
                i += 1;
            }
        }
    }
    if let Some(flag) = pinned {
        if let Some(obj) = params.as_object_mut() {
            obj.insert("pinned".into(), serde_json::json!(flag));
        }
    }
    params
}

/// Parse render-html args: --title <t> [--pane <id>]
/// HTML #root fragment content is read from stdin.
fn parse_render_html_args(args: &[String]) -> serde_json::Value {
    let mut params = serde_json::Map::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--title" => {
                if let Some(val) = args.get(i + 1) {
                    params.insert("title".into(), serde_json::json!(val));
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--pane" => {
                if let Some(val) = args.get(i + 1) {
                    if let Ok(id) = val.parse::<u64>() {
                        params.insert("pane_id".into(), serde_json::json!(id));
                    }
                    i += 2;
                } else {
                    i += 1;
                }
            }
            _ => {
                i += 1;
            }
        }
    }
    // Read HTML from stdin
    use std::io::Read;
    let mut html = String::new();
    let _ = std::io::stdin().read_to_string(&mut html);
    params.insert("html".into(), serde_json::json!(html));
    serde_json::Value::Object(params)
}

/// Parse render-stream args: --title <t>
fn parse_render_stream_args(args: &[String]) -> serde_json::Value {
    let mut params = serde_json::Map::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--title" => {
                if let Some(val) = args.get(i + 1) {
                    params.insert("title".into(), serde_json::json!(val));
                    i += 2;
                } else {
                    i += 1;
                }
            }
            _ => {
                i += 1;
            }
        }
    }
    serde_json::Value::Object(params)
}

/// Parse subscribe args: [--events <comma-separated types>]
fn parse_subscribe_args(args: &[String]) -> serde_json::Value {
    let mut params = serde_json::Map::new();
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--events" {
            if let Some(val) = args.get(i + 1) {
                let events: Vec<serde_json::Value> = val
                    .split(',')
                    .map(|s| serde_json::json!(s.trim()))
                    .collect();
                params.insert("events".into(), serde_json::Value::Array(events));
                i += 2;
            } else {
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    serde_json::Value::Object(params)
}

/// Run a subscribe session: send subscribe command, print notifications until disconnect.
fn run_subscribe(params: serde_json::Value) -> i32 {
    let socket_path = match find_socket_path() {
        Some(p) => p,
        None => {
            eprintln!("error: cannot find Tide socket. Is Tide running?");
            return 1;
        }
    };

    let stream = match UnixStream::connect(&socket_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error: cannot connect to {}: {e}", socket_path);
            return 1;
        }
    };

    let mut writer = match stream.try_clone() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error: stream clone failed: {e}");
            return 1;
        }
    };
    let reader = BufReader::new(stream);

    let params = inject_caller_pane(params);
    let request = serde_json::json!({
        "jsonrpc": "2.0", "id": 1,
        "method": "subscribe", "params": params,
    });
    if let Err(e) = writeln!(writer, "{}", serde_json::to_string(&request).unwrap()) {
        eprintln!("error: write failed: {e}");
        return 1;
    }

    // Read subscription confirmation + subsequent notifications
    for line in reader.lines() {
        match line {
            Ok(line) if !line.trim().is_empty() => {
                println!("{line}");
            }
            Ok(_) => continue,
            Err(_) => break,
        }
    }

    0
}

/// Run a streaming render session: create a Browser Pane, send stdin lines as #root fragments, end on EOF.
fn run_render_stream(params: serde_json::Value) -> i32 {
    let socket_path = match find_socket_path() {
        Some(p) => p,
        None => {
            eprintln!("error: cannot find Tide socket. Is Tide running?");
            return 1;
        }
    };

    let stream = match UnixStream::connect(&socket_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error: cannot connect to {}: {e}", socket_path);
            return 1;
        }
    };

    let mut writer = match stream.try_clone() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error: stream clone failed: {e}");
            return 1;
        }
    };
    let mut reader = BufReader::new(stream);

    // Step 1: Create the streaming render pane
    let params = inject_caller_pane(params);
    let create_req = serde_json::json!({
        "jsonrpc": "2.0", "id": 1,
        "method": "render-stream", "params": params,
    });
    if let Err(e) = writeln!(writer, "{}", serde_json::to_string(&create_req).unwrap()) {
        eprintln!("error: write failed: {e}");
        return 1;
    }

    // Read response to get pane_id
    let mut response_line = String::new();
    if reader.read_line(&mut response_line).is_err() {
        eprintln!("error: no response from Tide");
        return 1;
    }
    let pane_id = match serde_json::from_str::<serde_json::Value>(&response_line) {
        Ok(v) => {
            if let Some(err) = v.get("error") {
                eprintln!("error: {}", err["message"].as_str().unwrap_or("unknown"));
                return 1;
            }
            match v
                .get("result")
                .and_then(|r| r.get("pane_id"))
                .and_then(|id| id.as_u64())
            {
                Some(id) => {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(v.get("result").unwrap()).unwrap()
                    );
                    id
                }
                None => {
                    eprintln!("error: no pane_id in response");
                    return 1;
                }
            }
        }
        Err(e) => {
            eprintln!("error: invalid response: {e}");
            return 1;
        }
    };

    // Step 2: Read stdin line-by-line, send each as stream-chunk
    let stdin = std::io::stdin();
    let mut req_id = 2u64;
    for line in stdin.lock().lines() {
        match line {
            Ok(html) => {
                let chunk_req = serde_json::json!({
                    "jsonrpc": "2.0", "id": req_id,
                    "method": "stream-chunk",
                    "params": {"pane_id": pane_id, "html": html},
                });
                req_id += 1;
                if writeln!(writer, "{}", serde_json::to_string(&chunk_req).unwrap()).is_err() {
                    break;
                }
                // Drain response
                let mut resp = String::new();
                let _ = reader.read_line(&mut resp);
            }
            Err(_) => break,
        }
    }

    // Step 3: Send stream-end
    let end_req = serde_json::json!({
        "jsonrpc": "2.0", "id": req_id,
        "method": "stream-end",
        "params": {"pane_id": pane_id},
    });
    let _ = writeln!(writer, "{}", serde_json::to_string(&end_req).unwrap());
    let mut resp = String::new();
    let _ = reader.read_line(&mut resp);

    0
}

#[cfg(test)]
mod tests {
    use super::{parse_browser_eval_args, usage_text};

    #[test]
    fn cli_usage_mentions_render_html_fragment_contract() {
        let usage = usage_text();
        assert!(usage.contains("render-html --title <t> [--pane <id>]"));
        assert!(usage.contains("HTML #root fragment"));
        assert!(usage.contains("Browser Pane"));
    }

    #[test]
    fn cli_usage_mentions_render_stream_fragment_contract() {
        let usage = usage_text();
        assert!(usage.contains("render-stream --title <t>"));
        assert!(usage.contains("each stdin line is a #root fragment snapshot"));
        assert!(usage.contains("Browser Pane"));
    }

    #[test]
    fn cli_usage_mentions_context_artifact_commands() {
        let usage = usage_text();
        assert!(usage.contains("capture-selection [-t <id>]"));
        assert!(usage.contains("create-context-artifact [-t <id>] [--comment <text>] [--pin]"));
        assert!(usage.contains("list-context-artifacts"));
        assert!(usage.contains("read-context-artifact <id>"));
        assert!(usage.contains("pin-context-artifact <id> [--pin|--unpin]"));
        assert!(usage.contains("remove-context-artifact <id>"));
        assert!(usage.contains("send-context-artifact <id>"));
    }

    #[test]
    fn cli_usage_mentions_browser_eval_command() {
        let usage = usage_text();
        assert!(usage.contains("browser-eval [-t <id>] --script <js>"));
        assert!(usage.contains("JavaScript"));
        assert!(usage.contains("BrowserSnapshot"));
    }

    #[test]
    fn parse_browser_eval_args_invalid_target_keeps_scanning_flags() {
        let args = vec![
            "-t".to_string(),
            "not-a-number".to_string(),
            "--script".to_string(),
            "document.title = 'Updated'".to_string(),
        ];

        let params = parse_browser_eval_args(&args);
        assert!(params.get("pane_id").is_none());
        assert_eq!(
            params.get("script").and_then(|value| value.as_str()),
            Some("document.title = 'Updated'")
        );
    }
}

fn inject_caller_pane(mut params: serde_json::Value) -> serde_json::Value {
    // Inject _caller_pane from TIDE_PANE env var so the gateway can route
    // the command to the correct Workspace (see cli-workspace-routing spec).
    if let Ok(pane_str) = std::env::var("TIDE_PANE") {
        if let Ok(pane_id) = pane_str.parse::<u64>() {
            if let Some(obj) = params.as_object_mut() {
                obj.insert(
                    "_caller_pane".to_string(),
                    serde_json::Value::Number(pane_id.into()),
                );
            }
        }
    }
    params
}

fn send_command(method: &str, params: serde_json::Value) -> i32 {
    let params = inject_caller_pane(params);
    let socket_path = match find_socket_path() {
        Some(p) => p,
        None => {
            eprintln!("error: cannot find Tide socket. Is Tide running?");
            eprintln!("hint: check $TIDE_SOCKET or look for $TMPDIR/tide-*.sock");
            return 1;
        }
    };

    let stream = match UnixStream::connect(&socket_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error: cannot connect to {}: {e}", socket_path);
            return 1;
        }
    };

    let mut writer = match stream.try_clone() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error: stream clone failed: {e}");
            return 1;
        }
    };
    let reader = BufReader::new(stream);

    // Send JSON-RPC request
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    });

    if let Err(e) = writeln!(writer, "{}", serde_json::to_string(&request).unwrap()) {
        eprintln!("error: write failed: {e}");
        return 1;
    }

    // Read response
    for line in reader.lines() {
        match line {
            Ok(line) if !line.trim().is_empty() => {
                // Try to parse as JSON for pretty printing
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let Some(error) = value.get("error") {
                        eprintln!("error: {}", error["message"].as_str().unwrap_or("unknown"));
                        return 1;
                    }
                    if let Some(result) = value.get("result") {
                        println!("{}", serde_json::to_string_pretty(result).unwrap());
                        return 0;
                    }
                }
                // Fallback: print raw
                println!("{line}");
                return 0;
            }
            Ok(_) => continue,
            Err(e) => {
                eprintln!("error: read failed: {e}");
                return 1;
            }
        }
    }

    eprintln!("error: no response from Tide");
    1
}

/// Find the socket path to connect to.
/// Priority: $TIDE_SOCKET → $TMPDIR/tide-latest.sock
fn find_socket_path() -> Option<String> {
    // 1. Check TIDE_SOCKET env var
    if let Ok(path) = std::env::var("TIDE_SOCKET") {
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }

    // 2. Check tide-latest.sock symlink
    let tmpdir = std::env::temp_dir();
    let latest = tmpdir.join("tide-latest.sock");
    if latest.exists() {
        return Some(latest.to_string_lossy().into_owned());
    }

    None
}
