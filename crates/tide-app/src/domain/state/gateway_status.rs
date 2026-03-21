// Agent Gateway status tracking.

use std::collections::HashSet;
use std::sync::{mpsc, Arc};

use crate::adapter::inward::cli_adapter::server::ConnectedClients;

/// A registered event subscriber.
pub(crate) struct Subscriber {
    pub tx: mpsc::Sender<String>,
    pub event_filter: Vec<String>,
}

/// Lifecycle status of an agent process, reported via hooks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AgentStatus {
    /// Agent is actively processing (UserPromptSubmit / PreToolUse hook fired).
    Running,
    /// Agent finished a turn and is idle (Stop hook fired).
    Idle,
    /// Agent is waiting for user input — permission, question, etc. (Notification hook fired).
    NeedsInput,
}

/// Detected agent process info for a terminal pane.
#[derive(Debug, Clone)]
pub(crate) struct AgentInfo {
    /// Agent display name (e.g. "Claude Code", "Aider").
    pub name: &'static str,
    /// Process ID of the agent.
    pub pid: u32,
    /// Whether this agent is connected to the gateway socket.
    pub gateway_connected: bool,
    /// Lifecycle status reported by agent hooks. `None` if no hooks are active.
    pub status: Option<AgentStatus>,
}

/// Known agent identifiers: (path_pattern, proc_name_pattern, display_name).
/// path_pattern is matched against proc_pidpath (full executable path).
/// proc_name_pattern is matched against proc_name (may be version number for Node.js apps).
const KNOWN_AGENTS: &[(&str, &str, &str)] = &[
    ("claude", "claude", "Claude Code"),    // path: .../claude/... or proc_name: claude
    ("codex", "codex", "Codex"),
    ("gemini", "gemini", "Gemini"),
    ("aider", "aider", "Aider"),
    ("cursor-agent", "cursor-agent", "Cursor"),
    ("copilot", "copilot", "Copilot"),
];

/// Map agent display name to integration tool name for enable_integration().
pub(crate) fn agent_tool_name(agent_name: &str) -> Option<&'static str> {
    match agent_name {
        "Claude Code" => Some("claude-code"),
        "Cursor" => Some("cursor"),
        "Codex" => Some("codex"),
        "Gemini" => Some("gemini"),
        "Aider" => Some("aider"),
        "Copilot" => Some("copilot"),
        _ => None,
    }
}

/// Tracks the state of the Agent Gateway for chrome badge rendering.
pub(crate) struct GatewayStatus {
    pub listening: bool,
    pub socket_path: Option<String>,
    pub connected_clients: usize,
    pub active_streams: usize,
    pub subscribers: Vec<Subscriber>,
    /// Detected agents per terminal pane (pane_id → AgentInfo).
    pub detected_agents: std::collections::HashMap<u64, AgentInfo>,
    /// Shared handle to connected client PIDs (from socket server background thread).
    pub connected_clients_shared: Option<Arc<ConnectedClients>>,
    /// Snapshot of connected client PIDs (synced from background thread in event loop).
    pub connected_pids: HashSet<u32>,
}

impl GatewayStatus {
    pub fn new() -> Self {
        Self {
            listening: false,
            socket_path: None,
            connected_clients: 0,
            active_streams: 0,
            subscribers: Vec::new(),
            detected_agents: std::collections::HashMap::new(),
            connected_clients_shared: None,
            connected_pids: HashSet::new(),
        }
    }

    /// Push an event notification to all matching subscribers.
    pub fn notify(&mut self, event_type: &str, data: serde_json::Value) {
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "event",
            "params": { "type": event_type, "data": data }
        });
        let msg = serde_json::to_string(&notification).unwrap_or_default();

        self.subscribers.retain(|sub| {
            let matches = sub.event_filter.is_empty()
                || sub.event_filter.iter().any(|f| f == event_type);
            if matches {
                sub.tx.send(msg.clone()).is_ok()
            } else {
                !sub.tx.send(String::new()).is_err()
            }
        });
    }

    /// Sync connected PIDs from the background socket thread.
    /// Returns true if the set changed.
    pub fn sync_connected_pids(&mut self) -> bool {
        let Some(ref shared) = self.connected_clients_shared else { return false };
        let new_pids = shared.snapshot();
        let new_count = new_pids.len();
        if new_pids != self.connected_pids {
            self.connected_pids = new_pids;
            self.connected_clients = new_count;
            true
        } else {
            false
        }
    }

    /// Re-check gateway_connected for all detected agents against current connected_pids.
    pub fn refresh_agent_connections(&mut self) {
        for agent in self.detected_agents.values_mut() {
            agent.gateway_connected = is_agent_connected(agent.pid, &self.connected_pids);
        }
    }
}

/// Check if an agent process is connected to the gateway socket.
/// The MCP bridge (`tide mcp`) is a child of the agent, so the connected PID
/// is `tide mcp` whose parent chain leads to the agent PID.
pub(crate) fn is_agent_connected(agent_pid: u32, connected_pids: &HashSet<u32>) -> bool {
    // Direct match
    if connected_pids.contains(&agent_pid) {
        return true;
    }
    // Check if any connected PID is a descendant of the agent
    for &cpid in connected_pids {
        if is_descendant_of(cpid, agent_pid) {
            return true;
        }
    }
    false
}

