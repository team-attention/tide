// Unix socket server for the Agent Gateway.
//
// Listens on $TMPDIR/tide-<pid>.sock, accepts connections,
// reads line-delimited JSON-RPC 2.0, and enqueues CliCommands
// into the app event loop.

use std::collections::HashMap;
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use super::protocol::{JsonRpcErrorResponse, JsonRpcRequest, JsonRpcResponse};
use super::CliCommand;
use crate::event_loop::AppEvent;
use crate::tide_core::TideWindowId;
use crate::tide_platform::WakeCallback;

/// Thread-safe set of PIDs currently connected to the gateway socket.
/// Shared between background socket threads and the app thread via Arc.
pub(crate) struct ConnectedClients {
    pids: Mutex<HashSet<u32>>,
}

impl ConnectedClients {
    pub fn new() -> Self {
        Self {
            pids: Mutex::new(HashSet::new()),
        }
    }

    pub fn add(&self, pid: u32) {
        self.pids
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(pid);
    }

    pub fn remove(&self, pid: u32) {
        self.pids
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&pid);
    }

    /// Snapshot the current set of connected PIDs. Called from the app thread.
    pub fn snapshot(&self) -> HashSet<u32> {
        self.pids.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn count(&self) -> usize {
        self.pids.lock().unwrap_or_else(|e| e.into_inner()).len()
    }
}

/// Handle to the running socket server. Drop to shut down.
pub(crate) struct GatewayServer {
    pub socket_path: PathBuf,
    shutdown: Arc<AtomicBool>,
    pub connected_clients: Arc<ConnectedClients>,
}

#[derive(Clone)]
pub(crate) struct GatewayCommandTarget {
    event_tx: mpsc::Sender<AppEvent>,
    waker: WakeCallback,
}

impl GatewayCommandTarget {
    pub fn new(event_tx: mpsc::Sender<AppEvent>, waker: WakeCallback) -> Self {
        Self { event_tx, waker }
    }
}

pub(crate) struct GatewayCommandRouter {
    targets: Mutex<HashMap<TideWindowId, GatewayCommandTarget>>,
    active_tide_window_id: Mutex<Option<TideWindowId>>,
}

impl GatewayCommandRouter {
    pub fn new() -> Self {
        Self {
            targets: Mutex::new(HashMap::new()),
            active_tide_window_id: Mutex::new(None),
        }
    }

    pub fn register_window(
        &self,
        tide_window_id: TideWindowId,
        event_tx: mpsc::Sender<AppEvent>,
        waker: WakeCallback,
    ) {
        self.targets
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(tide_window_id, GatewayCommandTarget::new(event_tx, waker));
        self.set_active_window(tide_window_id);
    }

    pub fn set_active_window(&self, tide_window_id: TideWindowId) {
        *self
            .active_tide_window_id
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(tide_window_id);
    }

    pub fn unregister_window(&self, tide_window_id: TideWindowId) {
        let mut targets = self.targets.lock().unwrap_or_else(|e| e.into_inner());
        targets.remove(&tide_window_id);

        let mut active = self
            .active_tide_window_id
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if *active == Some(tide_window_id) {
            *active = targets.keys().next().copied();
        }
    }

    fn target_for(&self, tide_window_id: Option<TideWindowId>) -> Option<GatewayCommandTarget> {
        let targets = self.targets.lock().unwrap_or_else(|e| e.into_inner());
        match tide_window_id {
            Some(id) => targets.get(&id).cloned(),
            None => self
                .active_tide_window_id
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .and_then(|id| targets.get(&id).cloned())
                .or_else(|| targets.values().next().cloned()),
        }
    }

    pub fn dispatch(&self, tide_window_id: Option<TideWindowId>, cmd: CliCommand) -> bool {
        let Some(target) = self.target_for(tide_window_id) else {
            return false;
        };
        if target.event_tx.send(AppEvent::CliCommand(cmd)).is_err() {
            return false;
        }
        (target.waker)();
        true
    }

