// Spec: docs/testing/e2e-tests.md
// E2E test-driver gateway methods (test-poll-state, test-inject-event), in-process.

use crate::App;

#[test]
fn test_poll_state_reports_idle_when_settled() {
    // A freshly settled app (no pending redraw, no layout animation) reports idle.
    use crate::adapter::inward::cli_adapter::commands::cli_test_poll_state;
    let mut app = App::new();
    app.cache.needs_redraw = false;

    let state = cli_test_poll_state(&app);
    assert_eq!(state["needs_redraw"], false);
    assert_eq!(state["animating"], false);
    assert_eq!(state["idle"], true);
}

#[test]
fn test_poll_state_reports_busy_when_a_redraw_is_pending() {
    // A pending redraw means the app is not yet idle.
    use crate::adapter::inward::cli_adapter::commands::cli_test_poll_state;
    let mut app = App::new();
    app.cache.needs_redraw = true;

    let state = cli_test_poll_state(&app);
    assert_eq!(state["needs_redraw"], true);
    assert_eq!(state["idle"], false);
}

#[test]
fn test_inject_event_round_trips_and_queues_a_platform_event() {
    // E-1: a serialized PlatformEvent injected via test-inject-event deserializes
    // and is queued for the app-thread loop to feed through the real event path.
    use crate::adapter::inward::cli_adapter::commands::cli_test_inject_event;
    use crate::tide_core::{Key, Modifiers};
    use crate::tide_platform::PlatformEvent;

    let mut app = App::new();
    let event = PlatformEvent::KeyDown {
        key: Key::Enter,
        modifiers: Modifiers::default(),
        chars: None,
    };
    let params = serde_json::json!({ "event": serde_json::to_value(&event).unwrap() });

    cli_test_inject_event(&mut app, params).expect("inject should accept a valid PlatformEvent");

    assert_eq!(app.injected_events.len(), 1);
    assert!(matches!(
        app.injected_events[0],
        PlatformEvent::KeyDown {
            key: Key::Enter,
            ..
        }
    ));
}

#[test]
fn test_inject_event_rejects_an_invalid_payload() {
    use crate::adapter::inward::cli_adapter::commands::cli_test_inject_event;
    let mut app = App::new();
    let params = serde_json::json!({ "event": { "NotARealVariant": {} } });
    assert!(cli_test_inject_event(&mut app, params).is_err());
    assert!(app.injected_events.is_empty());
}
