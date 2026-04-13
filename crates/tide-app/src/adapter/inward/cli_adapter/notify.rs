// Agent lifecycle notification client:
// `tide notify <event> --pane <id> [--agent <name>] [payload-json]`
//
// Lightweight fire-and-forget process called by agent wrapper hooks.
// Connects to the Agent Gateway socket, sends a single JSON-RPC "notify"
// command, and exits immediately. Designed for minimal latency since
// hooks run synchronously within the agent's lifecycle.

use std::io::Write;
use std::os::unix::net::UnixStream;

/// Run the notify client with the given arguments.
/// Returns the process exit code (always 0 — never fails loudly to avoid
/// disrupting the agent process).
pub fn run_notify(args: &[String]) -> i32 {
    let parsed = match parse_args(args) {
        Some(p) => p,
        None => {
            eprintln!("Usage: tide notify <event> --pane <id> [--agent <name>] [payload-json]");
            eprintln!("Events: agent-running, agent-idle, agent-needs-input, codex-turn-complete");
            return 0; // silent exit — don't break agent hooks
        }
    };

    let socket_path = match find_socket_path() {
        Some(p) => p,
        None => return 0, // Tide not running — silent exit
    };

    let mut stream = match UnixStream::connect(&socket_path) {
        Ok(s) => s,
        Err(_) => return 0, // connection failed — silent exit
    };

    let mut params = serde_json::json!({
        "event": parsed.event,
        "pane": parsed.pane_id,
    });
    if let Some(agent) = parsed.agent {
        params["agent"] = serde_json::json!(agent);
    }
    if let Some(payload) = parsed.payload {
        params["payload"] = payload;
    }

    // Inject _caller_pane from TIDE_PANE env var so the gateway can route
    // the command to the correct Workspace (see cli-workspace-routing spec UC-5).
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

    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "notify",
        "params": params,
    });

    // Fire-and-forget: send the request and exit without waiting for response.
    let _ = writeln!(
        stream,
        "{}",
        serde_json::to_string(&request).unwrap_or_default()
    );
    0
}

struct ParsedArgs {
    event: String,
    pane_id: u64,
    agent: Option<String>,
    payload: Option<serde_json::Value>,
}

/// Parse `<event> --pane <id> [--agent <name>] [payload-json]` from args.
fn parse_args(args: &[String]) -> Option<ParsedArgs> {
    if args.is_empty() {
        return None;
    }

    let event = args[0].clone();
    let mut pane_id = None;
    let mut agent = None;
    let mut payload = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--pane" => {
                pane_id = args.get(i + 1).and_then(|s| s.parse::<u64>().ok());
                i += 2;
            }
            "--agent" => {
                agent = args.get(i + 1).cloned();
                i += 2;
            }
            _ => {
                if payload.is_none() {
                    payload = serde_json::from_str(&args[i]).ok();
                }
                i += 1;
            }
        }
    }

    Some(ParsedArgs {
        event,
        pane_id: pane_id?,
        agent,
        payload,
    })
}

/// Find the socket path to connect to.
/// Priority: $TIDE_SOCKET → $TMPDIR/tide-latest.sock
fn find_socket_path() -> Option<String> {
    if let Ok(path) = std::env::var("TIDE_SOCKET") {
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }
    let latest = std::env::temp_dir().join("tide-latest.sock");
    if latest.exists() {
        return Some(latest.to_string_lossy().into_owned());
    }
    None
}
