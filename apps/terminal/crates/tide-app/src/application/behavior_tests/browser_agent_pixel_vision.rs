// Spec: docs/specs/browser-agent-pixel-vision.md
//
// Pixel vision for the v1 Browser Pane: `tide_browser_observe` gains a `vision` axis
// (text|screenshot|both) that attaches a cached Browser Pane Screenshot, and the MCP
// bridge surfaces it as an image content block. The ObjC WKWebView capture that fills the
// cache is verified live; these tests set the cache directly (a fake capture) and drive
// the Gateway + MCP plumbing.

use serde_json::json;

use crate::adapter::inward::cli_adapter::mcp;
use crate::pane::browser::BrowserPane;
use crate::pane::PaneKind;
use crate::tide_core::{PaneId, Size};
use crate::App;

const PNG_BASE64: &str = "iVBORw0KGgoAAAANSUhEUg==";

fn app_with_browser(url: &str) -> (App, PaneId) {
    let mut app = App::new();
    app.window.cached_cell_size = Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    let (layout, browser_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(browser_id, url.to_string())),
    );
    app.focus.focused = Some(browser_id);
    app.focus.stage_focused = Some(browser_id);
    app.focus.focus_area = crate::state::FocusArea::Stage;
    app.router.set_focused(browser_id);
    (app, browser_id)
}

// Simulate the platform WKWebView capture filling the screenshot cache. Returns the
// Browser Pane Generation the capture is stamped with.
fn cache_screenshot(app: &mut App, browser_id: PaneId) -> u64 {
    let Some(PaneKind::Browser(browser)) = app.panes.get_mut(&browser_id) else {
        panic!("expected a browser pane");
    };
    browser.set_agent_screenshot(PNG_BASE64.to_string(), 1024, 768, 2.0);
    browser.generation
}

// --- UC-1: Agent observes the Browser Pane as pixels ---

// UC-1 BR-1: text mode (the default) never returns a screenshot, even when one is cached.
#[test]
fn browser_observe_text_mode_returns_no_screenshot() {
    let (mut app, browser_id) = app_with_browser("https://example.test");
    cache_screenshot(&mut app, browser_id);

    let result = app
        .handle_cli_command("browser-observe", json!({ "pane_id": browser_id }))
        .expect("observe ok");

    assert_eq!(result["vision"], "text");
    assert!(result["screenshot"].is_null());
}

// UC-1 BR-1/BR-2: screenshot mode attaches the cached image with its pixel dimensions.
#[test]
fn browser_observe_screenshot_mode_captures_image() {
    let (mut app, browser_id) = app_with_browser("https://example.test");
    cache_screenshot(&mut app, browser_id);

    let result = app
        .handle_cli_command(
            "browser-observe",
            json!({ "pane_id": browser_id, "vision": "screenshot" }),
        )
        .expect("observe ok");

    assert_eq!(result["vision"], "screenshot");
    let shot = &result["screenshot"];
    assert_eq!(shot["data"], PNG_BASE64);
    assert_eq!(shot["mime_type"], "image/png");
    assert_eq!(shot["width"], 1024);
    assert_eq!(shot["height"], 768);
    assert_eq!(shot["device_scale"], 2.0);
}

// UC-1 BR-3: screenshot-only mode omits the full BrowserSnapshot body (forced compact).
#[test]
fn browser_observe_screenshot_mode_omits_full_body() {
    let (mut app, browser_id) = app_with_browser("https://example.test");
    cache_screenshot(&mut app, browser_id);

    let result = app
        .handle_cli_command(
            "browser-observe",
            json!({ "pane_id": browser_id, "vision": "screenshot", "detail": "full" }),
        )
        .expect("observe ok");

    assert_eq!(result["detail"], "compact");
}

// UC-1 BR-3: both returns the detail-governed text body AND the screenshot.
#[test]
fn browser_observe_both_returns_body_and_screenshot() {
    let (mut app, browser_id) = app_with_browser("https://example.test");
    cache_screenshot(&mut app, browser_id);

    let result = app
        .handle_cli_command(
            "browser-observe",
            json!({ "pane_id": browser_id, "vision": "both", "detail": "full" }),
        )
        .expect("observe ok");

    assert_eq!(result["vision"], "both");
    assert_eq!(result["detail"], "full");
    assert!(result.get("snapshot").is_some());
    assert!(result.get("page_map").is_some());
    assert_eq!(result["screenshot"]["data"], PNG_BASE64);
}

// UC-1: when nothing has been captured yet, screenshot mode degrades to a null screenshot
// (BR-9 hybrid degrade), not an error.
#[test]
fn browser_observe_screenshot_mode_without_capture_returns_null_screenshot() {
    let (mut app, browser_id) = app_with_browser("https://example.test");

    let result = app
        .handle_cli_command(
            "browser-observe",
            json!({ "pane_id": browser_id, "vision": "screenshot" }),
        )
        .expect("observe ok");

    assert!(result["screenshot"].is_null());
}

// UC-1: an unsupported vision value is rejected with a structured error.
#[test]
fn browser_observe_rejects_unsupported_vision() {
    let (mut app, browser_id) = app_with_browser("https://example.test");

    let result = app.handle_cli_command(
        "browser-observe",
        json!({ "pane_id": browser_id, "vision": "video" }),
    );

    assert!(result.is_err());
}

// --- UC-2: Pixel space matches the action / cursor space ---

// UC-2 BR-5: the screenshot is stamped with the capturing Browser Pane Generation.
#[test]
fn browser_pane_screenshot_is_stamped_with_pane_generation() {
    let (mut app, browser_id) = app_with_browser("https://example.test");
    let generation = cache_screenshot(&mut app, browser_id);

    let result = app
        .handle_cli_command(
            "browser-observe",
            json!({ "pane_id": browser_id, "vision": "screenshot" }),
        )
        .expect("observe ok");

    assert_eq!(result["screenshot"]["generation"], generation);
}

// --- UC-1 BR-3: MCP surfaces the screenshot as an image content block ---

#[test]
fn mcp_browser_observe_screenshot_emits_image_content_block() {
    let result = json!({
        "pane_id": 1,
        "vision": "screenshot",
        "screenshot": {
            "data": PNG_BASE64,
            "mime_type": "image/png",
            "width": 1024,
            "height": 768,
            "device_scale": 2.0,
            "generation": 7,
        },
    });

    let content = mcp::mcp_tool_call_content(&result);

    assert_eq!(content.len(), 2);
    assert_eq!(content[0]["type"], "text");
    // The heavy base64 is stripped from the text block (metadata stays).
    let text = content[0]["text"].as_str().unwrap_or_default();
    assert!(!text.contains(PNG_BASE64));
    assert!(text.contains("device_scale"));
    // The image block carries the bytes.
    assert_eq!(content[1]["type"], "image");
    assert_eq!(content[1]["data"], PNG_BASE64);
    assert_eq!(content[1]["mimeType"], "image/png");
}

#[test]
fn mcp_tool_call_content_without_screenshot_is_text_only() {
    let result = json!({ "pane_id": 1, "vision": "text", "screenshot": serde_json::Value::Null });

    let content = mcp::mcp_tool_call_content(&result);

    assert_eq!(content.len(), 1);
    assert_eq!(content[0]["type"], "text");
}
