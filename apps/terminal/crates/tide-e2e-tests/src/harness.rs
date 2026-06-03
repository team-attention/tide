// E2E test harness: spawns Tide as a child process and communicates via the
// Agent Gateway Unix socket (JSON-RPC 2.0).

use std::error::Error;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tempfile::TempDir;

/// How long to wait for the Tide socket to appear after launch.
const SOCKET_WAIT_TIMEOUT: Duration = Duration::from_secs(10);
/// Poll interval when waiting for the socket.
const SOCKET_POLL_INTERVAL: Duration = Duration::from_millis(100);

/// A running Tide instance with an isolated environment.
///
/// On drop, the child process is killed and the temporary directory is cleaned up.
pub struct TestApp {
    process: Child,
    socket_path: PathBuf,
    _temp_dir: TempDir,
    request_id: AtomicU64,
}

impl TestApp {
    /// Launch a Tide binary in an isolated temporary environment.
    ///
    /// The binary is located via the `TIDE_TERMINAL_BIN` environment variable. If unset,
    /// it falls back to `target/debug/tide-terminal` relative to the workspace root.
    pub fn launch() -> Result<Self, Box<dyn Error>> {
        let temp_dir = TempDir::new()?;
        let tmpdir_path = temp_dir.path().to_path_buf();

        let bin_path = Self::find_binary()?;

        let config_dir = temp_dir.path().join(".config");
        std::fs::create_dir_all(&config_dir)?;

        let child = Command::new(&bin_path)
            .env("HOME", temp_dir.path())
            .env("TMPDIR", &tmpdir_path)
            // Prevent Tide from reading any user configuration
            .env("XDG_CONFIG_HOME", &config_dir)
            .spawn()
            .map_err(|e| format!("failed to launch Tide at {}: {e}", bin_path.display()))?;

        let pid = child.id();
        let socket_path = tmpdir_path.join(format!("tide-terminal-{pid}.sock"));

        let mut app = TestApp {
            process: child,
            socket_path,
            _temp_dir: temp_dir,
            request_id: AtomicU64::new(1),
        };

        app.wait_for_socket()?;
        Ok(app)
    }

    /// Locate the Tide binary.
    fn find_binary() -> Result<PathBuf, Box<dyn Error>> {
        // 1. Explicit env var
        if let Ok(path) = std::env::var("TIDE_TERMINAL_BIN") {
            let p = PathBuf::from(path);
            if p.exists() {
                return Ok(p);
            }
            return Err(format!("TIDE_TERMINAL_BIN points to non-existent path: {}", p.display()).into());
        }

        // 2. Relative to workspace root: walk up from CARGO_MANIFEST_DIR
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            // CARGO_MANIFEST_DIR = <workspace>/crates/tide-e2e-tests
            let workspace_root = PathBuf::from(manifest_dir)
                .parent() // crates/
                .and_then(|p| p.parent()) // workspace root
                .map(|p| p.to_path_buf());

            if let Some(root) = workspace_root {
                let debug_path = root.join("target/debug/tide-terminal");
                if debug_path.exists() {
                    return Ok(debug_path);
                }
            }
        }

