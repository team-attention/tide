// Spec: docs/specs/shortcut-settings.md, UC-1 BR-2..5.
use serde_json::{json, Value};
use std::time::Duration;
use tide_e2e_tests::{assertions::pane_ids, harness::TestApp};

fn press(app: &TestApp, key: Value, meta: bool, shift: bool, alt: bool) {
    app.inject_event(json!({"KeyDown":{"key":key,"modifiers":{"meta":meta,"ctrl":false,"shift":shift,"alt":alt},"chars":null}})).unwrap();
    app.wait_for_idle(Duration::from_secs(5)).unwrap();
}

#[test]
#[ignore = "e2e: launches a real windowed app"]
fn shortcut_settings_records_and_resets_in_a_real_window() {
    let app = TestApp::launch().unwrap();
    let initial = pane_ids(&app).len();
    press(&app, json!({"Char":","}), true, false, false);
    app.inject_event(json!({"ImeCommit":"New Tab"})).unwrap();
    app.wait_for_idle(Duration::from_secs(5)).unwrap();
    press(&app, json!("Enter"), false, false, false);
    press(&app, json!({"Char":"y"}), true, true, true);
    assert_eq!(pane_ids(&app).len(), initial, "recording must not run a command");
    press(&app, json!("Escape"), false, false, false);
    press(&app, json!({"Char":"y"}), true, true, true);
    assert_eq!(pane_ids(&app).len(), initial + 1, "new shortcut must route to New Tab");
    press(&app, json!({"Char":","}), true, false, false);
    press(&app, json!("Backspace"), true, true, false);
    press(&app, json!("Escape"), false, false, false);
    press(&app, json!({"Char":"y"}), true, true, true);
    assert_eq!(pane_ids(&app).len(), initial + 1, "reset must remove the override");
    press(&app, json!({"Char":"t"}), true, false, false);
    assert_eq!(pane_ids(&app).len(), initial + 2, "reset must restore the default");
}