    pub fn broadcast_reload_settings(&self) {
        let targets: Vec<_> = self
            .targets
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .cloned()
            .collect();
        for target in targets {
            if target.event_tx.send(AppEvent::ReloadSettings).is_ok() {
                (target.waker)();
            }
        }
    }

    pub fn wake_all(&self) {
        let targets: Vec<_> = self
            .targets
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .cloned()
            .collect();
        for target in targets {
            (target.waker)();
        }
    }
}

impl GatewayServer {
    /// Start the socket server on a background thread.
    pub fn start(router: Arc<GatewayCommandRouter>) -> std::io::Result<Self> {
        let pid = std::process::id();
        let tmpdir = std::env::temp_dir();
        let socket_path = tmpdir.join(format!("tide-{pid}.sock"));

        // Clean up stale socket from a previous run
        Self::cleanup_stale_socket(&socket_path);

        let listener = UnixListener::bind(&socket_path)?;
        listener.set_nonblocking(false)?;

        // Create symlink for discovery
        let latest_path = tmpdir.join("tide-latest.sock");
        let _ = std::fs::remove_file(&latest_path);
        let _ = std::os::unix::fs::symlink(&socket_path, &latest_path);

        let shutdown = Arc::new(AtomicBool::new(false));
        let connected_clients = Arc::new(ConnectedClients::new());

        let server = Self {
            socket_path: socket_path.clone(),
            shutdown: shutdown.clone(),
            connected_clients: connected_clients.clone(),
        };

        // Accept connections in a background thread
        std::thread::Builder::new()
            .name("gateway-listener".into())
            .spawn({
                let shutdown = shutdown.clone();
                let connected_clients = connected_clients.clone();
                move || {
                    // Switch to non-blocking so we can check shutdown flag
                    listener.set_nonblocking(true).ok();

                    while !shutdown.load(Ordering::Relaxed) {
                        match listener.accept() {
                            Ok((stream, _addr)) => {
                                // Accepted sockets inherit non-blocking from the listener on macOS.
                                // Client handlers need blocking I/O.
                                stream.set_nonblocking(false).ok();
                                let peer_pid = get_peer_pid(&stream);
                                if let Some(pid) = peer_pid {
                                    connected_clients.add(pid);
                                }
                                let router = router.clone();
                                let shutdown = shutdown.clone();
                                let connected_clients = connected_clients.clone();

                                std::thread::Builder::new()
                                    .name("gateway-client".into())
                                    .spawn(move || {
                                        Self::handle_client(stream, router, shutdown);
                                        if let Some(pid) = peer_pid {
                                            connected_clients.remove(pid);
                                        }
                                    })
                                    .ok();
                            }
                            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                std::thread::sleep(std::time::Duration::from_millis(50));
                            }
                            Err(_) => {
                                if shutdown.load(Ordering::Relaxed) {
                                    break;
                                }
                                std::thread::sleep(std::time::Duration::from_millis(100));
                            }
                        }
                    }
                }
            })?;

