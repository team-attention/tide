use crate::pane::browser::{
    BrowserPageElementKind, BrowserPane, BrowserSelectionSnapshot, BrowserSnapshot,
};
use crate::pane::PaneKind;
use crate::App;

#[test]
fn browser_snapshot_bridge_message_updates_browser_pane_state() {
    let mut app = App::new();
    let (layout, browser_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            browser_id,
            "https://example.com".into(),
        )),
    );

    let msg = serde_json::json!({
        "kind": "browser-snapshot",
        "pane_id": browser_id,
        "text": "Page heading\nPage paragraph",
        "title": "Example",
        "url": "https://example.com/article"
    })
    .to_string();

    assert!(app.apply_webview_bridge_message(&msg));

    let Some(PaneKind::Browser(browser)) = app.panes.get(&browser_id) else {
        panic!("browser pane should exist");
    };
    let Some(snapshot) = browser.page_snapshot.as_ref() else {
        panic!("browser snapshot should exist");
    };
    assert_eq!(snapshot.text, "Page heading\nPage paragraph");
    assert_eq!(snapshot.page_title.as_deref(), Some("Example"));
    assert_eq!(
        snapshot.page_url.as_deref(),
        Some("https://example.com/article")
    );
}

#[test]
fn browser_snapshot_bridge_message_updates_browser_page_map() {
    let mut app = App::new();
    let (layout, browser_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            browser_id,
            "https://example.com".into(),
        )),
    );

    let msg = serde_json::json!({
        "kind": "browser-snapshot",
        "pane_id": browser_id,
        "text": "Conversation Lab\nUser\n+ Debug User",
        "title": "Conversation Lab",
        "url": "https://example.com/lab",
        "page_map": {
            "regions": [{
                "ref": "r1",
                "role": "complementary",
                "tag": "ASIDE",
                "label": "User list",
                "text": "User\nDebug User",
                "rect": {"x": 720.0, "y": 0.0, "width": 320.0, "height": 640.0}
            }],
            "interactables": [{
                "ref": "i1",
                "role": "button",
                "tag": "BUTTON",
                "label": "+ Debug User",
                "text": "+ Debug User",
                "action": "open-dev-user-modal",
                "disabled": false,
                "rect": {"x": 902.0, "y": 48.0, "width": 104.0, "height": 32.0}
            }]
        }
    })
    .to_string();

    assert!(app.apply_webview_bridge_message(&msg));

    let Some(PaneKind::Browser(browser)) = app.panes.get(&browser_id) else {
        panic!("browser pane should exist");
    };
    let Some(page_map) = browser.page_map.as_ref() else {
        panic!("browser page map should exist");
    };
    assert_eq!(page_map.regions[0].kind, BrowserPageElementKind::Region);
    assert_eq!(page_map.regions[0].label, "User list");
    assert_eq!(page_map.interactables[0].reference, "i1");
    assert_eq!(
        page_map.interactables[0].action.as_deref(),
        Some("open-dev-user-modal")
    );
    assert_eq!(page_map.interactables[0].rect.x, 902.0);
}