/// Check if `pid` is a descendant of `ancestor_pid` by walking the parent chain.
#[cfg(target_os = "macos")]
fn is_descendant_of(pid: u32, ancestor_pid: u32) -> bool {
    let mut current = pid;
    for _ in 0..10 { // max depth to prevent infinite loops
        if current <= 1 { return false; }
        let ppid = get_ppid(current);
        if ppid == 0 { return false; }
        if ppid == ancestor_pid { return true; }
        current = ppid;
    }
    false
}

#[cfg(not(target_os = "macos"))]
fn is_descendant_of(_pid: u32, _ancestor_pid: u32) -> bool {
    false
}

/// Get parent PID using macOS proc_pidinfo.
#[cfg(target_os = "macos")]
fn get_ppid(pid: u32) -> u32 {
    // proc_bsdinfo struct — pbi_ppid at offset 16, total size 136 bytes.
    #[repr(C)]
    struct ProcBsdInfo {
        pbi_flags: u32,     // offset 0
        pbi_status: u32,    // offset 4
        pbi_xstatus: u32,   // offset 8
        pbi_pid: u32,       // offset 12
        pbi_ppid: u32,      // offset 16
        _pad: [u8; 116],    // pad to 136 bytes total (5*4 + 116 = 136)
    }

    let mut info: ProcBsdInfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<ProcBsdInfo>() as i32;
    // PROC_PIDTBSDINFO = 3
    let ret = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            3, // PROC_PIDTBSDINFO
            0,
            &mut info as *mut _ as *mut libc::c_void,
            size,
        )
    };
    if ret > 0 { info.pbi_ppid } else { 0 }
}

/// Detect agent processes in the child process tree of a given shell PID.
/// Uses proc_listallpids + PPID filtering (proc_listchildpids is unreliable on macOS).
/// Checks both process name and full executable path for known agents.
#[cfg(target_os = "macos")]
pub(crate) fn detect_agent(shell_pid: u32) -> Option<AgentInfo> {
    detect_agent_recursive(shell_pid, 0)
}

#[cfg(target_os = "macos")]
fn detect_agent_recursive(parent_pid: u32, depth: u32) -> Option<AgentInfo> {
    if depth > 5 { return None; } // prevent infinite recursion

    let children = find_children_via_allpids(parent_pid);
    for child_pid in children {
        // Check executable path first (most reliable — handles Node.js apps
        // where proc_name returns a version number instead of the binary name)
        if let Some(path) = proc_pidpath(child_pid) {
            let path_lower = path.to_lowercase();
            for &(path_pattern, _, display_name) in KNOWN_AGENTS {
                if path_lower.contains(&format!("/{}/", path_pattern))
                    || path_lower.ends_with(&format!("/{}", path_pattern))
                {
                    return Some(AgentInfo {
                        name: display_name,
                        pid: child_pid as u32,
                        gateway_connected: false,
                        status: None,
                    });
                }
            }
        }
        // Check process name as fallback
        if let Some(name) = proc_name(child_pid) {
            for &(_, name_pattern, display_name) in KNOWN_AGENTS {
                if name == name_pattern {
                    return Some(AgentInfo {
                        name: display_name,
                        pid: child_pid as u32,
                        gateway_connected: false,
                        status: None,
                    });
                }
            }
        }
        // Recurse into grandchildren
        if let Some(agent) = detect_agent_recursive(child_pid as u32, depth + 1) {
            return Some(agent);
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn detect_agent(_shell_pid: u32) -> Option<AgentInfo> {
    None
}

/// Find child PIDs by scanning all processes and filtering by PPID.
/// This is more reliable than proc_listchildpids which often returns 0 on macOS.
#[cfg(target_os = "macos")]
fn find_children_via_allpids(parent_pid: u32) -> Vec<i32> {
    // Get all PIDs
    let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    if count <= 0 { return Vec::new(); }
    let mut all_pids = vec![0i32; count as usize];
    let result = unsafe {
        libc::proc_listallpids(
            all_pids.as_mut_ptr() as *mut std::ffi::c_void,
            (all_pids.len() * std::mem::size_of::<i32>()) as i32,
        )
    };
    if result <= 0 { return Vec::new(); }
    let n = result as usize / std::mem::size_of::<i32>();
    all_pids.truncate(n);

    // Filter by PPID
    let mut children = Vec::new();
    for &pid in &all_pids {
        if pid <= 0 { continue; }
        let ppid = get_ppid(pid as u32);
        if ppid == parent_pid {
            children.push(pid);
        }
    }
    children
}

/// Get the full executable path of a process using proc_pidpath.
#[cfg(target_os = "macos")]
fn proc_pidpath(pid: i32) -> Option<String> {
    let mut buf = [0u8; 4096]; // PROC_PIDPATHINFO_MAXSIZE
    let ret = unsafe {
        libc::proc_pidpath(pid, buf.as_mut_ptr() as *mut libc::c_void, buf.len() as u32)
    };
    if ret <= 0 { return None; }
    std::ffi::CStr::from_bytes_until_nul(&buf)
        .ok()
        .and_then(|s| s.to_str().ok())
        .map(|s| s.to_string())
}

#[cfg(target_os = "macos")]
fn proc_name(pid: i32) -> Option<String> {
    let mut buf = [0u8; 1024];
    let result = unsafe {
        libc::proc_name(pid, buf.as_mut_ptr() as *mut libc::c_void, buf.len() as u32)
    };
    if result <= 0 { return None; }
    std::str::from_utf8(&buf[..result as usize]).ok().map(|s| s.to_string())
}
