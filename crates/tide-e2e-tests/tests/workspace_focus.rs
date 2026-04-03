// E2E tests for workspace focus, key sending, and layout inspection.
// Each test launches its own isolated Tide instance and communicates via the Agent Gateway.

use std::time::Duration;

use tide_e2e_tests::assertions::{
    assert_pane_contains, assert_pane_count, assert_pane_focused, focused_pane_id, pane_ids,
};
use tide_e2e_tests::harness::TestApp;

#[test]
fn test_focus_pane() {
    let app = TestApp::launch().expect("failed to launch Tide");

    // Split to get 2 panes
    app.split_vertical(None).expect("split_vertical failed");
    assert_pane_count(&app, 2);

    // The split should have moved focus to the new pane
    let current_focused = focused_pane_id(&app);
    let all_ids = pane_ids(&app);
    let other_id = all_ids
        .iter()
        .find(|&&id| id != current_focused)
        .expect("should have a second pane");

    // Focus the other pane
    app.focus_pane(*other_id).expect("focus_pane failed");

    // Verify focus changed
    assert_pane_focused(&app, *other_id);
}

#[test]
fn test_send_keys_and_capture() {
    let app = TestApp::launch().expect("failed to launch Tide");

    let pane_id = focused_pane_id(&app);

    // Send a command to the terminal
    app.send_keys(pane_id, &["echo hello\n"])
        .expect("send_keys failed");

    // Wait for PTY I/O latency
    std::thread::sleep(Duration::from_millis(500));

    // Capture and verify output contains "hello"
    assert_pane_contains(&app, pane_id, "hello");
}

#[test]
fn test_get_layout_after_split() {
    let app = TestApp::launch().expect("failed to launch Tide");

    // Get initial layout (single pane)
    let initial_layout = app.get_layout().expect("get_layout failed");

    // Split vertically
    app.split_vertical(None).expect("split_vertical failed");

    // Get layout after split
    let split_layout = app.get_layout().expect("get_layout failed after split");

    // Layout should have changed after the split
    assert_ne!(
        initial_layout, split_layout,
        "layout should change after a vertical split"
    );
}