#[test]
fn browser_snapshot_bridge_message_clears_empty_snapshot() {
    let mut app = App::new();
    let (layout, browser_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let mut browser = BrowserPane::with_url(browser_id, "https://example.com".into());
    browser.page_snapshot = Some(BrowserSnapshot {
        text: "stale".into(),
        page_title: Some("Old".into()),
        page_url: Some("https://example.com/old".into()),
    });
    app.panes.insert(browser_id, PaneKind::Browser(browser));

    let msg = serde_json::json!({
        "kind": "browser-snapshot",
        "pane_id": browser_id,
        "text": "",
        "title": "",
        "url": ""
    })
    .to_string();

    assert!(app.apply_webview_bridge_message(&msg));

    let Some(PaneKind::Browser(browser)) = app.panes.get(&browser_id) else {
        panic!("browser pane should exist");
    };
    assert!(browser.page_snapshot.is_none());
}

#[test]
fn browser_selection_bridge_message_updates_browser_pane_state() {
    let mut app = App::new();
    let (layout, browser_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            browser_id,
            "https://example.com".into(),
        )),
    );

    let msg = serde_json::json!({
        "kind": "browser-selection",
        "pane_id": browser_id,
        "text": "selected page text",
        "html": "<p>selected page text</p>",
        "context": "page context",
        "title": "Example",
        "url": "https://example.com/article",
        "collapsed": false
    })
    .to_string();

    assert!(app.apply_webview_bridge_message(&msg));

    let Some(PaneKind::Browser(browser)) = app.panes.get(&browser_id) else {
        panic!("browser pane should exist");
    };
    let Some(snapshot) = browser.page_selection.as_ref() else {
        panic!("browser selection snapshot should exist");
    };
    assert_eq!(snapshot.text, "selected page text");
    assert_eq!(snapshot.html, "<p>selected page text</p>");
    assert_eq!(snapshot.context.as_deref(), Some("page context"));
    assert_eq!(snapshot.page_title.as_deref(), Some("Example"));
    assert_eq!(
        snapshot.page_url.as_deref(),
        Some("https://example.com/article")
    );
    assert!(!snapshot.collapsed);
}

#[test]
fn browser_selection_bridge_message_clears_empty_selection() {
    let mut app = App::new();
    let (layout, browser_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let mut browser = BrowserPane::with_url(browser_id, "https://example.com".into());
    browser.page_selection = Some(BrowserSelectionSnapshot {
        text: "stale".into(),
        html: "<p>stale</p>".into(),
        context: Some("stale context".into()),
        page_title: Some("Old".into()),
        page_url: Some("https://example.com/old".into()),
        collapsed: false,
    });
    app.panes.insert(browser_id, PaneKind::Browser(browser));

    let msg = serde_json::json!({
        "kind": "browser-selection",
        "pane_id": browser_id,
        "text": "",
        "html": "",
        "context": null,
        "title": "Example",
        "url": "https://example.com/article",
        "collapsed": true
    })
    .to_string();

    assert!(app.apply_webview_bridge_message(&msg));

    let Some(PaneKind::Browser(browser)) = app.panes.get(&browser_id) else {
        panic!("browser pane should exist");
    };
    assert!(browser.page_selection.is_none());
}

// Spec: docs/specs/browser-agent-pixel-vision.md — a native WKWebView snapshot posts an
// `agent-screenshot` bridge message that fills the Browser Pane Screenshot cache.
#[test]
fn agent_screenshot_bridge_message_fills_browser_pane_screenshot_cache() {
    let mut app = App::new();
    let (layout, browser_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            browser_id,
            "https://example.com".into(),
        )),
    );

    let msg = serde_json::json!({
        "kind": "agent-screenshot",
        "pane_id": browser_id,
        "data": "iVBORw0KGgo=",
        "width": 1024,
        "height": 768,
        "device_scale": 2.0
    })
    .to_string();

    assert!(app.apply_webview_bridge_message(&msg));

    let Some(PaneKind::Browser(browser)) = app.panes.get(&browser_id) else {
        panic!("browser pane should exist");
    };
    let shot = browser.agent_screenshot().expect("screenshot cached");
    assert_eq!(shot.png_base64, "iVBORw0KGgo=");
    assert_eq!(shot.width, 1024);
    assert_eq!(shot.height, 768);
    assert_eq!(shot.device_scale, 2.0);
}

#[test]
fn agent_screenshot_bridge_message_without_data_is_ignored() {
    let mut app = App::new();
    let (layout, browser_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            browser_id,
            "https://example.com".into(),
        )),
    );

    let msg = serde_json::json!({
        "kind": "agent-screenshot",
        "pane_id": browser_id,
        "data": ""
    })
    .to_string();

    assert!(!app.apply_webview_bridge_message(&msg));
    let Some(PaneKind::Browser(browser)) = app.panes.get(&browser_id) else {
        panic!("browser pane should exist");
    };
    assert!(browser.agent_screenshot().is_none());
}