        Err("Cannot find Tide binary. Set TIDE_TERMINAL_BIN or run `cargo build -p tide-app` first.".into())
    }

    /// Poll until the socket file appears on disk.
    fn wait_for_socket(&mut self) -> Result<(), Box<dyn Error>> {
        let deadline = Instant::now() + SOCKET_WAIT_TIMEOUT;

        while Instant::now() < deadline {
            // Check if the process died
            if let Some(status) = self.process.try_wait()? {
                return Err(format!("Tide exited early with status: {status}").into());
            }

            if self.socket_path.exists() {
                // Try connecting to verify the socket is ready
                if UnixStream::connect(&self.socket_path).is_ok() {
                    return Ok(());
                }
            }

            std::thread::sleep(SOCKET_POLL_INTERVAL);
        }

        Err(format!(
            "Socket did not appear within {}s at {}",
            SOCKET_WAIT_TIMEOUT.as_secs(),
            self.socket_path.display()
        )
        .into())
    }

    // ── Low-level RPC ───────────────────────────────────────────────

    /// Send a JSON-RPC 2.0 request and return the result.
    ///
    /// Each call opens a fresh `UnixStream` connection, writes one line of
    /// JSON, and reads one line back. This matches the Agent Gateway protocol
    /// (line-delimited JSON-RPC 2.0 over Unix socket).
    pub fn rpc_call(&self, method: &str, params: Value) -> Result<Value, Box<dyn Error>> {
        let id = self.request_id.fetch_add(1, Ordering::Relaxed);

        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        let mut stream = UnixStream::connect(&self.socket_path)
            .map_err(|e| format!("failed to connect to socket: {e}"))?;

        stream.set_read_timeout(Some(Duration::from_secs(10)))?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;

        let mut request_line = serde_json::to_string(&request)?;
        request_line.push('\n');
        stream.write_all(request_line.as_bytes())?;
        stream.flush()?;

        let mut reader = BufReader::new(stream);
        let mut response_line = String::new();
        if reader.read_line(&mut response_line)? == 0 {
            return Err("Socket closed by Tide before sending response".into());
        }

        let response: Value = serde_json::from_str(&response_line)?;

        // Check for JSON-RPC error
        if let Some(error) = response.get("error") {
            let code = error.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
            let message = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Err(format!("JSON-RPC error {code}: {message}").into());
        }

        // Return the result field
        response.get("result").cloned().ok_or_else(|| {
            format!("Invalid JSON-RPC response: missing 'result' field. Response: {response}")
                .into()
        })
    }

    // ── Convenience methods ─────────────────────────────────────────

    /// List all panes in the active workspace.
    pub fn list_panes(&self) -> Result<Value, Box<dyn Error>> {
        self.rpc_call("list-panes", json!({}))
    }

    /// Open a new terminal pane (splits from the currently focused pane).
    pub fn open_terminal(&self, cwd: Option<&str>) -> Result<Value, Box<dyn Error>> {
        let mut params = json!({});
        if let Some(cwd) = cwd {
            params["cwd"] = json!(cwd);
        }
        self.rpc_call("open-terminal", params)
    }

    /// Split the given (or focused) pane vertically, creating a new terminal below.
    pub fn split_vertical(&self, pane_id: Option<u64>) -> Result<Value, Box<dyn Error>> {
        let mut params = json!({});
        if let Some(id) = pane_id {
            params["pane_id"] = json!(id);
        }
        self.rpc_call("split-vertical", params)
    }

    /// Split the given (or focused) pane horizontally, creating a new terminal to the right.
    pub fn split_horizontal(&self, pane_id: Option<u64>) -> Result<Value, Box<dyn Error>> {
        let mut params = json!({});
        if let Some(id) = pane_id {
            params["pane_id"] = json!(id);
        }
        self.rpc_call("split-horizontal", params)
    }

    /// Close a specific pane.
    pub fn close_pane(&self, pane_id: u64) -> Result<Value, Box<dyn Error>> {
        self.rpc_call("close-pane", json!({"pane_id": pane_id}))
    }

    /// Focus a specific pane.
    pub fn focus_pane(&self, pane_id: u64) -> Result<Value, Box<dyn Error>> {
        self.rpc_call("focus-pane", json!({"pane_id": pane_id}))
    }

    /// Send key sequences to a terminal pane.
    pub fn send_keys(&self, pane_id: u64, keys: &[&str]) -> Result<Value, Box<dyn Error>> {
        self.rpc_call(
            "send-keys",
            json!({
                "pane_id": pane_id,
                "keys": keys,
            }),
        )
    }

    /// Capture the text content of a terminal or editor pane.
    pub fn capture_pane(&self, pane_id: u64) -> Result<Value, Box<dyn Error>> {
        self.rpc_call("capture-pane", json!({"pane_id": pane_id}))
    }

    /// Get the layout tree of the active workspace.
    pub fn get_layout(&self) -> Result<Value, Box<dyn Error>> {
        self.rpc_call("get-layout", json!({}))
    }

    /// Return the path to the Unix socket.
    pub fn socket_path(&self) -> &PathBuf {
        &self.socket_path
    }
}

impl Drop for TestApp {
    fn drop(&mut self) {
        let _ = self.process.kill();
        let _ = self.process.wait();
    }
}