        Ok(server)
    }

    /// Handle a single client connection.
    fn handle_client(
        stream: std::os::unix::net::UnixStream,
        router: Arc<GatewayCommandRouter>,
        shutdown: Arc<AtomicBool>,
    ) {
        let reader = BufReader::new(match stream.try_clone() {
            Ok(s) => s,
            Err(_) => return,
        });
        let mut writer = stream;

        for line in reader.lines() {
            if shutdown.load(Ordering::Relaxed) {
                break;
            }

            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };

            if line.trim().is_empty() {
                continue;
            }

            // Parse JSON-RPC request
            let request: JsonRpcRequest = match serde_json::from_str(&line) {
                Ok(r) => r,
                Err(e) => {
                    let err = JsonRpcErrorResponse::new(
                        serde_json::Value::Null,
                        -32700,
                        format!("parse error: {e}"),
                    );
                    let _ = writeln!(writer, "{}", serde_json::to_string(&err).unwrap());
                    continue;
                }
            };

            let id = request.id.clone().unwrap_or(serde_json::Value::Null);

            // Create a oneshot-like channel for the response
            let (resp_tx, resp_rx) = mpsc::channel();

            // Check if this is a subscribe command
            let is_subscribe = request.method == "subscribe";

            let (notif_tx, notif_rx) = if is_subscribe {
                let (tx, rx) = mpsc::channel::<String>();
                (Some(tx), Some(rx))
            } else {
                (None, None)
            };

            let mut params = request.params;
            let caller_window = extract_caller_window(&mut params);

            let cmd = CliCommand {
                method: request.method,
                params,
                response_tx: resp_tx,
                notification_tx: notif_tx,
            };

            // Enqueue into the app event loop
            if !router.dispatch(caller_window, cmd) {
                break; // App has shut down
            }

            // Wait for the response from the app thread
            match resp_rx.recv() {
                Ok(Ok(result)) => {
                    let resp = JsonRpcResponse::new(id, result);
                    let _ = writeln!(writer, "{}", serde_json::to_string(&resp).unwrap());
                }
                Ok(Err(cli_err)) => {
                    let resp = JsonRpcErrorResponse::new(id, cli_err.code(), cli_err.message());
                    let _ = writeln!(writer, "{}", serde_json::to_string(&resp).unwrap());
                    continue;
                }
                Err(_) => break, // App thread dropped the sender
            }

            // If this was a subscribe command, enter notification loop
            if let Some(notif_rx) = notif_rx {
                loop {
                    match notif_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                        Ok(notification) => {
                            if writeln!(writer, "{}", notification).is_err() {
                                break;
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            if shutdown.load(Ordering::Relaxed) {
                                break;
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
                break;
            }
        }
    }

    /// Remove a stale socket file if the owning process is dead.
    fn cleanup_stale_socket(path: &PathBuf) {
        if !path.exists() {
            return;
        }
        let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if let Some(pid_str) = filename
            .strip_prefix("tide-")
            .and_then(|s| s.strip_suffix(".sock"))
        {
            if let Ok(pid) = pid_str.parse::<i32>() {
                if unsafe { libc::kill(pid, 0) } != 0 {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
    }
}

fn extract_caller_window(params: &mut serde_json::Value) -> Option<TideWindowId> {
    params
        .as_object_mut()
        .and_then(|m| m.remove("_caller_window"))
        .and_then(|v| v.as_u64())
        .map(TideWindowId::new)
}

/// Get the PID of the peer process on a Unix domain socket.
/// Uses macOS LOCAL_PEERPID via getsockopt.
#[cfg(target_os = "macos")]
fn get_peer_pid(stream: &std::os::unix::net::UnixStream) -> Option<u32> {
    use std::os::unix::io::AsRawFd;
    let fd = stream.as_raw_fd();
    let mut pid: libc::pid_t = 0;
    let mut len: libc::socklen_t = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
    // SOL_LOCAL = 0, LOCAL_PEERPID = 2
    let ret = unsafe {
        libc::getsockopt(
            fd,
            0, // SOL_LOCAL
            2, // LOCAL_PEERPID
            &mut pid as *mut _ as *mut libc::c_void,
            &mut len,
        )
    };
    if ret == 0 && pid > 0 {
        Some(pid as u32)
    } else {
        None
    }
}

#[cfg(not(target_os = "macos"))]
fn get_peer_pid(_stream: &std::os::unix::net::UnixStream) -> Option<u32> {
    None
}

impl Drop for GatewayServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        let _ = std::fs::remove_file(&self.socket_path);

        let latest = self
            .socket_path
            .parent()
            .map(|p| p.join("tide-latest.sock"))
            .unwrap_or_default();
        if let Ok(target) = std::fs::read_link(&latest) {
            if target == self.socket_path {
                let _ = std::fs::remove_file(&latest);
            }
        }
    }
}
