// E2E assertion helpers for verifying Tide state via Agent Gateway responses.

use crate::harness::TestApp;

/// Assert that the active workspace has exactly `expected` panes.
pub fn assert_pane_count(app: &TestApp, expected: usize) {
    let panes = app.list_panes().expect("list_panes failed");
    let arr = panes.as_array().expect("list_panes should return an array");
    assert_eq!(
        arr.len(),
        expected,
        "expected {expected} panes, got {}. panes: {panes}",
        arr.len()
    );
}

/// Assert that a specific pane is currently focused.
pub fn assert_pane_focused(app: &TestApp, pane_id: u64) {
    let panes = app.list_panes().expect("list_panes failed");
    let arr = panes.as_array().expect("list_panes should return an array");

    let focused = arr
        .iter()
        .find(|p| p.get("focused").and_then(|v| v.as_bool()) == Some(true));

    match focused {
        Some(p) => {
            let actual_id = p.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
            assert_eq!(
                actual_id, pane_id,
                "expected pane {pane_id} to be focused, but pane {actual_id} is focused"
            );
        }
        None => panic!("no pane is focused, expected pane {pane_id}"),
    }
}

/// Assert that a pane with the given ID exists and has the expected kind.
pub fn assert_pane_kind(app: &TestApp, pane_id: u64, expected_kind: &str) {
    let panes = app.list_panes().expect("list_panes failed");
    let arr = panes.as_array().expect("list_panes should return an array");

    let pane = arr
        .iter()
        .find(|p| p.get("id").and_then(|v| v.as_u64()) == Some(pane_id))
        .unwrap_or_else(|| panic!("pane {pane_id} not found in list_panes result"));

    let kind = pane
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    assert_eq!(
        kind, expected_kind,
        "pane {pane_id}: expected kind '{expected_kind}', got '{kind}'"
    );
}

/// Assert that captured pane content contains the given substring.
pub fn assert_pane_contains(app: &TestApp, pane_id: u64, expected: &str) {
    let capture = app.capture_pane(pane_id).expect("capture_pane failed");
    let content = capture
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    assert!(
        content.contains(expected),
        "pane {pane_id} content does not contain '{expected}'.\nActual content:\n{content}"
    );
}

/// Return the ID of the currently focused pane, or panic if none.
pub fn focused_pane_id(app: &TestApp) -> u64 {
    let panes = app.list_panes().expect("list_panes failed");
    let arr = panes.as_array().expect("list_panes should return an array");

    arr.iter()
        .find(|p| p.get("focused").and_then(|v| v.as_bool()) == Some(true))
        .and_then(|p| p.get("id").and_then(|v| v.as_u64()))
        .expect("no focused pane found")
}

/// Return all pane IDs in the active workspace.
pub fn pane_ids(app: &TestApp) -> Vec<u64> {
    let panes = app.list_panes().expect("list_panes failed");
    let arr = panes.as_array().expect("list_panes should return an array");

    arr.iter()
        .filter_map(|p| p.get("id").and_then(|v| v.as_u64()))
        .collect()
}

/// Wait for a condition to become true, polling at intervals.
/// Returns Ok(()) if the condition is met within the timeout, or Err with a message.
pub fn wait_until(
    timeout: std::time::Duration,
    poll_interval: std::time::Duration,
    description: &str,
    mut condition: impl FnMut() -> bool,
) -> Result<(), String> {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if condition() {
            return Ok(());
        }
        std::thread::sleep(poll_interval);
    }
    Err(format!("timed out waiting for: {description}"))
}

/// Poll `capture_pane` until the pane content contains `needle` (default 2s
/// budget, 100ms interval). Use this instead of asserting immediately after
/// `send_keys` — the PTY round-trip is asynchronous, so an immediate capture
/// races the output. Panics on timeout with the last captured content.
pub fn wait_for_pane_contains(app: &TestApp, pane_id: u64, needle: &str) {
    let last = std::cell::RefCell::new(String::new());
    let result = wait_until(
        std::time::Duration::from_secs(2),
        std::time::Duration::from_millis(100),
        &format!("pane {pane_id} content to contain {needle:?}"),
        || {
            if let Ok(capture) = app.capture_pane(pane_id) {
                if let Some(content) = capture.get("content").and_then(|v| v.as_str()) {
                    *last.borrow_mut() = content.to_string();
                    return content.contains(needle);
                }
            }
            false
        },
    );
    if let Err(message) = result {
        panic!("{message}.\nLast captured content:\n{}", last.borrow());
    }
}
