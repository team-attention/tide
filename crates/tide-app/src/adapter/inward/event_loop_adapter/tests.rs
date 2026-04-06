use crate::pane::browser::{BrowserPane, BrowserSelectionSnapshot};
use crate::pane::PaneKind;
use crate::App;

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
