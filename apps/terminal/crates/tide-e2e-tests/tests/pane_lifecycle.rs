// E2E tests for pane lifecycle operations.
// Each test launches its own isolated Tide instance and communicates via the Agent Gateway.

use tide_e2e_tests::assertions::{assert_pane_count, focused_pane_id, pane_ids};
use tide_e2e_tests::harness::TestApp;

#[test]
fn test_launch_and_list_panes() {
    let app = TestApp::launch().expect("failed to launch Tide");
    let panes = app.list_panes().expect("list_panes failed");
    let arr = panes.as_array().expect("list_panes should return an array");
    assert!(
        !arr.is_empty(),
        "expected at least 1 pane after launch, got 0"
    );
}

#[test]
fn test_open_terminal() {
    let app = TestApp::launch().expect("failed to launch Tide");
    let initial_count = pane_ids(&app).len();

    app.open_terminal(None).expect("open_terminal failed");

    let new_count = pane_ids(&app).len();
    assert_eq!(
        new_count,
        initial_count + 1,
        "expected pane count to increase by 1 after open_terminal"
    );
}

#[test]
fn test_split_vertical() {
    let app = TestApp::launch().expect("failed to launch Tide");

    app.split_vertical(None).expect("split_vertical failed");

    assert_pane_count(&app, 2);
}

#[test]
fn test_split_horizontal() {
    let app = TestApp::launch().expect("failed to launch Tide");

    app.split_horizontal(None).expect("split_horizontal failed");

    assert_pane_count(&app, 2);
}

#[test]
fn test_close_pane() {
    let app = TestApp::launch().expect("failed to launch Tide");

    // Split to get 2 panes
    app.split_vertical(None).expect("split_vertical failed");
    assert_pane_count(&app, 2);

    // Close the currently focused pane
    let to_close = focused_pane_id(&app);
    app.close_pane(to_close).expect("close_pane failed");

    assert_pane_count(&app, 1);
}
